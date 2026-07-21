// redde-reexec — re-execution tier, slice 2: EXECUTE, don't trust eth_call.
//
// The reads leg trusts the node's `eth_call`. This does not: it pulls the contract's
// code and the storage slots the call touches from a pinned block over RPC, loads them
// into a LOCAL revm, and executes the bytecode itself. We prove the harness by running
// a view call locally and checking it equals the node's `eth_call` — same input, our
// own EVM. Once that holds, we can execute invariants a static read cannot reach
// (redemption simulation, etc.) without trusting the reporter's execution.
//
// State is fetched lazily per (address, slot); slice 1 (reexec.mjs) shows those same
// reads are Merkle-verifiable against the block stateRoot. Zero cloud deps beyond revm
// + a blocking JSON-RPC client. RPC key comes from ETH_RPC_URL (never hardcoded).

use std::cell::RefCell;
use std::collections::HashMap;
use std::str::FromStr;

use revm::bytecode::Bytecode;
use revm::context::result::{ExecutionResult, Output};
use revm::context::TxEnv;
use revm::database_interface::{DBErrorMarker, DatabaseRef, WrapDatabaseRef};
use revm::primitives::{Address, Bytes, TxKind, B256, KECCAK_EMPTY, U256};
use revm::state::AccountInfo;
use revm::{Context, ExecuteEvm, MainBuilder, MainContext};

// ── error ────────────────────────────────────────────────────────────────────
#[derive(Debug)]
struct DbError(String);
impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}", self.0) }
}
impl std::error::Error for DbError {}
impl DBErrorMarker for DbError {}

// ── a revm DatabaseRef backed by a pinned-block JSON-RPC endpoint ──────────────
struct RpcDb {
    url: String,
    block: String, // hex block tag, e.g. "0x1abc..."
    accounts: RefCell<HashMap<Address, AccountInfo>>,
    storage: RefCell<HashMap<(Address, U256), U256>>,
    code: RefCell<HashMap<B256, Bytecode>>,
    calls: RefCell<u64>,
}

impl RpcDb {
    fn new(url: String, block: String) -> Self {
        RpcDb { url, block, accounts: RefCell::new(HashMap::new()),
            storage: RefCell::new(HashMap::new()), code: RefCell::new(HashMap::new()),
            calls: RefCell::new(0) }
    }
    fn rpc(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, DbError> {
        *self.calls.borrow_mut() += 1;
        let body = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let mut last = String::new();
        for attempt in 0..5u32 {
            if attempt > 0 { std::thread::sleep(std::time::Duration::from_millis(250 * attempt as u64)); }
            match ureq::post(&self.url).send_json(&body) {
                Ok(resp) => match resp.into_json::<serde_json::Value>() {
                    Ok(v) => {
                        if let Some(e) = v.get("error") { return Err(DbError(format!("{method}: {e}"))); }
                        return v.get("result").cloned().ok_or_else(|| DbError(format!("{method}: no result")));
                    }
                    Err(e) => last = format!("{method}: decode {e}"),
                },
                Err(e) => last = format!("{method}: {e}"),
            }
        }
        Err(DbError(last))
    }
    fn hex_u256(v: &serde_json::Value) -> U256 {
        let s = v.as_str().unwrap_or("0x0").trim_start_matches("0x");
        if s.is_empty() { U256::ZERO } else { U256::from_str_radix(s, 16).unwrap_or(U256::ZERO) }
    }
}

impl DatabaseRef for RpcDb {
    type Error = DbError;

    fn basic_ref(&self, address: Address) -> Result<Option<AccountInfo>, DbError> {
        if let Some(a) = self.accounts.borrow().get(&address) { return Ok(Some(a.clone())); }
        let addr = format!("{address:#x}");
        let bal = Self::hex_u256(&self.rpc("eth_getBalance", serde_json::json!([addr, self.block]))?);
        let nonce_v = self.rpc("eth_getTransactionCount", serde_json::json!([addr, self.block]))?;
        let nonce = u64::from_str_radix(nonce_v.as_str().unwrap_or("0x0").trim_start_matches("0x"), 16).unwrap_or(0);
        let code_v = self.rpc("eth_getCode", serde_json::json!([addr, self.block]))?;
        let code_hex = code_v.as_str().unwrap_or("0x").trim_start_matches("0x");
        let info = if code_hex.is_empty() {
            AccountInfo::new(bal, nonce, KECCAK_EMPTY, Bytecode::default())
        } else {
            let raw = hex::decode(code_hex).map_err(|e| DbError(format!("code hex: {e}")))?;
            let bc = Bytecode::new_raw(Bytes::from(raw));
            let hash = bc.hash_slow();
            self.code.borrow_mut().insert(hash, bc.clone());
            AccountInfo::new(bal, nonce, hash, bc)
        };
        self.accounts.borrow_mut().insert(address, info.clone());
        Ok(Some(info))
    }

    fn code_by_hash_ref(&self, code_hash: B256) -> Result<Bytecode, DbError> {
        self.code.borrow().get(&code_hash).cloned()
            .ok_or_else(|| DbError(format!("code_by_hash miss {code_hash:#x}")))
    }

    fn storage_ref(&self, address: Address, index: U256) -> Result<U256, DbError> {
        if let Some(v) = self.storage.borrow().get(&(address, index)) { return Ok(*v); }
        let addr = format!("{address:#x}");
        let slot = format!("0x{index:x}");
        let v = Self::hex_u256(&self.rpc("eth_getStorageAt", serde_json::json!([addr, slot, self.block]))?);
        self.storage.borrow_mut().insert((address, index), v);
        Ok(v)
    }

    fn block_hash_ref(&self, _number: u64) -> Result<B256, DbError> { Ok(B256::ZERO) }
}

// ── execute one view call locally against the RPC-backed state ─────────────────
fn local_call(db: &RpcDb, target: Address, data: Bytes) -> Result<Bytes, String> {
    let mut evm = Context::mainnet().with_db(WrapDatabaseRef(db)).build_mainnet();
    let caller = Address::from_str("0x0000000000000000000000000000000000000001").unwrap();
    let tx = TxEnv::builder()
        .caller(caller)
        .kind(TxKind::Call(target))
        .data(data)
        .gas_limit(50_000_000)
        .gas_price(0)
        .build_fill();
    match evm.transact_one(tx).map_err(|e| format!("evm: {e:?}"))? {
        ExecutionResult::Success { output: Output::Call(bytes), .. } => Ok(bytes),
        other => Err(format!("execution not successful: {other:?}")),
    }
}

fn rpc_eth_call(db: &RpcDb, target: Address, data: &Bytes) -> Result<Bytes, DbError> {
    let to = format!("{target:#x}");
    let d = format!("0x{}", hex::encode(data));
    let v = db.rpc("eth_call", serde_json::json!([{ "to": to, "data": d }, db.block]))?;
    let s = v.as_str().unwrap_or("0x").trim_start_matches("0x");
    Ok(Bytes::from(hex::decode(s).unwrap_or_default()))
}

fn main() {
    let url = std::env::var("ETH_RPC_URL").unwrap_or_else(|_| "https://eth.llamarpc.com".into());
    let db_probe = RpcDb::new(url.clone(), "latest".into());
    let block = db_probe.rpc("eth_blockNumber", serde_json::json!([])).expect("blockNumber");
    let block = block.as_str().unwrap().to_string();
    let db = RpcDb::new(url, block.clone());

    // target: Lido stETH.  view: totalSupply()  (0x18160ddd)
    let steth = Address::from_str("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84").unwrap();
    let data = Bytes::from_static(&[0x18, 0x16, 0x0d, 0xdd]);

    let bar = "─".repeat(74);
    println!("{bar}");
    println!("  Redde · re-execution tier (slice 2: local revm execution)   block {}",
        u64::from_str_radix(block.trim_start_matches("0x"), 16).unwrap_or(0));
    println!("{bar}");

    let local = local_call(&db, steth, data.clone()).expect("local execution failed");
    let node = rpc_eth_call(&db, steth, &data).expect("eth_call failed");

    let to_u256 = |b: &Bytes| if b.len() >= 32 { U256::from_be_slice(&b[..32]) } else { U256::ZERO };
    let lv = to_u256(&local);
    let nv = to_u256(&node);
    let wei = U256::from(10u64).pow(U256::from(18));
    let eth = |x: U256| -> String { format!("{}.{:03}", x / wei, (x % wei) * U256::from(1000) / wei) };

    println!("  target        Lido stETH  ({steth:#x})");
    println!("  call          totalSupply()");
    println!("  local revm    {} ETH   (executed the bytecode here)", eth(lv));
    println!("  node eth_call {} ETH   (the RPC's own execution)", eth(nv));
    println!("  state reads   {} RPC fetches (code + slots the call touched)", db.calls.borrow());
    println!("{bar}");
    if lv == nv && lv != U256::ZERO {
        println!("  ✅ MATCH — our local EVM reproduced the node's result from raw state.");
        println!("     We no longer need to trust eth_call; we can execute invariants ourselves.");
    } else {
        println!("  ❌ MISMATCH — local {lv} vs node {nv}");
        std::process::exit(1);
    }
    println!("{bar}");
}

// redde-reexec — re-execution tier, slice 2 (B1): EXECUTE the redemption, don't read the price.
//
// B0 proved the harness (local revm == node eth_call). B1 shows what execution reaches
// that a static read cannot: it SIMULATES redeem() for a real holder against forked
// mainnet state and observes whether the assets actually come out. A vault's exchange
// rate / convertToAssets can read perfectly healthy while redeem() reverts (cooldown,
// pause, illiquidity) — you only learn that by executing the withdrawal path.
//
//   ETH_RPC_URL=<L1> node target: sDAI (liquid) + sUSDe (cooldown), redemption simulated.
// Zero cloud deps beyond revm + a blocking JSON-RPC client. RPC key via ETH_RPC_URL.

use std::cell::RefCell;
use std::collections::HashMap;
use std::str::FromStr;

use revm::bytecode::Bytecode;
use revm::context::result::{ExecutionResult, Output};
use revm::context::TxEnv;
use revm::database_interface::{DBErrorMarker, DatabaseRef, WrapDatabaseRef};
use revm::primitives::{keccak256, Address, Bytes, TxKind, B256, KECCAK_EMPTY, U256};
use revm::state::AccountInfo;
use revm::{Context, ExecuteEvm, MainBuilder, MainContext};

// ── error ───────────────────────────────────────────────────────────────────
#[derive(Debug)]
struct DbError(String);
impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}", self.0) }
}
impl std::error::Error for DbError {}
impl DBErrorMarker for DbError {}

// ── revm DatabaseRef backed by a pinned-block JSON-RPC endpoint ───────────────
struct RpcDb {
    url: String,
    block: String,
    accounts: RefCell<HashMap<Address, AccountInfo>>,
    storage: RefCell<HashMap<(Address, U256), U256>>,
    code: RefCell<HashMap<B256, Bytecode>>,
}
impl RpcDb {
    fn new(url: String, block: String) -> Self {
        RpcDb { url, block, accounts: RefCell::new(HashMap::new()),
            storage: RefCell::new(HashMap::new()), code: RefCell::new(HashMap::new()) }
    }
    fn rpc(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, DbError> {
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
    fn nonce_of(&self, a: Address) -> u64 {
        let v = self.rpc("eth_getTransactionCount", serde_json::json!([format!("{a:#x}"), self.block])).unwrap_or(serde_json::json!("0x0"));
        u64::from_str_radix(v.as_str().unwrap_or("0x0").trim_start_matches("0x"), 16).unwrap_or(0)
    }
}
impl DatabaseRef for RpcDb {
    type Error = DbError;
    fn basic_ref(&self, address: Address) -> Result<Option<AccountInfo>, DbError> {
        if let Some(a) = self.accounts.borrow().get(&address) { return Ok(Some(a.clone())); }
        let addr = format!("{address:#x}");
        let bal = Self::hex_u256(&self.rpc("eth_getBalance", serde_json::json!([addr, self.block]))?);
        let nv = self.rpc("eth_getTransactionCount", serde_json::json!([addr, self.block]))?;
        let nonce = u64::from_str_radix(nv.as_str().unwrap_or("0x0").trim_start_matches("0x"), 16).unwrap_or(0);
        let cv = self.rpc("eth_getCode", serde_json::json!([addr, self.block]))?;
        let ch = cv.as_str().unwrap_or("0x").trim_start_matches("0x");
        let info = if ch.is_empty() {
            AccountInfo::new(bal, nonce, KECCAK_EMPTY, Bytecode::default())
        } else {
            let raw = hex::decode(ch).map_err(|e| DbError(format!("code hex: {e}")))?;
            let bc = Bytecode::new_raw(Bytes::from(raw));
            let h = bc.hash_slow();
            self.code.borrow_mut().insert(h, bc.clone());
            AccountInfo::new(bal, nonce, h, bc)
        };
        self.accounts.borrow_mut().insert(address, info.clone());
        Ok(Some(info))
    }
    fn code_by_hash_ref(&self, h: B256) -> Result<Bytecode, DbError> {
        self.code.borrow().get(&h).cloned().ok_or_else(|| DbError(format!("code miss {h:#x}")))
    }
    fn storage_ref(&self, address: Address, index: U256) -> Result<U256, DbError> {
        if let Some(v) = self.storage.borrow().get(&(address, index)) { return Ok(*v); }
        let v = Self::hex_u256(&self.rpc("eth_getStorageAt",
            serde_json::json!([format!("{address:#x}"), format!("0x{index:x}"), self.block]))?);
        self.storage.borrow_mut().insert((address, index), v);
        Ok(v)
    }
    fn block_hash_ref(&self, _n: u64) -> Result<B256, DbError> { Ok(B256::ZERO) }
}

// ── abi helpers ───────────────────────────────────────────────────────────────
fn sel(sig: &str) -> [u8; 4] { let h = keccak256(sig.as_bytes()); [h[0], h[1], h[2], h[3]] }
fn word_u256(x: U256) -> [u8; 32] { x.to_be_bytes() }
fn word_addr(a: Address) -> [u8; 32] { let mut w = [0u8; 32]; w[12..].copy_from_slice(a.as_slice()); w }
fn calldata(s: [u8; 4], words: &[[u8; 32]]) -> Bytes {
    let mut v = s.to_vec(); for w in words { v.extend_from_slice(w); } Bytes::from(v)
}
fn ret_u256(b: &Bytes) -> U256 { if b.len() >= 32 { U256::from_be_slice(&b[..32]) } else { U256::ZERO } }

// ── execute a call in a fresh local revm over the RPC-backed state ─────────────
fn exec(db: &RpcDb, caller: Address, nonce: u64, target: Address, data: Bytes) -> Result<ExecutionResult, String> {
    // simulate like eth_call: a holder may be a contract, so lift the tx-pool-only checks
    // (EIP-3607 code-sender, base fee, nonce, balance). We are testing whether redeem's
    // LOGIC honors the claim, not whether this exact tx would be minable.
    let mut evm = Context::mainnet()
        .with_db(WrapDatabaseRef(db))
        .modify_cfg_chained(|c| {
            c.disable_eip3607 = true;
            c.disable_base_fee = true;
            c.disable_nonce_check = true;
            c.disable_balance_check = true;
        })
        .build_mainnet();
    let tx = TxEnv::builder().caller(caller).nonce(nonce)
        .kind(TxKind::Call(target)).data(data).gas_limit(60_000_000).gas_price(0).build_fill();
    evm.transact_one(tx).map_err(|e| format!("{e:?}"))
}
// a read via the node's eth_call (used for the "price" side and holder discovery)
fn node_call_u256(db: &RpcDb, target: Address, data: &Bytes) -> U256 {
    let d = format!("0x{}", hex::encode(data));
    match db.rpc("eth_call", serde_json::json!([{ "to": format!("{target:#x}"), "data": d }, db.block])) {
        Ok(v) => { let s = v.as_str().unwrap_or("0x").trim_start_matches("0x");
            if s.is_empty() { U256::ZERO } else { U256::from_str_radix(s, 16).unwrap_or(U256::ZERO) } }
        Err(_) => U256::ZERO,
    }
}
fn decode_revert(b: &Bytes) -> String {
    if b.len() >= 68 && b[0..4] == [0x08, 0xc3, 0x79, 0xa0] {
        let mut l = [0u8; 8]; l.copy_from_slice(&b[60..68]);
        let len = u64::from_be_bytes(l) as usize;
        if b.len() >= 68 + len { return format!("\"{}\"", String::from_utf8_lossy(&b[68..68 + len])); }
    }
    if b.len() >= 4 {
        // name known custom errors by re-deriving their selectors (no hardcoded 4-bytes)
        let known = ["OperationNotAllowed()", "ExcessiveRedeemAmount()", "ExcessiveWithdrawAmount()",
            "InvalidCooldown()", "MinSharesViolation()", "EnforcedPause()"];
        for sig in known {
            if b[0..4] == sel(sig) { return format!("{sig}"); }
        }
        format!("custom error 0x{}", hex::encode(&b[0..4]))
    } else { "no data".into() }
}

// ── find a real current holder of `vault` via recent Transfer logs ─────────────
// Free-tier eth_getLogs caps the range at 10 blocks, so scan recent 10-block windows
// for Transfer recipients and keep the largest current holder found.
fn find_holder(db: &RpcDb, vault: Address, latest: u64) -> Option<(Address, U256)> {
    let topic = format!("0x{}", hex::encode(keccak256(b"Transfer(address,address,uint256)").as_slice()));
    let bal_sel = sel("balanceOf(address)");
    let mut best: Option<(Address, U256)> = None;
    let mut seen = std::collections::HashSet::new();
    for w in 0..40u64 {
        let to_b = latest.saturating_sub(10 * w);
        let from_b = to_b.saturating_sub(9);
        let logs = match db.rpc("eth_getLogs", serde_json::json!([{
            "address": format!("{vault:#x}"), "fromBlock": format!("0x{from_b:x}"),
            "toBlock": format!("0x{to_b:x}"), "topics": [topic] }])) {
            Ok(v) => v, Err(_) => continue,
        };
        if let Some(arr) = logs.as_array() {
            for lg in arr.iter().rev() {
                let topics = match lg.get("topics").and_then(|t| t.as_array()) { Some(t) if t.len() >= 3 => t, _ => continue };
                // consider both sender and recipient of each Transfer as candidate holders
                for ti in [1usize, 2] {
                    let bytes = hex::decode(topics[ti].as_str().unwrap_or("").trim_start_matches("0x")).unwrap_or_default();
                    if bytes.len() != 32 { continue; }
                    let addr = Address::from_slice(&bytes[12..]);
                    if addr == Address::ZERO || !seen.insert(addr) { continue; }
                    let bal = node_call_u256(db, vault, &calldata(bal_sel, &[word_addr(addr)]));
                    if bal > best.as_ref().map(|b| b.1).unwrap_or(U256::ZERO) { best = Some((addr, bal)); }
                }
            }
        }
        // stop once we've found a non-dust holder and scanned several windows
        if w >= 6 { if let Some(b) = &best { if b.1 > U256::ZERO { break; } } }
        if seen.len() >= 80 { break; }
    }
    best.filter(|b| b.1 > U256::ZERO)
}

fn fmt_amt(x: U256, dec: u32) -> String {
    let unit = U256::from(10u64).pow(U256::from(dec));
    format!("{}.{:03}", x / unit, (x % unit) * U256::from(1000) / unit)
}

// ── simulate a full redemption and report whether the assets actually come out ─
fn simulate_redeem(db: &RpcDb, name: &str, vault: Address, dec: u32, latest: u64) {
    let bar = "─".repeat(74);
    println!("{bar}\n  {name}   ({vault:#x})");
    let (holder, shares) = match find_holder(db, vault, latest) {
        Some(h) => h, None => { println!("  ⚠️  no current holder found in recent logs — skipped"); return; }
    };
    // the READ a naive user would trust:
    let preview = node_call_u256(db, vault, &calldata(sel("previewRedeem(uint256)"), &[word_u256(shares)]));
    println!("  holder        {holder:#x}");
    println!("  shares        {}", fmt_amt(shares, dec));
    println!("  previewRedeem {} (what the READ promises)", fmt_amt(preview, dec));

    // the EXECUTION: actually run redeem(shares, holder, holder) as the holder.
    let nonce = db.nonce_of(holder);
    let data = calldata(sel("redeem(uint256,address,address)"),
        &[word_u256(shares), word_addr(holder), word_addr(holder)]);
    match exec(db, holder, nonce, vault, data) {
        Ok(ExecutionResult::Success { output: Output::Call(b), gas_used, .. }) => {
            let actual = ret_u256(&b);
            println!("  redeem()      {} (what EXECUTION delivers, gas {gas_used})", fmt_amt(actual, dec));
            // tolerate sub-basis-point rounding (previewRedeem vs redeem round at different
            // points); only a MATERIAL shortfall is a finding — never cry RED on dust.
            let shortfall = preview.saturating_sub(actual);
            let material = shortfall * U256::from(10_000) > preview; // > 1 basis point (0.01%)
            if actual >= preview {
                println!("  ✅ GREEN — redemption executes and delivers ≥ the promised amount.");
                println!("     Not read, EXECUTED: the assets actually leave the vault.");
            } else if !material {
                println!("  ✅ GREEN — redemption executes and delivers the promised amount");
                println!("     (short by {} — sub-basis-point rounding, not leakage).", fmt_amt(shortfall, dec));
            } else {
                println!("  🔴 RED — redeem delivered materially LESS than previewRedeem promised");
                println!("     (short by {} = undisclosed fee / leakage / ERC-4626 violation).", fmt_amt(shortfall, dec));
            }
        }
        Ok(ExecutionResult::Revert { output, .. }) => {
            println!("  redeem()      REVERTED — {}", decode_revert(&output));
            println!("  🟠 FINDING — the price reads healthy, but you cannot actually redeem right now.");
            println!("     A static read would have told you nothing. Execution reveals it.");
        }
        Ok(ExecutionResult::Halt { reason, .. }) => println!("  redeem()      HALT — {reason:?}"),
        Ok(ExecutionResult::Success { .. }) => println!("  redeem()      unexpected CREATE output"),
        Err(e) => println!("  redeem()      tx error — {e}"),
    }
}

fn main() {
    let url = std::env::var("ETH_RPC_URL").unwrap_or_else(|_| "https://eth.llamarpc.com".into());
    let probe = RpcDb::new(url.clone(), "latest".into());
    let blk = probe.rpc("eth_blockNumber", serde_json::json!([])).expect("blockNumber");
    let block = blk.as_str().unwrap().to_string();
    let latest = u64::from_str_radix(block.trim_start_matches("0x"), 16).unwrap();
    let db = RpcDb::new(url, block.clone());

    println!("Redde · re-execution tier · slice 2 B1 (simulate the redemption)   block {latest}");
    println!("The read is the price. The verdict is what redeem() actually does.");

    let susds = Address::from_str("0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD").unwrap();
    let susde = Address::from_str("0x9D39A5DE30e57443BfF2A8307A4256c8797A3497").unwrap();
    simulate_redeem(&db, "sUSDS (Sky Savings USDS, ERC-4626)", susds, 18, latest);
    simulate_redeem(&db, "sUSDe (Ethena staked USDe, ERC-4626 + cooldown)", susde, 18, latest);
    println!("{}", "─".repeat(74));
}

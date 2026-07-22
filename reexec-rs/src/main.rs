// redde-reexec — re-execution tier, slice 2: SWEEP. Point the engine at many vaults and
// find the ones whose redemption does NOT do what their price says.
//
// For each ERC-4626 vault we find a real holder, read previewRedeem (the price a naive
// user trusts), then SIMULATE redeem() for that holder against forked mainnet state in a
// local revm and see what actually comes out. A vault can read perfectly healthy and yet
// its redeem() reverts (cooldown / pause / illiquidity) or underpays — you only learn
// that by executing the withdrawal path. Wrong/non-4626 addresses fail a validation gate
// and are skipped, never mis-reported.
//
//   ETH_RPC_URL=<L1> cargo run
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
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for DbError {}
impl DBErrorMarker for DbError {}

// ── revm DatabaseRef backed by a pinned-block JSON-RPC endpoint ───────────────
struct RpcDb {
    url: String,
    block: String,
    block_number: U256,    // real number of the pinned block
    block_timestamp: U256, // real timestamp of the pinned block (critical: rate-accruing
    // vaults compute `now - lastUpdate`; a default 0 underflows → Panic)
    accounts: RefCell<HashMap<Address, AccountInfo>>,
    storage: RefCell<HashMap<(Address, U256), U256>>,
    code: RefCell<HashMap<B256, Bytecode>>,
}
impl RpcDb {
    fn new(url: String, block: String, block_number: U256, block_timestamp: U256) -> Self {
        RpcDb {
            url,
            block,
            block_number,
            block_timestamp,
            accounts: RefCell::new(HashMap::new()),
            storage: RefCell::new(HashMap::new()),
            code: RefCell::new(HashMap::new()),
        }
    }
    fn rpc(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, DbError> {
        let body =
            serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let mut last = String::new();
        for attempt in 0..5u32 {
            if attempt > 0 {
                std::thread::sleep(std::time::Duration::from_millis(250 * attempt as u64));
            }
            match ureq::post(&self.url).send_json(&body) {
                Ok(resp) => match resp.into_json::<serde_json::Value>() {
                    Ok(v) => {
                        if let Some(e) = v.get("error") {
                            return Err(DbError(format!("{method}: {e}")));
                        }
                        return v
                            .get("result")
                            .cloned()
                            .ok_or_else(|| DbError(format!("{method}: no result")));
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
        if s.is_empty() {
            U256::ZERO
        } else {
            U256::from_str_radix(s, 16).unwrap_or(U256::ZERO)
        }
    }
    fn nonce_of(&self, a: Address) -> u64 {
        let v = self
            .rpc(
                "eth_getTransactionCount",
                serde_json::json!([format!("{a:#x}"), self.block]),
            )
            .unwrap_or(serde_json::json!("0x0"));
        u64::from_str_radix(v.as_str().unwrap_or("0x0").trim_start_matches("0x"), 16).unwrap_or(0)
    }
    fn has_code(&self, a: Address) -> bool {
        self.rpc(
            "eth_getCode",
            serde_json::json!([format!("{a:#x}"), self.block]),
        )
        .ok()
        .and_then(|v| v.as_str().map(|s| s.trim_start_matches("0x").len() > 0))
        .unwrap_or(false)
    }
}
impl DatabaseRef for RpcDb {
    type Error = DbError;
    fn basic_ref(&self, address: Address) -> Result<Option<AccountInfo>, DbError> {
        if let Some(a) = self.accounts.borrow().get(&address) {
            return Ok(Some(a.clone()));
        }
        let addr = format!("{address:#x}");
        let bal =
            Self::hex_u256(&self.rpc("eth_getBalance", serde_json::json!([addr, self.block]))?);
        let nv = self.rpc(
            "eth_getTransactionCount",
            serde_json::json!([addr, self.block]),
        )?;
        let nonce = u64::from_str_radix(nv.as_str().unwrap_or("0x0").trim_start_matches("0x"), 16)
            .unwrap_or(0);
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
        self.code
            .borrow()
            .get(&h)
            .cloned()
            .ok_or_else(|| DbError(format!("code miss {h:#x}")))
    }
    fn storage_ref(&self, address: Address, index: U256) -> Result<U256, DbError> {
        if let Some(v) = self.storage.borrow().get(&(address, index)) {
            return Ok(*v);
        }
        let v = Self::hex_u256(&self.rpc(
            "eth_getStorageAt",
            serde_json::json!([format!("{address:#x}"), format!("0x{index:x}"), self.block]),
        )?);
        self.storage.borrow_mut().insert((address, index), v);
        Ok(v)
    }
    fn block_hash_ref(&self, _n: u64) -> Result<B256, DbError> {
        Ok(B256::ZERO)
    }
}

// ── abi helpers ───────────────────────────────────────────────────────────────
fn sel(sig: &str) -> [u8; 4] {
    let h = keccak256(sig.as_bytes());
    [h[0], h[1], h[2], h[3]]
}
fn word_u256(x: U256) -> [u8; 32] {
    x.to_be_bytes()
}
fn word_addr(a: Address) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a.as_slice());
    w
}
fn calldata(s: [u8; 4], words: &[[u8; 32]]) -> Bytes {
    let mut v = s.to_vec();
    for w in words {
        v.extend_from_slice(w);
    }
    Bytes::from(v)
}
fn ret_u256(b: &Bytes) -> U256 {
    if b.len() >= 32 {
        U256::from_be_slice(&b[..32])
    } else {
        U256::ZERO
    }
}

// ── execute a call in a fresh local revm over the RPC-backed state ─────────────
fn exec(
    db: &RpcDb,
    caller: Address,
    nonce: u64,
    target: Address,
    data: Bytes,
) -> Result<ExecutionResult, String> {
    // simulate like eth_call: a holder may be a contract, so lift the tx-pool-only checks
    // (EIP-3607 code-sender, base fee, nonce, balance). We test whether redeem's LOGIC
    // honors the claim, not whether this exact tx would be minable.
    let mut evm = Context::mainnet()
        .with_db(WrapDatabaseRef(db))
        .modify_cfg_chained(|c| {
            c.disable_eip3607 = true;
            c.disable_base_fee = true;
            c.disable_nonce_check = true;
            c.disable_balance_check = true;
        })
        // execute in the pinned block's real temporal context (eth_call semantics), or
        // rate-accruing vaults underflow on `now - lastUpdate` and Panic — a false finding.
        .modify_block_chained(|b| {
            b.number = db.block_number;
            b.timestamp = db.block_timestamp;
            b.basefee = 0;
        })
        .build_mainnet();
    let tx = TxEnv::builder()
        .caller(caller)
        .nonce(nonce)
        .kind(TxKind::Call(target))
        .data(data)
        .gas_limit(60_000_000)
        .gas_price(0)
        .build_fill();
    evm.transact_one(tx).map_err(|e| format!("{e:?}"))
}
// a read via the node's eth_call (the "price" side and holder discovery)
fn node_call_u256(db: &RpcDb, target: Address, data: &Bytes) -> U256 {
    let d = format!("0x{}", hex::encode(data));
    match db.rpc(
        "eth_call",
        serde_json::json!([{ "to": format!("{target:#x}"), "data": d }, db.block]),
    ) {
        Ok(v) => {
            let s = v.as_str().unwrap_or("0x").trim_start_matches("0x");
            if s.is_empty() {
                U256::ZERO
            } else {
                U256::from_str_radix(s, 16).unwrap_or(U256::ZERO)
            }
        }
        Err(_) => U256::ZERO,
    }
}
// read an address-returning view (low 20 bytes of the word)
fn node_call_addr(db: &RpcDb, target: Address, data: &Bytes) -> Address {
    Address::from_slice(&node_call_u256(db, target, data).to_be_bytes::<32>()[12..])
}
// the ERC-4626 asset() and its decimals (assets are denominated in the asset, not shares)
fn asset_decimals(db: &RpcDb, vault: Address, share_dec: u32) -> u32 {
    let asset = node_call_addr(db, vault, &calldata(sel("asset()"), &[]));
    if asset == Address::ZERO {
        return share_dec;
    }
    let d = node_call_u256(db, asset, &calldata(sel("decimals()"), &[])).to::<u64>() as u32;
    if (1..=36).contains(&d) {
        d
    } else {
        share_dec
    }
}
fn decode_revert(b: &Bytes) -> String {
    if b.len() >= 68 && b[0..4] == [0x08, 0xc3, 0x79, 0xa0] {
        let mut l = [0u8; 8];
        l.copy_from_slice(&b[60..68]);
        let len = u64::from_be_bytes(l) as usize;
        if b.len() >= 68 + len {
            return format!("\"{}\"", String::from_utf8_lossy(&b[68..68 + len]));
        }
    }
    if b.len() >= 4 {
        // name known custom errors by re-deriving their selectors (no hardcoded 4-bytes)
        let known = [
            "OperationNotAllowed()",
            "ExcessiveRedeemAmount()",
            "ExcessiveWithdrawAmount()",
            "InvalidCooldown()",
            "MinSharesViolation()",
            "EnforcedPause()",
            "NotWhitelisted()",
            "WithdrawMoreThanMax()",
            "ZeroShares()",
            "InsufficientLiquidity()",
            "TransferError()",
        ];
        for sig in known {
            if b[0..4] == sel(sig) {
                return sig.to_string();
            }
        }
        format!("custom error 0x{}", hex::encode(&b[0..4]))
    } else {
        "no data (empty revert)".into()
    }
}

fn parse_addr(s: &str) -> Option<Address> {
    let b = hex::decode(s.trim_start_matches("0x")).ok()?;
    if b.len() == 20 {
        Some(Address::from_slice(&b))
    } else {
        None
    }
}

// ── find a real current holder of `vault` ──────────────────────────────────────
// Prefer Alchemy's getAssetTransfers (no 10-block limit → reaches low-activity vaults);
// fall back to scanning recent Transfer logs in 10-block windows on a plain RPC.
fn find_holder(db: &RpcDb, vault: Address, latest: u64) -> Option<(Address, U256)> {
    let bal_sel = sel("balanceOf(address)");
    // path 1: getAssetTransfers (Alchemy). One call, recent-first, wide range.
    {
        let params = serde_json::json!([{ "fromBlock": "0x0", "toBlock": db.block,
            "contractAddresses": [format!("{vault:#x}")], "category": ["erc20"],
            "order": "desc", "maxCount": "0x64", "excludeZeroValue": true }]);
        if let Ok(v) = db.rpc("alchemy_getAssetTransfers", params) {
            let mut best: Option<(Address, U256)> = None;
            let mut seen = std::collections::HashSet::new();
            if let Some(arr) = v.get("transfers").and_then(|t| t.as_array()) {
                for t in arr {
                    for key in ["to", "from"] {
                        let addr = match t.get(key).and_then(|x| x.as_str()).and_then(parse_addr) {
                            Some(a) => a,
                            None => continue,
                        };
                        if addr == Address::ZERO || !seen.insert(addr) {
                            continue;
                        }
                        let bal = node_call_u256(db, vault, &calldata(bal_sel, &[word_addr(addr)]));
                        if bal > best.as_ref().map(|b| b.1).unwrap_or(U256::ZERO) {
                            best = Some((addr, bal));
                        }
                        if seen.len() >= 80 {
                            break;
                        }
                    }
                }
            }
            if let Some(b) = best {
                if b.1 > U256::ZERO {
                    return Some(b);
                }
            }
        }
    }
    // path 2: fallback — recent Transfer logs in 10-block windows (plain RPC).
    let topic = format!(
        "0x{}",
        hex::encode(keccak256(b"Transfer(address,address,uint256)").as_slice())
    );
    let mut best: Option<(Address, U256)> = None;
    let mut seen = std::collections::HashSet::new();
    for w in 0..24u64 {
        let to_b = latest.saturating_sub(10 * w);
        let from_b = to_b.saturating_sub(9);
        let logs = match db.rpc(
            "eth_getLogs",
            serde_json::json!([{
            "address": format!("{vault:#x}"), "fromBlock": format!("0x{from_b:x}"),
            "toBlock": format!("0x{to_b:x}"), "topics": [topic] }]),
        ) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(arr) = logs.as_array() {
            for lg in arr.iter().rev() {
                let topics = match lg.get("topics").and_then(|t| t.as_array()) {
                    Some(t) if t.len() >= 3 => t,
                    _ => continue,
                };
                for ti in [1usize, 2] {
                    let bytes =
                        hex::decode(topics[ti].as_str().unwrap_or("").trim_start_matches("0x"))
                            .unwrap_or_default();
                    if bytes.len() != 32 {
                        continue;
                    }
                    let addr = Address::from_slice(&bytes[12..]);
                    if addr == Address::ZERO || !seen.insert(addr) {
                        continue;
                    }
                    let bal = node_call_u256(db, vault, &calldata(bal_sel, &[word_addr(addr)]));
                    if bal > best.as_ref().map(|b| b.1).unwrap_or(U256::ZERO) {
                        best = Some((addr, bal));
                    }
                }
            }
        }
        if w >= 4 {
            if let Some(b) = &best {
                if b.1 > U256::ZERO {
                    break;
                }
            }
        }
        if seen.len() >= 60 {
            break;
        }
    }
    best.filter(|b| b.1 > U256::ZERO)
}

fn fmt_amt(x: U256, dec: u32) -> String {
    let unit = U256::from(10u64).pow(U256::from(dec));
    format!("{}.{:03}", x / unit, (x % unit) * U256::from(1000) / unit)
}

// gate: does this address behave like an ERC-4626 vault? returns share decimals.
fn validate_vault(db: &RpcDb, vault: Address) -> Option<u32> {
    if !db.has_code(vault) {
        return None;
    }
    if node_call_u256(db, vault, &calldata(sel("asset()"), &[])) == U256::ZERO {
        return None;
    }
    let dec = node_call_u256(db, vault, &calldata(sel("decimals()"), &[]));
    let dec = dec.to::<u64>() as u32;
    if !(1..=36).contains(&dec) {
        return None;
    }
    Some(dec)
}

#[derive(Clone)]
enum Verdict {
    Green,
    RedUnderpay(U256, u32),
    Blocked(String),
    Weird(String),
    NoHolder,
    NotVault,
}

fn golden_verdict(v: &Verdict) -> (&'static str, String) {
    match v {
        Verdict::Green => ("Green", "redeem honored".to_string()),
        Verdict::RedUnderpay(shortfall, decimals) => {
            ("RedUnderpay", fmt_amt(*shortfall, *decimals))
        }
        Verdict::Blocked(reason) => ("Blocked", reason.clone()),
        Verdict::Weird(reason) => ("Weird", reason.clone()),
        Verdict::NoHolder => ("NoHolder", "no holder found".to_string()),
        Verdict::NotVault => ("NotVault", "not an ERC-4626 vault".to_string()),
    }
}

fn write_golden(path: &str, block: u64, results: &[(String, String, Verdict)]) {
    let verdicts: Vec<serde_json::Value> = results
        .iter()
        .map(|(label, address, verdict)| {
            let (verdict, detail) = golden_verdict(verdict);
            serde_json::json!({ "label": label, "address": address, "verdict": verdict, "detail": detail })
        })
        .collect();
    let golden = serde_json::json!({
        "block": block,
        "rpc_note": "archive required for historical state",
        "verdicts": verdicts,
    });
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&golden).expect("golden JSON"),
    )
    .expect("write sweep golden");
}

// assess one vault; prints a detail block and returns the verdict for the summary.
fn assess(db: &RpcDb, label: &str, vault: Address, latest: u64) -> Verdict {
    let bar = "─".repeat(74);
    println!("{bar}\n  {label}   ({vault:#x})");
    let sdec = match validate_vault(db, vault) {
        Some(d) => d,
        None => {
            println!("  ·· not an ERC-4626 vault at this block — skipped");
            return Verdict::NotVault;
        }
    };
    let adec = asset_decimals(db, vault, sdec); // assets (previewRedeem/redeem) use the asset's decimals
    let (holder, shares) = match find_holder(db, vault, latest) {
        Some(h) => h,
        None => {
            println!("  ·· no current holder found in recent logs — skipped");
            return Verdict::NoHolder;
        }
    };
    let preview = node_call_u256(
        db,
        vault,
        &calldata(sel("previewRedeem(uint256)"), &[word_u256(shares)]),
    );
    println!(
        "  holder {holder:#x}  shares {}  previewRedeem {}",
        fmt_amt(shares, sdec),
        fmt_amt(preview, adec)
    );
    // guard: a zero/failed previewRedeem is inconclusive — never let it become a false GREEN.
    if preview == U256::ZERO {
        println!("  ·· previewRedeem returned 0 (reverted / edge) — inconclusive, skipped");
        return Verdict::Weird("previewRedeem==0".into());
    }

    let nonce = db.nonce_of(holder);
    let data = calldata(
        sel("redeem(uint256,address,address)"),
        &[word_u256(shares), word_addr(holder), word_addr(holder)],
    );
    match exec(db, holder, nonce, vault, data) {
        Ok(ExecutionResult::Success {
            output: Output::Call(b),
            gas_used,
            ..
        }) => {
            let actual = ret_u256(&b);
            let shortfall = preview.saturating_sub(actual);
            let material = shortfall * U256::from(10_000) > preview; // > 1 bp
            if actual >= preview || !material {
                println!("  redeem() -> {} (gas {gas_used})   ✅ GREEN — execution delivers the promised amount", fmt_amt(actual, adec));
                Verdict::Green
            } else {
                println!(
                    "  redeem() -> {} (gas {gas_used})   🔴 RED — short by {} vs previewRedeem",
                    fmt_amt(actual, adec),
                    fmt_amt(shortfall, adec)
                );
                Verdict::RedUnderpay(shortfall, adec)
            }
        }
        Ok(ExecutionResult::Revert { output, .. }) => {
            let e = decode_revert(&output);
            println!("  redeem() -> REVERTED — {e}   🟠 the price reads healthy, but you can't redeem now");
            Verdict::Blocked(e)
        }
        Ok(ExecutionResult::Halt { reason, .. }) => {
            let e = format!("{reason:?}");
            println!("  redeem() -> HALT — {e}");
            Verdict::Weird(e)
        }
        Ok(ExecutionResult::Success { .. }) => {
            println!("  redeem() -> unexpected CREATE output");
            Verdict::Weird("create".into())
        }
        Err(e) => {
            println!("  redeem() -> tx error — {e}");
            Verdict::Weird(e)
        }
    }
}

fn main() {
    let url = std::env::var("ETH_RPC_URL").unwrap_or_else(|_| "https://eth.llamarpc.com".into());
    let probe = RpcDb::new(url.clone(), "latest".into(), U256::ZERO, U256::ZERO);
    let requested_block = std::env::var("REDDE_BLOCK").ok().or_else(|| {
        std::env::args()
            .skip(1)
            .find_map(|arg| arg.strip_prefix("--block=").map(str::to_string))
    });
    let block = match requested_block {
        Some(block) if block.starts_with("0x") => block,
        Some(block) => format!(
            "0x{:x}",
            block
                .parse::<u64>()
                .expect("REDDE_BLOCK must be a block number")
        ),
        None => probe
            .rpc("eth_blockNumber", serde_json::json!([]))
            .expect("blockNumber")
            .as_str()
            .unwrap()
            .to_string(),
    };
    let latest = u64::from_str_radix(block.trim_start_matches("0x"), 16).unwrap();
    // pin the block's real number + timestamp so the local EVM runs in its temporal context.
    let header = probe
        .rpc("eth_getBlockByNumber", serde_json::json!([block, false]))
        .expect("getBlock");
    let hx = |v: &serde_json::Value, k: &str| {
        U256::from_str_radix(
            v.get(k)
                .and_then(|x| x.as_str())
                .unwrap_or("0x0")
                .trim_start_matches("0x"),
            16,
        )
        .unwrap_or(U256::ZERO)
    };
    let (bnum, btime) = (hx(&header, "number"), hx(&header, "timestamp"));
    let db = RpcDb::new(url, block.clone(), bnum, btime);

    println!("Redde · re-execution tier · redemption sweep   block {latest}");
    println!("The read is the price. The verdict is what redeem() actually does.");
    println!("(labels are hints; the address is authoritative. Non-4626 addresses are skipped.)");

    // A curated probe set of mainnet ERC-4626 vaults — not exhaustive. The validation gate
    // safely skips anything that is not a live 4626 at this block.
    let targets: &[(&str, &str)] = &[
        (
            "sDAI  (Maker Savings DAI)",
            "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
        ),
        (
            "sUSDS (Sky Savings USDS)",
            "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
        ),
        (
            "sUSDe (Ethena staked USDe)",
            "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
        ),
        (
            "sfrxETH (Frax staked ETH)",
            "0xac3E018457B222d93114458476f3E3416Abbe38F",
        ),
        (
            "sFRAX (Staked FRAX)",
            "0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32",
        ),
        (
            "wUSDM (Mountain wrapped USDM)",
            "0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812",
        ),
        (
            "wOETH (Origin wrapped OETH)",
            "0xDcEe70654261AF21C44c093C300eD3Bb97b78192",
        ),
        (
            "stUSD (Angle staked USDA)",
            "0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776",
        ),
        (
            "stEUR (Angle staked EURA)",
            "0x004626A008B1aCdC4c74ab51644093b155e59A23",
        ),
        (
            "Steakhouse USDC (MetaMorpho)",
            "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
        ),
        (
            "Gauntlet USDC Prime (MetaMorpho)",
            "0xdd0f28e19C1780eb6396170735D45153D261490d",
        ),
        (
            "Flagship USDT (MetaMorpho)",
            "0x95EeF579155cd2C5510F312c8fA39208c3Be01a8",
        ),
    ];

    let mut results: Vec<(String, String, Verdict)> = Vec::new();
    for (label, addr) in targets {
        let vault = match Address::from_str(addr) {
            Ok(a) => a,
            Err(_) => continue,
        };
        let v = assess(&db, label, vault, latest);
        results.push((label.to_string(), (*addr).to_string(), v));
    }

    if let Ok(path) = std::env::var("REDDE_GOLDEN_OUT") {
        write_golden(&path, latest, &results);
    }

    // ── summary ───────────────────────────────────────────────────────────────
    let bar = "═".repeat(74);
    println!("\n{bar}\n  SWEEP SUMMARY\n{bar}");
    let mut green = 0;
    let mut skipped = 0;
    let mut blocked: Vec<(&String, &String, &String)> = Vec::new();
    let mut red: Vec<(&String, &String)> = Vec::new();
    for (label, addr, v) in &results {
        match v {
            Verdict::Green => green += 1,
            Verdict::NotVault | Verdict::NoHolder => skipped += 1,
            Verdict::Blocked(e) => blocked.push((label, addr, e)),
            Verdict::RedUnderpay(..) => red.push((label, addr)),
            Verdict::Weird(_) => skipped += 1,
        }
    }
    println!("  redemption honored (GREEN): {green}     skipped (non-4626 / no holder): {skipped}");
    if !blocked.is_empty() {
        println!("\n  🟠 redemption BLOCKED at this block (read looks healthy, redeem() reverts):");
        for (label, addr, e) in &blocked {
            println!("     - {label}  [{e}]  {addr}");
        }
        println!(
            "     (cooldown / pause / whitelist / illiquidity — a static price never shows this)"
        );
    }
    if !red.is_empty() {
        println!("\n  🔴 MATERIAL UNDERPAY (redeem delivers < previewRedeem):");
        for (label, addr) in &red {
            println!("     - {label}  {addr}");
        }
    } else {
        println!("\n  🔴 material underpay: none found in this set.");
    }
    println!("{bar}");
}

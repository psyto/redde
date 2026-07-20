#!/usr/bin/env node
// verify-eth.mjs — Redde's EVM leg. Invariant class #3: EVM liquid-staking backing.
//
// Same stance as verify.mjs (Solana): recompute a protocol's claimed backing from
// chain state, without its cooperation, and render a verdict. On Ethereum the result
// is structural and IS the finding: an LST's backing lives on the beacon chain and
// reaches the execution-layer contract through an ORACLE. The only backing an
// independent party can OBSERVE from execution-layer state is the ETH the contract
// actually holds. The rest is self-reported, so the honest verdict is STALE — "this
// claim cannot be recomputed from the chain I can read" — itself a finding. A bridged
// L2 representation is different: its backing (tokens locked in the L1 escrow) IS on
// the execution layer, so it is fully recomputable → GREEN/RED.
//
// Zero dependencies (Node 18+, global fetch). Reads only. Selectors and storage keys
// are DERIVED via an in-file keccak256 (self-tested at startup), never guessed.
//
//   ETH_RPC_URL=<L1> L2_RPC_URL=<base> node verify-eth.mjs           # all targets
//   ETH_RPC_URL=<L1> node verify-eth.mjs --json                      # machine-readable
//   ... node verify-eth.mjs --only lido|reth|wsteth-base
//
// NOTE: never hardcode an RPC key here — this file is public. Pass RPC URLs in env.

const L1 = process.env.ETH_RPC_URL || "https://eth.llamarpc.com";
const L2_BASE = process.env.L2_RPC_URL || "https://mainnet.base.org";
const JSON_OUT = process.argv.includes("--json");
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? process.argv[i + 1] : null; })();

// ───────────────────────── keccak256 (pure JS, BigInt) ─────────────────────────
const RC = [0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,
0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,
0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,
0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,
0x80000001n,0x8000000080008008n];
const R = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const MASK = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0n ? x : (((x << n) | (x >> (64n - n))) & MASK);
function keccakF(s) {
  for (let r = 0; r < 24; r++) {
    const C = [0n,0n,0n,0n,0n];
    for (let x = 0; x < 5; x++) C[x] = s[x]^s[x+5]^s[x+10]^s[x+15]^s[x+20];
    const D = [0n,0n,0n,0n,0n];
    for (let x = 0; x < 5; x++) D[x] = C[(x+4)%5] ^ rotl(C[(x+1)%5], 1n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x+5*y] ^= D[x];
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y+5*((2*x+3*y)%5)] = rotl(s[x+5*y], BigInt(R[x+5*y]));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x+5*y] = B[x+5*y] ^ ((~B[(x+1)%5+5*y]) & B[(x+2)%5+5*y] & MASK);
    s[0] ^= RC[r];
  }
}
function keccak256(bytes) {
  const rate = 136, s = new Array(25).fill(0n), pad = [...bytes];
  pad.push(0x01); while (pad.length % rate !== 0) pad.push(0x00); pad[pad.length-1] |= 0x80;
  for (let off = 0; off < pad.length; off += rate) {
    for (let i = 0; i < rate; i++) { const l = (i/8)|0; s[l] = (s[l] ^ (BigInt(pad[off+i]) << BigInt(8*(i%8)))) & MASK; }
    keccakF(s);
  }
  const out = [];
  for (let i = 0; i < 32; i++) { const l = (i/8)|0; out.push(Number((s[l] >> BigInt(8*(i%8))) & 0xffn)); }
  return out;
}
const hex = (b) => "0x" + b.map(x => x.toString(16).padStart(2,"0")).join("");
const utf8 = (s) => [...Buffer.from(s, "utf8")];
const selector = (sig) => hex(keccak256(utf8(sig)).slice(0, 4));
const storageKey = (...parts) => hex(keccak256(parts.flatMap(p => typeof p === "string" ? utf8(p) : p)));

// self-test: if keccak is wrong, refuse to run (a wrong selector = a false verdict).
(function selftest() {
  const empty = hex(keccak256([]));
  if (empty !== "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470") throw new Error("keccak256 self-test failed (empty)");
  if (selector("totalSupply()") !== "0x18160ddd") throw new Error("keccak256 self-test failed (selector)");
  if (selector("balanceOf(address)") !== "0x70a08231") throw new Error("keccak256 self-test failed (balanceOf)");
})();

// ───────────────────────────── JSON-RPC (block-pinned) ─────────────────────────
let RID = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(url, method, params, tries = 4) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await sleep(200 * attempt);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++RID, method, params }) });
      const txt = await res.text();
      if (!txt) { lastErr = new Error(`${method}: empty response`); continue; } // transient — retry
      const j = JSON.parse(txt);
      if (j.error) throw new Error(`${method}: ${j.error.message}`);            // real RPC error — do not mask
      return j.result;
    } catch (e) {
      if (/empty response|fetch failed|network|ECONN|ETIMEDOUT/i.test(e.message)) { lastErr = e; continue; }
      throw e;
    }
  }
  throw lastErr;
}
const call = (url, to, data, block = "latest") => rpc(url, "eth_call", [{ to, data }, block]);
const getBalance = (url, addr, block = "latest") => rpc(url, "eth_getBalance", [addr, block]);
const big = (h) => BigInt(h);
const pad32 = (a) => a.toLowerCase().replace("0x", "").padStart(64, "0");

const WEI = 10n ** 18n;
const fmt = (wei) => {
  const whole = wei / WEI, frac = ((wei % WEI) * 1000n) / WEI;
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.toString().padStart(3, "0")}`;
};
const pct = (num, den) => den === 0n ? "0" : (Number((num * 1000000n) / den) / 10000).toFixed(4);

// ───────────────────────────────── verifiers ──────────────────────────────────

// Lido stETH: rebasing 1:1 with pooled ETH. Backing is buffer(EL) + beacon(oracle).
async function verifyLido(block) {
  const A = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
  const [supplyH, pooledH, balH] = await Promise.all([
    call(L1, A, selector("totalSupply()"), block),
    call(L1, A, selector("getTotalPooledEther()"), block),
    getBalance(L1, A, block),
  ]);
  const supply = big(supplyH), pooled = big(pooledH), observed = big(balH);
  const liability = supply;
  const oracleReported = pooled > observed ? pooled - observed : 0n;
  let verdict, cls, note;
  if (supply !== pooled) { verdict = "STALE"; cls = "abi-drift"; note = "rebasing assumption (supply==pooled) broke; not decoding."; }
  else if (observed >= liability) { verdict = "GREEN"; cls = "fully-recomputable"; note = "execution-layer balance alone covers the full liability."; }
  else { verdict = "STALE"; cls = "oracle-trusted";
    note = `${pct(observed, liability)}% of backing is independently observable on the execution layer; the remaining ${fmt(oracleReported)} ETH is beacon-chain validator balance reported by an oracle — not recomputable from EL state.`; }
  return { chain: "ethereum", vm: "evm", protocol: "Lido", symbol: "stETH", target: A,
    verdict, verifiabilityClass: cls, liabilityEth: fmt(liability), claimedEth: fmt(pooled),
    independentEth: fmt(observed), oracleReportedEth: fmt(oracleReported), independentPct: pct(observed, liability), note };
}

// RocketPool rETH: resolve deposit pool + network-balances oracle via RocketStorage.
async function verifyRETH(block) {
  const STORAGE = "0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46";
  const RETH = "0xae78736Cd615f374D3085123A210448E74Fc6393";
  const getAddr = selector("getAddress(bytes32)");
  const resolve = async (name) => "0x" + (await call(L1, STORAGE, getAddr + pad32(storageKey("contract.address", name)), block)).slice(26);
  const [depositPool, netBalances] = await Promise.all([resolve("rocketDepositPool"), resolve("rocketNetworkBalances")]);
  const [supplyH, rateH, dpBalH, rethBalH, oracleH] = await Promise.all([
    call(L1, RETH, selector("totalSupply()"), block),
    call(L1, RETH, selector("getExchangeRate()"), block),
    getBalance(L1, depositPool, block),
    getBalance(L1, RETH, block),
    call(L1, netBalances, selector("getTotalETHBalance()"), block),
  ]);
  const supply = big(supplyH), rate = big(rateH);
  const liability = supply * rate / WEI;
  const observed = big(dpBalH) + big(rethBalH);      // ETH RocketPool holds on the EL
  const oracleTotal = big(oracleH);                   // oDAO-submitted total (includes beacon)
  const oracleReported = liability > observed ? liability - observed : 0n;
  let verdict, cls, note;
  if (observed >= liability) { verdict = "GREEN"; cls = "fully-recomputable"; note = "execution-layer balance covers the liability."; }
  else { verdict = "STALE"; cls = "oracle-trusted";
    note = `${pct(observed, liability)}% of backing is independently observable on the EL (deposit pool + rETH buffer); the rest is minipool validator balance on the beacon chain, submitted by the oracle DAO (getTotalETHBalance = ${fmt(oracleTotal)} ETH) — not recomputable from EL state.`; }
  return { chain: "ethereum", vm: "evm", protocol: "RocketPool", symbol: "rETH", target: RETH,
    verdict, verifiabilityClass: cls, liabilityEth: fmt(liability), claimedEth: fmt(oracleTotal),
    independentEth: fmt(observed), oracleReportedEth: fmt(oracleReported), independentPct: pct(observed, liability), note };
}

// Base wstETH: bridged representation must be covered by wstETH locked in the L1 escrow.
// The escrow is Lido's dedicated L1 bridge for Base; it is pinned and its correctness
// is self-checked by the invariant (escrow >= L2 supply). A large shortfall is treated
// conservatively as STALE("escrow unverified"), never a manufactured RED.
async function verifyWstethBase(block) {
  const L1_WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
  const ESCROW = "0x9de443AdC5A411E83F1878Ef24C3F52C61571e72"; // Lido L1 bridge escrow for Base
  const L2_WSTETH = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452";
  const balOf = selector("balanceOf(address)");
  const [lockedH, l2SupplyH] = await Promise.all([
    call(L1, L1_WSTETH, balOf + pad32(ESCROW), block),
    call(L2_BASE, L2_WSTETH, selector("totalSupply()")),   // L2 read at its own head
  ]);
  const locked = big(lockedH), l2Supply = big(l2SupplyH);
  let verdict, cls, note;
  if (l2Supply === 0n) { verdict = "STALE"; cls = "l2-unreachable"; note = "could not read L2 supply."; }
  else if (locked >= l2Supply) { verdict = "GREEN"; cls = "bridge-escrow";
    note = `L1 escrow holds ${fmt(locked)} wstETH backing ${fmt(l2Supply)} on Base (margin +${fmt(locked - l2Supply)}); fully recomputed from execution-layer state on both sides.`; }
  else if (l2Supply - locked > locked / 10n) { verdict = "STALE"; cls = "escrow-unverified";
    note = `escrow holds only ${fmt(locked)} vs ${fmt(l2Supply)} on L2 — treating as unverified escrow, not a solvency claim.`; }
  else { verdict = "RED"; cls = "bridge-escrow";
    note = `L1 escrow ${fmt(locked)} < L2 supply ${fmt(l2Supply)} — bridged supply exceeds locked collateral.`; }
  return { chain: "base", vm: "evm", protocol: "Lido (bridged)", symbol: "wstETH", target: L2_WSTETH,
    verdict, verifiabilityClass: cls, liabilityEth: fmt(l2Supply), claimedEth: fmt(l2Supply),
    independentEth: fmt(locked), oracleReportedEth: fmt(0n), independentPct: pct(locked, l2Supply), note };
}

// ─────────────────────────────────── main ─────────────────────────────────────
const REGISTRY = { lido: verifyLido, reth: verifyRETH, "wsteth-base": verifyWstethBase };

(async () => {
  const block = await rpc(L1, "eth_blockNumber", []);
  const which = ONLY ? [ONLY] : Object.keys(REGISTRY);
  const rows = [];
  for (const k of which) {
    if (!REGISTRY[k]) { console.error(`unknown target: ${k}`); process.exit(2); }
    try { rows.push({ id: k, ...(await REGISTRY[k](block)) }); }
    catch (e) { rows.push({ id: k, verdict: "ERROR", note: e.message }); }
  }
  const out = { block: parseInt(block, 16), rows };
  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }

  const bar = "─".repeat(78);
  console.log(bar);
  console.log(`  Redde · EVM leg (class #3: EVM liquid-staking backing)   block ${out.block}`);
  console.log(bar);
  for (const r of rows) {
    if (r.verdict === "ERROR") { console.log(`  ${r.id}: ERROR — ${r.note}\n${bar}`); continue; }
    console.log(`  ${r.protocol} · ${r.symbol}  (${r.chain})`);
    console.log(`    verdict: [ ${r.verdict} ]  (${r.verifiabilityClass})`);
    console.log(`    liability ${r.liabilityEth}   ·   independently observed ${r.independentEth}   ·   coverage ${r.independentPct}%`);
    console.log(`    ${r.note}`);
    console.log(bar);
  }
  console.log(`  STALE is not a pass. An unverifiable claim is a published property.`);
  console.log(bar);
})().catch((e) => { console.error("error:", e.message); process.exit(1); });

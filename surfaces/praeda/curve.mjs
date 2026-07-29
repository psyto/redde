/**
 * Praeda — Slice 1, Phase 2a: the USDC-vault drawdown curve (real data).
 *
 * The window holds ~5×10^5 transactions — too many to parse each on a free tier.
 * The drawdown curve does not need them all: it samples the USDC vault's balance
 * across the window (every Nth window signature) by reading each sampled
 * transaction's post-balance for the vault. Every plotted point is a real
 * observation, but neither extrema nor shape are exact between samples.
 *
 *   SOLANA_RPC_URL=... PRAEDA_SAMPLES=600 node curve.mjs
 *
 * Reads  data/window-usdc-sigs.jsonl  (from crawl.mjs)
 * Writes data/curve-usdc.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RPC = process.env.SOLANA_RPC_URL;
if (!RPC) { console.error("set SOLANA_RPC_URL"); process.exit(1); }
const SAMPLES = Number(process.env.PRAEDA_SAMPLES || 600);
const CASE = process.env.PRAEDA_CASE || "";
const pfx = CASE ? `${CASE}-` : "";
const VAULT = process.env.PRAEDA_VAULT || "3nSdqiF5Cxd22r8h6Ti1TwzDmcVN6SgFfDcWbBtCFRdc";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const SIGS = new URL(`./data/${pfx}window-usdc-sigs.jsonl`, import.meta.url);
const OUT = new URL(`./data/${pfx}curve-usdc.json`, import.meta.url);
if (!existsSync(SIGS)) { console.error("run crawl.mjs first"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params, tries = 9) {
  let delay = 700;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.status === 429 || r.status === 403 || r.status >= 500) { await sleep(delay); delay = Math.min(delay * 2, 30000); continue; }
      const j = await r.json();
      if (j.error) { await sleep(delay); delay = Math.min(delay * 2, 30000); continue; }
      return j.result;
    } catch { await sleep(delay); delay = Math.min(delay * 2, 30000); }
  }
  return null;
}

// vault USDC balance after a given transaction, from its post token balances
function vaultUsdc(tx) {
  if (!tx?.meta) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey ?? k);
  for (const b of tx.meta.postTokenBalances || []) {
    if (keys[b.accountIndex] === VAULT && b.mint === USDC) return Number(b.uiTokenAmount.uiAmountString);
  }
  return null;
}

const rows = readFileSync(SIGS, "utf8").trim().split("\n").map((l) => JSON.parse(l));
rows.sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot); // chronological
const n = rows.length;
const stride = Math.max(1, Math.floor(n / SAMPLES));
const idx = [];
for (let i = 0; i < n; i += stride) idx.push(i);
if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);

console.log(`window sigs: ${n}  sampling ${idx.length} (stride ${stride})`);
const curve = [];
for (let k = 0; k < idx.length; k++) {
  const s = rows[idx[k]];
  const tx = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  const bal = vaultUsdc(tx);
  if (bal != null) curve.push({ t: s.blockTime, iso: new Date(s.blockTime * 1000).toISOString(), slot: s.slot, usdc: bal });
  if (k % 25 === 0) console.log(`  ${k}/${idx.length}  ${new Date(s.blockTime * 1000).toISOString()}  usdc=${bal}`);
}

curve.sort((a, b) => a.t - b.t);
const bals = curve.map((c) => c.usdc);
const peak = Math.max(...bals);
const peakIndex = bals.indexOf(peak);
const postPeak = curve.slice(peakIndex);
const floor = Math.min(...postPeak.map((c) => c.usdc));
const peakPt = curve[peakIndex], floorPt = postPeak.find((c) => c.usdc === floor);
// Time by which X% of the sampled peak-to-trough decline had occurred.
const drop = peak - floor;
const pct = (p) => {
  const target = peak - drop * p;
  const hit = curve.find((c) => c.t >= peakPt.t && c.usdc <= target);
  return hit ? hit.iso : null;
};
const summary = {
  vault: VAULT, windowSigs: n, samples: curve.length,
  start: curve[0], end: curve[curve.length - 1],
  sampledPeak: peakPt, sampledPostPeakTrough: floorPt,
  sampledPeakToTroughUsdc: drop,
  sampledDrainPct: peak ? drop / peak : null,
  t50: pct(0.5), t90: pct(0.9),
  note: "Systematic vault-balance observations; extrema and timings are sampled observations, not exact transaction-level extrema.",
};
writeFileSync(OUT, JSON.stringify({ summary, curve }, null, 2));
console.log("\n=== drawdown summary ===");
console.log(`  sampled peak   USDC ${peak.toLocaleString()} @ ${peakPt.iso}`);
console.log(`  sampled trough USDC ${floor.toLocaleString()} @ ${floorPt.iso}`);
console.log(`  sampled decline ${drop.toLocaleString()} USDC (${(summary.sampledDrainPct * 100).toFixed(2)}%)`);
console.log(`  50% of sampled decline by ${summary.t50}`);
console.log(`  90% of sampled decline by ${summary.t90}`);
console.log(`  wrote ${OUT.pathname}`);

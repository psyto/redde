/**
 * Praeda — Slice 1, Phase 2b: the per-account boundary-flow ledger (swarm).
 *
 * The window holds 468,655 transactions; a free tier cannot parse them all. This
 * takes a SYSTEMATIC SAMPLE (every Kth window transaction) and, for each, reads the
 * USDC vault's balance delta and finds a candidate observed endpoint — the single
 * other USDC account whose balance moved oppositely. A transaction with no single
 * clean endpoint (routed / multi-hop) is retained as ROUTE_UNRESOLVED and never
 * attributed. Per observed endpoint it accumulates USDC delta and, from the
 * reserve curve, sample timing L. This is a systematic sample, not an estimator
 * of the population: it cannot support a total, a concentration share, or a
 * confidence interval without a tail census / valid sampling design.
 *
 *   SOLANA_RPC_URL=... PRAEDA_SWARM_STRIDE=100 node swarm.mjs
 *
 * Reads  data/window-usdc-sigs.jsonl, data/curve-usdc.json
 * Writes data/swarm.json  (+ periodic data/swarm-partial.json)
 *
 * HONESTY: E and L are measurements. No intent, beneficiary, or coordination is
 * asserted. A direct 1:1 balance match is an OBSERVED_ENDPOINT only; it is not
 * ranked until transaction-local route evidence proves an endpoint. LIBRA stays
 * UNPRICED (this leg is USDC only); the LIBRA/SOL leg is separate.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RPC = process.env.SOLANA_RPC_URL;
if (!RPC) { console.error("set SOLANA_RPC_URL"); process.exit(1); }
const STRIDE = Number(process.env.PRAEDA_SWARM_STRIDE || 100);
const CASE = process.env.PRAEDA_CASE || "";
const pfx = CASE ? `${CASE}-` : "";
const VAULT = process.env.PRAEDA_VAULT || "3nSdqiF5Cxd22r8h6Ti1TwzDmcVN6SgFfDcWbBtCFRdc";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const SIGS = new URL(`./data/${pfx}window-usdc-sigs.jsonl`, import.meta.url);
const CURVE = new URL(`./data/${pfx}curve-usdc.json`, import.meta.url);
const OUT = new URL(`./data/${pfx}swarm.json`, import.meta.url);
const PARTIAL = new URL(`./data/${pfx}swarm-partial.json`, import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { makeCrawlRpc } from "../../core/rpc.mjs";
// crawler rpc (aggressive backoff, null on exhaustion) now comes from ../../core.
const rpc = makeCrawlRpc(RPC);

// Sampled reserve curve → D(t): 0 through the sampled peak, else the sampled
// fraction of peak-to-trough decline completed. L = 1 − D.
const curveData = JSON.parse(readFileSync(CURVE, "utf8"));
const curve = curveData.curve.map((c) => ({ t: c.t, u: c.usdc }));
const sampledPeak = curveData.summary.sampledPeak ?? curveData.summary.peak;
const peakU = sampledPeak.usdc, peakT = sampledPeak.t;
const floorU = Math.min(...curve.filter((c) => c.t >= peakT).map((c) => c.u));
function reserveAt(t) {
  if (t <= curve[0].t) return curve[0].u;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].t >= t) {
      const a = curve[i - 1], b = curve[i], f = (t - a.t) / (b.t - a.t || 1);
      return a.u + (b.u - a.u) * f;
    }
  }
  return curve[curve.length - 1].u;
}
function leadL(t) {
  if (t <= peakT) return 1; // sampled timing at/before the sampled peak
  const D = Math.min(1, Math.max(0, (peakU - reserveAt(t)) / (peakU - floorU)));
  return 1 - D;
}

// Vault USDC delta + candidate observed endpoints whose USDC moved oppositely.
function parse(tx) {
  if (!tx?.meta) return null;
  if (tx.meta.err) return { kind: "onchain-failed" };
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey ?? k);
  const pre = new Map(), post = new Map();
  for (const b of tx.meta.preTokenBalances || []) if (b.mint === USDC) pre.set(b.accountIndex, { owner: b.owner, amt: Number(b.uiTokenAmount.uiAmountString || 0), acct: keys[b.accountIndex] });
  for (const b of tx.meta.postTokenBalances || []) if (b.mint === USDC) post.set(b.accountIndex, { owner: b.owner, amt: Number(b.uiTokenAmount.uiAmountString || 0), acct: keys[b.accountIndex] });
  const idxs = new Set([...pre.keys(), ...post.keys()]);
  let vaultDelta = 0; const others = [];
  for (const i of idxs) {
    const a = pre.get(i)?.amt ?? 0, b = post.get(i)?.amt ?? 0, d = b - a;
    if (Math.abs(d) < 1e-9) continue;
    const acct = post.get(i)?.acct ?? pre.get(i)?.acct, owner = post.get(i)?.owner ?? pre.get(i)?.owner;
    if (acct === VAULT) vaultDelta += d;
    else others.push({ owner, d });
  }
  if (Math.abs(vaultDelta) < 1e-9) return { kind: "no-usdc-move" };
  // A 1:1 balance match is only a candidate endpoint, not route proof.
  const opp = others.filter((o) => Math.sign(o.d) === -Math.sign(vaultDelta));
  if (opp.length === 1 && Math.abs(opp[0].d + vaultDelta) < Math.abs(vaultDelta) * 0.02 + 1) {
    // The candidate endpoint's measured USDC delta; route remains unverified.
    return { kind: "observed-endpoint", owner: opp[0].owner, e: opp[0].d };
  }
  return { kind: "unresolved", amount: Math.abs(vaultDelta) };
}

const rows = readFileSync(SIGS, "utf8").trim().split("\n").map((l) => JSON.parse(l));
rows.sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot);
const sample = [];
for (let i = 0; i < rows.length; i += STRIDE) sample.push(rows[i]);
console.log(`window=${rows.length}  stride=${STRIDE}  sample=${sample.length}`);

const acct = new Map(); // owner -> { e, events, n }; endpoint is not yet attributed
let observedEndpointTx = 0, unresolvedTx = 0, unresolvedUsdc = 0, noUsdc = 0;
let onchainFailed = 0, rpcUnavailable = 0;
for (let k = 0; k < sample.length; k++) {
  const s = sample[k];
  const tx = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  if (!tx) { rpcUnavailable++; continue; }
  const p = parse(tx);
  if (!p || p.kind === "no-usdc-move") { noUsdc++; }
  else if (p.kind === "onchain-failed") { onchainFailed++; }
  else if (p.kind === "unresolved") { unresolvedTx++; unresolvedUsdc += p.amount; }
  else {
    observedEndpointTx++;
    const cur = acct.get(p.owner) || { e: 0, events: [], n: 0 };
    cur.e += p.e; cur.n++;
    cur.events.push({ t: s.blockTime, e: p.e });
    acct.set(p.owner, cur);
  }
  if (k % 250 === 0) {
    console.log(`  ${k}/${sample.length}  endpoints=${acct.size} observed=${observedEndpointTx} unresolved=${unresolvedTx} rpcUnavailable=${rpcUnavailable}`);
    writeFileSync(PARTIAL, JSON.stringify({ done: k, endpoints: acct.size, observedEndpointTx, unresolvedTx, onchainFailed, rpcUnavailable }));
  }
}

// Earliest event after which the sampled cumulative flow stays on the final side
// of, and at least half of, terminal E. This replaces the largest-transfer proxy.
function commitmentT(events, terminalE) {
  const sign = Math.sign(terminalE);
  if (!sign || !events.length) return events.at(-1)?.t ?? null;
  const ordered = [...events].sort((a, b) => a.t - b.t);
  let cumulative = 0;
  const signedCumulative = ordered.map((event) => {
    cumulative += event.e;
    return cumulative * sign;
  });
  const suffixMin = Array(ordered.length);
  let min = Infinity;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    min = Math.min(min, signedCumulative[i]);
    suffixMin[i] = min;
  }
  const threshold = Math.abs(terminalE) * 0.5;
  const index = suffixMin.findIndex((value) => value >= threshold);
  return ordered[index >= 0 ? index : ordered.length - 1].t;
}

// A 1:1 token-balance match does not prove that this owner is a participant.
// Keep it as an observed endpoint until CPI/instruction ordering proves the route.
let list = [...acct.entries()].map(([owner, v]) => {
  const t = commitmentT(v.events, v.e);
  return { owner, E: v.e, L: leadL(t), n: v.n, commitmentT: t,
    class: "ENDPOINT_UNVERIFIED" };
});
list.sort((a, b) => b.E - a.E);

// Exploratory sample composition only — never a population share or total.
const totalOut = list.filter((r) => r.E > 0).reduce((s, r) => s + r.E, 0);
const outBeforePeak = list.filter((r) => r.E > 0 && r.commitmentT <= peakT).reduce((s, r) => s + r.E, 0);
const summary = {
  windowTx: rows.length, stride: STRIDE, sampled: sample.length,
  observedEndpointTx, unresolvedTx, unresolvedUsdcSample: unresolvedUsdc, noUsdcTx: noUsdc,
  onchainFailed, rpcUnavailable, observedEndpointOwners: list.length,
  observedOutflowEndpointOwners: list.filter((r) => r.E > 0).length,
  observedInflowEndpointOwners: list.filter((r) => r.E < 0).length,
  sampleObservedUsdcOutflow: totalOut,
  samplePctObservedOutflowCommitmentBeforePeak: totalOut ? outBeforePeak / totalOut : 0,
  routeUnresolvedPct: (observedEndpointTx + unresolvedTx) ? unresolvedTx / (observedEndpointTx + unresolvedTx) : 0,
  peakT, note: "Systematic 1/stride sample. Endpoint owners are unverified and sample figures are not population estimates, scaled totals, or concentration shares.",
};
writeFileSync(OUT, JSON.stringify({ summary, accounts: list }, null, 2));
console.log("\n=== swarm summary ===");
console.log(`  sampled ${sample.length} of ${rows.length} tx (1/${STRIDE})`);
console.log(`  observed endpoints: ${list.length} owners (${summary.observedOutflowEndpointOwners} outflow / ${summary.observedInflowEndpointOwners} inflow)`);
console.log(`  route-unresolved: ${(summary.routeUnresolvedPct * 100).toFixed(1)}% of observed+unresolved USDC-moving tx`);
console.log(`  exploratory sample USDC outflow: ${totalOut.toLocaleString()}  |  commitment before peak: ${(summary.samplePctObservedOutflowCommitmentBeforePeak * 100).toFixed(1)}%`);
console.log("  largest direct observed endpoints (not a participant rank):");
for (const r of list.slice(0, 8)) console.log(`   ${r.class.padEnd(22)} ${r.owner}  E=${r.E >= 0 ? "+" : ""}${r.E.toFixed(0)}  L=${r.L.toFixed(2)}  n=${r.n}`);
console.log(`  wrote ${OUT.pathname}`);

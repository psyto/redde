/**
 * Standing monitor — the peg-pool exit-balance invariant, watched over time.
 *
 * A snapshot is not the signal; the TRAJECTORY is. The 2022 backtest fired because the
 * stETH share was RISING — the ETH draining, day over day. So this monitor persists
 * each run and alerts on DETERIORATION deltas, not just absolute flags:
 *   • a leg's share jumping (the exit crowding) — even while still "green"
 *   • the dominant coin's discount widening (the peg starting to slip)
 *   • a flag crossing into AMBER / RED
 * It is the forward-pointing counterpart of Praeda's reconstruction: catch the next
 * event as it begins, not after. It states measurable facts, never a prediction.
 *
 *   ETH_RPC_URL=... node monitor.mjs [--json]
 *
 * Persists backtest/monitor-state.json (last observation per pool + a rolling history).
 * Exit code: 2 if any RED, 1 if any WATCH/AMBER alert, 0 all-clear.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { scanAll, DISC } from "./poolscan.mjs";

const STATE = new URL("./monitor-state.json", import.meta.url);
const SHARE_JUMP = 0.05;  // a leg's share rose ≥5 points since last run → the exit crowding
const DISC_WIDEN = 0.005; // the dominant coin's discount widened ≥0.5% → the peg slipping
const now = new Date().toISOString();

const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE)) : { pools: {}, history: [] };
const rows = await scanAll((n, total, r) =>
  process.stderr.write(`\r  scanning ${n}/${total}  ${r.label}            `));
const ok = rows.filter((r) => r.ok);

const alerts = [];
const sev = { RED: 3, AMBER: 2, WATCH: 1 };
for (const r of ok) {
  const p = prev.pools[r.label];
  // absolute state
  if (r.flag === "RED") alerts.push({ sev: "RED", pool: r.label,
    msg: `RED — ${r.domToken} ${(r.maxShare * 100).toFixed(1)}% and off-peg (1→${r.price}, −${(r.discount * 100).toFixed(2)}%)` });
  else if (r.flag === "AMBER") alerts.push({ sev: "AMBER", pool: r.label,
    msg: `AMBER — ${r.domToken} ${(r.maxShare * 100).toFixed(1)}%, peg slipping (−${(r.discount * 100).toFixed(2)}%)` });
  // deterioration deltas (the leading signal) — fire even while still green
  if (p) {
    const dShare = r.maxShare - (p.maxShare ?? r.maxShare);
    const dDisc = (r.discount ?? 0) - (p.discount ?? 0);
    if (dShare >= SHARE_JUMP && r.flag !== "RED") alerts.push({ sev: "WATCH", pool: r.label,
      msg: `share rising — ${r.domToken} ${(p.maxShare * 100).toFixed(1)}% → ${(r.maxShare * 100).toFixed(1)}% (+${(dShare * 100).toFixed(1)}pts) since ${p.ts?.slice(0, 10)}` });
    if (dDisc >= DISC_WIDEN && r.flag !== "RED") alerts.push({ sev: "WATCH", pool: r.label,
      msg: `peg slipping — discount +${(dDisc * 100).toFixed(2)}% since last run (now −${((r.discount ?? 0) * 100).toFixed(2)}%)` });
    if (["RED", "AMBER", "benign"].includes(p.flag) && r.flag === "green") alerts.push({ sev: "WATCH", pool: r.label,
      msg: `recovered — ${p.flag} → green` });
  }
}
alerts.sort((a, b) => sev[b.sev] - sev[a.sev]);

// persist
const pools = {};
for (const r of ok) pools[r.label] = { maxShare: r.maxShare, discount: r.discount, flag: r.flag, domToken: r.domToken, ts: now };
const worst = [...ok].sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0) || b.maxShare - a.maxShare)[0];
const history = [...(prev.history || []), { ts: now, red: ok.filter((r) => r.flag === "RED").length,
  amber: ok.filter((r) => r.flag === "AMBER").length, alerts: alerts.length,
  worst: worst && { label: worst.label, maxShare: worst.maxShare, discount: worst.discount, flag: worst.flag } }].slice(-500);
writeFileSync(STATE, JSON.stringify({ updated: now, pools, history }, null, 2));

const firstRun = !prev.history?.length;
const report = { ts: now, firstRun, scanned: ok.length, reds: ok.filter((r) => r.flag === "RED").length,
  ambers: ok.filter((r) => r.flag === "AMBER").length, alerts };

if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); process.exit(report.reds ? 2 : alerts.length ? 1 : 0); }

console.log(`\n\n  praeda — standing peg-pool monitor · ${now}`);
if (firstRun) console.log(`  baseline established across ${ok.length} pools — deltas tracked from next run.`);
if (!alerts.length) {
  console.log(`  ✓ all clear — ${ok.length} pools balanced and pegged, no deterioration.`);
} else {
  for (const a of alerts) {
    const icon = a.sev === "RED" ? "🔴" : a.sev === "AMBER" ? "🟠" : "🟡";
    console.log(`  ${icon} ${a.sev.padEnd(5)} ${a.pool.padEnd(23)} ${a.msg}`);
  }
}
console.log(`  state → monitor-state.json (${history.length} run${history.length === 1 ? "" : "s"} of history)\n`);
process.exit(report.reds ? 2 : alerts.length ? 1 : 0);

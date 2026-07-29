/**
 * Live scan (one-shot) — the exit-balance invariant across the peg-pool watchlist.
 * See poolscan.mjs for the invariant and the peg-price gate.
 *
 *   ETH_RPC_URL=... node scan.mjs [--json]
 */
import { scanAll, DISC } from "./poolscan.mjs";

const rows = await scanAll((n, total, r) =>
  process.stderr.write(`\r  scanned ${n}/${total}  ${r.label}${r.ok ? ` max ${(r.maxShare * 100).toFixed(0)}%` : " (skip)"}            `));
const ok = rows.filter((r) => r.ok).sort((a, b) => b.maxShare - a.maxShare);
const skipped = rows.filter((r) => !r.ok);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scanned: rows.length, ok: ok.length, pools: ok, skipped }, null, 2));
  process.exit(0);
}
console.log(`\n\n  praeda — live peg-pool health scan (exit-balance invariant + peg-price gate)`);
console.log(`  RED = drained (≥75%) AND dominant coin off-peg (>${DISC * 100}%). imbalance-at-peg = benign (deprecated).\n`);
for (const r of ok) {
  const legs = r.legs.map((l) => `${l.token} ${(l.share * 100).toFixed(1)}%`).join("  ");
  const px = r.price != null ? `  1 ${r.domToken}→${r.price.toFixed(4)}${r.discount > DISC ? " OFF-PEG" : " ~peg"}` : "";
  console.log(`  [${r.flag.padEnd(6)}] ${r.label.padEnd(23)} ${legs}${px}`);
}
if (skipped.length) console.log(`\n  skipped (not verified): ${skipped.map((r) => r.label).join(", ")}`);
console.log("");
process.exit(ok.some((r) => r.flag === "RED") ? 2 : 0);

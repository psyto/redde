/**
 * Backtest — did an early-warning signal exist BEFORE the stETH liquidity crisis?
 *
 * Economic/solvency class (NOT a code exploit). The invariant: a healthy stETH/ETH
 * Curve pool is near-balanced — its two sides ~50/50. The signal: the stETH share
 * rising means the hard exit asset (ETH) is draining while stETH (what holders want
 * to exit) piles in — the exit door crowding. Read from state alone, block by block,
 * with eth_getBalance (native ETH) + balanceOf (stETH). Reproducible by anyone.
 *
 * Collapse references (external context, not derived here):
 *   2022-06-12  Celsius froze withdrawals.
 *   2022-06-18  stETH/ETH bottomed near 0.935.
 *
 *   ETH_RPC_URL=... node stecrv.mjs
 */
import { writeFileSync } from "node:fs";
const RPC = process.env.ETH_RPC_URL;
const hex = (n) => "0x" + BigInt(n).toString(16);
async function rpc(m, p) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const t = await r.text(); if (!t) throw new Error("empty");
      const j = JSON.parse(t); if (j.error) throw new Error(JSON.stringify(j.error));
      return j.result;
    } catch (e) { if (a >= 12) throw e; await new Promise((s) => setTimeout(s, 700 * (a + 1))); }
  }
}
const POOL = "0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"; // Curve steCRV (ETH/stETH)
const STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const balOf = async (tok, holder, b) =>
  BigInt(await rpc("eth_call", [{ to: tok, data: "0x70a08231" + holder.toLowerCase().slice(2).padStart(64, "0") }, hex(b)]) || "0x0");

const FROM = 14620000, TO = 15010000, N = 40; // ~2022-04-20 .. 2022-06-22
const points = [];
for (let i = 0; i <= N; i++) {
  const b = Math.round(FROM + ((TO - FROM) * i) / N);
  const blk = await rpc("eth_getBlockByNumber", [hex(b), false]);
  const ts = Number(blk.timestamp);
  const ethBal = Number(BigInt(await rpc("eth_getBalance", [POOL, hex(b)]))) / 1e18;
  const stBal = Number(await balOf(STETH, POOL, b)) / 1e18;
  const share = stBal / (stBal + ethBal);
  points.push({ block: b, ts, iso: new Date(ts * 1000).toISOString().slice(0, 10),
    eth: Math.round(ethBal), steth: Math.round(stBal), share: +(share).toFixed(4) });
  process.stdout.write(`\r  ${i + 1}/${N + 1}  ${points.at(-1).iso}  share ${(share * 100).toFixed(1)}%   `);
}
const base = points.slice(0, 3).reduce((s, p) => s + p.share, 0) / 3;
const peak = points.reduce((m, p) => (p.share > m.share ? p : m), points[0]);
// first crossing of thresholds
const cross = (thr) => points.find((p) => p.share >= thr);
const out = {
  target: "Lido stETH / ETH — Curve steCRV pool imbalance", pool: POOL,
  invariant: "exit pool near-balanced (stETH share ~50%); rising share = ETH exit liquidity draining",
  references: { celsiusFroze: "2022-06-12", stethBottom: "2022-06-18" },
  baselineShare: +base.toFixed(4), peak: { iso: peak.iso, block: peak.block, share: peak.share },
  crossings: { "0.60": cross(0.60)?.iso || null, "0.65": cross(0.65)?.iso || null, "0.70": cross(0.70)?.iso || null },
  points,
};
writeFileSync(new URL("./stecrv.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`\n  baseline share ${(base * 100).toFixed(1)}%  →  peak ${(peak.share * 100).toFixed(1)}% @ ${peak.iso}`);
console.log(`  first ≥60%: ${out.crossings["0.60"]}   ≥65%: ${out.crossings["0.65"]}   ≥70%: ${out.crossings["0.70"]}`);
console.log(`  vs Celsius freeze 2022-06-12, stETH bottom 2022-06-18`);
console.log("  wrote backtest/stecrv.json");

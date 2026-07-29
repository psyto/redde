// Generate Euler's aggregate USD reserve drawdown curve across W (hero chart data).
// Reuses the pinned boundary + reference from case-euler.mjs. Reads only.
import { writeFileSync } from "node:fs";
import { CASE } from "./case-euler.mjs";
const RPC = process.env.ETH_RPC_URL;
const hex = (n) => "0x" + BigInt(n).toString(16);
async function rpc(method, params) {
  for (let a = 0; ; a += 1) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const t = await r.text(); if (!t) throw new Error(`empty ${r.status}`);
      const j = JSON.parse(t); if (j.error) throw new Error(JSON.stringify(j.error));
      return j.result;
    } catch (e) { if (a >= 15) throw e; await new Promise((s) => setTimeout(s, 700 * (a + 1))); }
  }
}
const BAL = "0x70a08231";
async function balanceOf(token, holder, block) {
  const data = BAL + holder.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const res = await rpc("eth_call", [{ to: token, data }, hex(block)]);
  return BigInt(res === "0x" ? "0x0" : res);
}
async function ts(block) {
  const b = await rpc("eth_getBlockByNumber", [hex(block), false]);
  return b ? Number(b.timestamp) : null;
}
const euler = CASE.boundary[0];
const assets = CASE.reference.manifest.assets;
const { fromBlock, toBlock } = CASE.window;
const t0 = await ts(fromBlock), t1 = await ts(toBlock);
const points = [];
for (let blk = fromBlock; blk <= toBlock; blk += 1) {
  let usd = 0; const byToken = {};
  for (const a of assets) {
    const b = await balanceOf(a.token, euler, blk);
    const nat = Number(b) / 10 ** a.decimals;
    byToken[a.symbol] = nat; usd += nat * a.usd;
  }
  const tsBlk = t0 + Math.round(((t1 - t0) * (blk - fromBlock)) / (toBlock - fromBlock));
  points.push({ block: blk, ts: tsBlk, usd, byToken });
  process.stdout.write(`\r  ${blk - fromBlock + 1}/${toBlock - fromBlock + 1}  $${Math.round(usd).toLocaleString()}   `);
}
const peak = points[0].usd, floor = Math.min(...points.map((p) => p.usd));
const out = {
  target: CASE.name, boundary: euler, window: CASE.window,
  t0: new Date(t0 * 1000).toISOString(), t1: new Date(t1 * 1000).toISOString(),
  peakUsd: peak, floorUsd: floor, drawdownPct: ((peak - floor) / peak) * 100,
  reference: { source: CASE.reference.manifest.source, prices: Object.fromEntries(assets.map((a) => [a.symbol, a.usd])) },
  points,
};
writeFileSync(new URL("./data/euler-curve.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`\n  peak $${Math.round(peak).toLocaleString()} -> floor $${Math.round(floor).toLocaleString()}  (-${out.drawdownPct.toFixed(1)}%)`);
console.log("  wrote data/euler-curve.json");

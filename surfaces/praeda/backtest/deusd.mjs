/**
 * Backtest — the curator's liquidation window that a hardcoded oracle kept shut.
 *
 * Nov 2025: Stream Finance's xUSD imploded off-chain; its contagion drove Elixir's
 * deUSD from ~$1 to ~$0.015. Curated lending markets on Euler/Morpho that accepted
 * deUSD/xUSD as collateral had their oracles HARDCODED (or left stale) at $1.00 —
 * "to prevent mass liquidations" — so liquidations could not fire and the bad debt
 * (Euler ~$137M) accrued to lenders and the curators who set the config.
 *
 * The invariant (economic/solvency class, NOT a code exploit — re-executable by anyone):
 *   A lending market that prices collateral C at a fixed/stale oracle P_oracle carries
 *   PHANTOM collateral whenever the real on-chain market price P_mkt < P_oracle: loans
 *   backed by C are under-collateralized by (P_oracle - P_mkt) per unit, and cannot be
 *   liquidated at the oracle price. We read P_mkt block by block straight from deUSD's
 *   deepest venue (the Curve deUSD/USDC pool, get_dy) and measure the gap to a $1 oracle.
 *   Second signal (steCRV-style, leads the break): the pool's own composition — the
 *   exit asset (USDC) draining while deUSD piles in.
 *
 * Collapse references (external context, not derived here):
 *   2025-11-04  Stream froze / xUSD depeg acknowledged; contagion begins.
 *
 *   ETH_RPC_URL=... node deusd.mjs
 */
import { writeFileSync } from "node:fs";
const RPC = process.env.ETH_RPC_URL;
if (!RPC) { console.error("set ETH_RPC_URL"); process.exit(1); }
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
// deUSD/USDC Curve pool — self-verified below (coins[0]=deUSD, coins[1]=USDC)
const POOL = "0x5f6c431ac417f0f430b84a666a563fabe681da94";
const DEUSD = "0x15700B564Ca08D9439C58cA5053166E8317aa138";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const ORACLE_PRICE = 1.0; // the value a hardcoded/stale lending oracle assigned deUSD

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const balOf = async (tok, who, b) =>
  BigInt(await rpc("eth_call", [{ to: tok, data: "0x70a08231" + who.toLowerCase().slice(2).padStart(64, "0") }, hex(b)]) || "0x0");
// get_dy(int128 i, int128 j, uint256 dx) — marginal price of 1 deUSD in USDC
const getDy = async (i, j, dx, b) => {
  try {
    const r = await rpc("eth_call", [{ to: POOL, data: "0x5e0d443f" + word(i) + word(j) + word(dx) }, hex(b)]);
    return r && r !== "0x" ? BigInt(r) : null;
  } catch { return null; }
};

// self-verify pool wiring once
const c0 = "0x" + (await rpc("eth_call", [{ to: POOL, data: "0xc6610657" + word(0) }, "latest"])).slice(26);
const c1 = "0x" + (await rpc("eth_call", [{ to: POOL, data: "0xc6610657" + word(1) }, "latest"])).slice(26);
if (c0.toLowerCase() !== DEUSD.toLowerCase() || c1.toLowerCase() !== USDC.toLowerCase()) {
  console.error(`pool coins mismatch: [0]=${c0} [1]=${c1}`); process.exit(1);
}

const FROM = 23600000, TO = 23810000, N = 42; // ~2025-10-19 .. 2025-11-16
const points = [];
for (let k = 0; k <= N; k++) {
  const b = Math.round(FROM + ((TO - FROM) * k) / N);
  const blk = await rpc("eth_getBlockByNumber", [hex(b), false]);
  const ts = Number(blk.timestamp);
  const dy = await getDy(0, 1, 10n ** 18n, b);          // 1 deUSD -> USDC (6dec)
  const price = dy == null ? null : Number(dy) / 1e6;   // deUSD market price in USD
  const deusdBal = Number(await balOf(DEUSD, POOL, b)) / 1e18;
  const usdcBal = Number(await balOf(USDC, POOL, b)) / 1e6;
  const share = deusdBal / (deusdBal + usdcBal);         // deUSD share of the pool (exit-door crowding)
  const gap = price == null ? null : Math.max(0, ORACLE_PRICE - price); // phantom collateral per unit
  points.push({ block: b, ts, iso: new Date(ts * 1000).toISOString().slice(0, 10),
    price: price == null ? null : +price.toFixed(4),
    oracleGapPct: gap == null ? null : +(gap * 100).toFixed(2),
    deusdShare: +share.toFixed(4), deusd: Math.round(deusdBal), usdc: Math.round(usdcBal) });
  process.stdout.write(`\r  ${k + 1}/${N + 1}  ${points.at(-1).iso}  px ${price == null ? "n/a" : price.toFixed(4)}  share ${(share * 100).toFixed(1)}%   `);
}

const firstBelow = (thr) => points.find((p) => p.price != null && p.price < thr);
const firstShare = (thr) => points.find((p) => p.deusdShare >= thr);
const trough = points.reduce((m, p) => (p.price != null && (m == null || p.price < m.price) ? p : m), null);
const out = {
  target: "Elixir deUSD — lending-oracle vs. market price (curator liquidation window)",
  pool: POOL, coins: { deUSD: DEUSD, USDC },
  invariant: "phantom collateral = max(0, oracle_price - on-chain market price); a fixed/stale $1 oracle can't liquidate deUSD once P_mkt < 1",
  oraclePriceAssumed: ORACLE_PRICE,
  references: { streamFroze_xusdDepeg: "2025-11-04", eulerBadDebtUSD: 137e6 },
  priceCrossings: { "0.99": firstBelow(0.99)?.iso || null, "0.97": firstBelow(0.97)?.iso || null,
    "0.90": firstBelow(0.90)?.iso || null, "0.50": firstBelow(0.50)?.iso || null },
  shareCrossings: { "0.60": firstShare(0.60)?.iso || null, "0.70": firstShare(0.70)?.iso || null,
    "0.80": firstShare(0.80)?.iso || null },
  trough: trough ? { iso: trough.iso, block: trough.block, price: trough.price } : null,
  points,
};
writeFileSync(new URL("./deusd.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`\n  first market price <0.99: ${out.priceCrossings["0.99"]}   <0.97: ${out.priceCrossings["0.97"]}   <0.90: ${out.priceCrossings["0.90"]}`);
console.log(`  pool composition first ≥60% deUSD: ${out.shareCrossings["0.60"]}   ≥70%: ${out.shareCrossings["0.70"]}   ≥80%: ${out.shareCrossings["0.80"]}`);
console.log(`  trough price ${trough?.price} @ ${trough?.iso}`);
console.log(`  vs Stream freeze / xUSD depeg 2025-11-04, Euler bad debt ~$137M`);
console.log("  wrote backtest/deusd.json");

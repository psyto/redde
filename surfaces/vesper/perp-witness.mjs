#!/usr/bin/env node
// perp-witness.mjs
// Carry-over from the (closed) cross-VM stock-divergence line (formerly /src/xdiv).
//
// Purpose for Vesper: an INDEPENDENT, PERMISSIONLESS "live true-value witness".
// While a tokenized-stock oracle is FROZEN during closed US market hours (weekends/nights),
// the Hyperliquid HIP-3 perp (TradeXYZ "xyz" dex) keeps trading 24/7. This measures, live,
// how far the frozen oracle has drifted from the real market — a THIRD reference next to
// Vesper's Kamino(🟢)/Jupiter(🔴) valuations of the same underlying.
//
// It answers, in one line per name: "the collateral oracle is frozen Nh at Friday's close,
// but the live permissionless perp says the true value has moved X% since — so any lender
// still marking this collateral at the frozen price is off by ~X%."
//
// Returns-based (% since Friday close) so it is scale-invariant: works even when the perp
// tracks the INDEX (xyz:SP500 ~7400) while Vesper's token tracks the ETF (SPYx ~740).
//
// Usage: node perp-witness.mjs
const HL = "https://api.hyperliquid.xyz/info";
const HERMES = "https://hermes.pyth.network";
// label | perp coin on the xyz (TradeXYZ HIP-3) dex | Pyth equity ticker (null = no live feed, e.g. pre-IPO)
const MAP = [
  { label: "SPYx (S&P500)",        perp: "xyz:SP500", pyth: "SPY" },
  { label: "AAPLx",                perp: "xyz:AAPL",  pyth: "AAPL" },
  { label: "NVDAx",                perp: "xyz:NVDA",  pyth: "NVDA" },
  { label: "TSLAx",                perp: "xyz:TSLA",  pyth: "TSLA" },
  { label: "SPCX (SpaceX pre-IPO)",perp: "xyz:SPCX",  pyth: null },
];
const now = Math.floor(Date.now() / 1000);
const j = async (u, o) => (await fetch(u, o)).json();
const dow = (ms) => new Date(ms).getUTCDay(); // 0=Sun..6=Sat
const hUTC = (ms) => new Date(ms).getUTCHours();

async function pythStale(t) {
  if (!t) return null;
  const feeds = await j(`${HERMES}/v2/price_feeds?query=${t}&asset_type=equity`);
  const f = feeds.find((x) => x.attributes?.symbol === `Equity.US.${t}/USD`);
  if (!f) return null;
  const u = await j(`${HERMES}/v2/updates/price/latest?ids[]=${f.id}`);
  const p = u.parsed[0].price;
  return { price: Number(p.price) * 10 ** p.expo, ageH: +((now - p.publish_time) / 3600).toFixed(1) };
}
async function perpFriCloseAndNow(coin) {
  const candles = await j(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: (now - 10 * 86400) * 1000, endTime: now * 1000 } }) });
  if (!Array.isArray(candles) || !candles.length) return null;
  // most recent Friday 20:00 UTC (= 16:00 ET equity close) candle
  let fri = null;
  for (const k of candles) if (dow(k.t) === 5 && hUTC(k.t) === 20) fri = k;
  const last = candles[candles.length - 1];
  return { friClose: fri ? Number(fri.c) : null, friISO: fri ? new Date(fri.t).toISOString().slice(0, 10) : null, perpNow: Number(last.c) };
}

console.log(`\nperp witness — live permissionless true-value vs frozen oracle  |  ${new Date(now * 1000).toISOString()}`);
console.log(`(oracle frozen + perp moved  =>  frozen collateral valuation is stale by ~that move)\n`);
console.log(["underlying", "oracleAgeH", "perpNow", "friClose", "perpMove%", "witness"].map((s, i) => s.padEnd(i === 0 ? 22 : i === 5 ? 8 : 11)).join(""));
for (const m of MAP) {
  const [pyth, perp] = await Promise.all([pythStale(m.pyth), perpFriCloseAndNow(m.perp)]);
  const move = perp?.friClose ? ((perp.perpNow - perp.friClose) / perp.friClose * 100) : null;
  const frozen = pyth ? (pyth.ageH >= 6 ? `frozen ${pyth.ageH}h` : "LIVE") : "no feed";
  const witness = move == null ? "-" : (Math.abs(move) < 0.3 ? "aligned" : `oracle stale ~${move > 0 ? "+" : ""}${move.toFixed(2)}%`);
  console.log([m.label, frozen, perp?.perpNow?.toFixed(2), perp?.friClose?.toFixed(2) ?? "-", move != null ? (move > 0 ? "+" : "") + move.toFixed(2) : "-", witness]
    .map((v, i) => String(v ?? "-").padEnd(i === 0 ? 22 : i === 5 ? 8 : 11)).join(""));
  await new Promise((r) => setTimeout(r, 250));
}
console.log("\nperpMove% = perp return since Friday 16:00 ET close (the drift a frozen oracle is blind to).");

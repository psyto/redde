// Vesper — evidence bundle for the artifact layer.
// Emits the confirmed, measured numbers the 1-pager's ②/④/⑤ placeholders need — nothing else.
// Does NOT touch league.html (that's the artifact window's file). Writes EVIDENCE-jupiter-spyx.json.
//
//   RPC=<url> node bundle.mjs
//
// Two evidence blocks:
//   ② measured-not-modeled : Jupiter SPYx price account update cadence, split by market status
//   ④/⑤ gap-loss           : Act-1 rough exposure ($ bad debt per position) at a Monday gap

import { writeFileSync } from 'node:fs';
import { weekendLiveness } from './weekend-liveness.mjs';
import { stressExposure } from './verify-cmls.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';

// The subject: Jupiter Lend SPYx vault, source_type=7 pushed price account.
const PRICE_ACCT = 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff';
const SPYx = { ticker: 'SPYx', liqThreshold: 0.85, borrowFactor: 0.75 }; // Jupiter vaults 78/82 (LT 85%)

function fmt(ts) { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z'; }

const live = await weekendLiveness(PRICE_ACCT, { rpcUrl: RPC, hoursBack: 72 });
if (live.signal === 'NO_DATA') { console.error('no data (RPC blocked?) — set RPC to a working endpoint'); process.exit(1); }

// ④/⑤ gap-loss: a position borrowed to the max (LTV = borrowFactor) at Friday close, then a
// Monday-open gap down of g. Unguarded (RED) → liquidates against a price disconnected from
// post-gap fair value. Exposure = fraction of collateral that becomes bad debt (Act-1 estimate).
const GAPS = [0.10, 0.20, 0.30];
const POSITION_USD = 100_000;
const gapLoss = GAPS.map((g) => {
  const exp = stressExposure({ ltv: SPYx.borrowFactor, liqThreshold: SPYx.liqThreshold, guard: 'NONE' }, g);
  return { gapPct: g, exposurePctOfCollateral: exp, badDebtUsdPer100k: Math.round(exp * POSITION_USD) };
});

const bundle = {
  subject: { venue: 'Jupiter Lend', asset: 'SPYx', priceAccount: PRICE_ACCT, ...SPYx },
  measuredAt: fmt(Math.floor(Date.now() / 1000)),
  // ② measured, not modeled
  liveness: {
    window: `${fmt(live.first)} → ${fmt(live.last)}`,
    hours: +((live.last - live.first) / 3600).toFixed(1),
    totalUpdates: live.updates,
    updatesWhileMarketOpen: live.openUpdates,
    updatesWhileMarketClosed: live.closedUpdates,
    perClosedDayET: live.dailyClosed,
    maxGapMin: live.maxGapMin,
    signal: live.signal, // LIVE_THROUGH_CLOSURE → no market-status guard → RED
  },
  // ④/⑤ gap-loss
  gapLoss: { positionUsd: POSITION_USD, atLtv: SPYx.borrowFactor, liqThreshold: SPYx.liqThreshold, rows: gapLoss },
};

writeFileSync(new URL('./EVIDENCE-jupiter-spyx.json', import.meta.url), JSON.stringify(bundle, null, 2));

// ── human-readable print for the artifact window ─────────────────────────────
console.log(`\n═══ Vesper evidence bundle · Jupiter Lend × SPYx ═══`);
console.log(`  measured: ${bundle.measuredAt}   price account: ${PRICE_ACCT}\n`);
console.log(`  ② MEASURED, NOT MODELED — price-account update cadence`);
console.log(`     window ................. ${bundle.liveness.window}  (${bundle.liveness.hours}h)`);
console.log(`     total updates .......... ${bundle.liveness.totalUpdates}`);
console.log(`     while US market OPEN ... ${bundle.liveness.updatesWhileMarketOpen}`);
console.log(`     while US market CLOSED . ${bundle.liveness.updatesWhileMarketClosed}   ← liquidations price off THIS`);
for (const [d, n] of Object.entries(bundle.liveness.perClosedDayET)) console.log(`         ${d} (closed) ....... ${n} updates`);
console.log(`     max gap between updates  ${bundle.liveness.maxGapMin} min`);
console.log(`     signal ................. ${bundle.liveness.signal}  → guard NONE → 🔴 RED\n`);
console.log(`  ④/⑤ GAP-LOSS — $${POSITION_USD.toLocaleString()} SPYx position at ${SPYx.borrowFactor * 100}% LTV (LT ${SPYx.liqThreshold * 100}%), Act-1 estimate`);
for (const r of gapLoss) console.log(`     ${(r.gapPct * 100).toFixed(0)}% Monday gap → ${(r.exposurePctOfCollateral * 100).toFixed(0)}% of collateral = ~$${r.badDebtUsdPer100k.toLocaleString()} bad debt`);
console.log(`\n  → written to EVIDENCE-jupiter-spyx.json (drop values into the 1-pager's $__).\n`);

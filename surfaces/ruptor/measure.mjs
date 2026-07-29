// Ariete — measure the REAL on-chain sell-side liquidity for the collateral asset,
// replacing the assumed DEX-depth knob with live aggregator quotes.
//
// Asks a Solana DEX aggregator "if I dump $X of the collateral into on-chain liquidity
// right now, what price impact do I eat?" across sizes, and finds the routable ceiling
// (the size beyond which NO route exists — the liquidity simply runs out).
//
//   node measure.mjs                 # probe + save measured.json
// The collateral mint is a live-target detail → loaded from ./venue.local.mjs (withheld).
// Output feeds ariete.mjs (--measured). measured.json is a finding → gitignored.
// Zero deps (Node 18+).

import { writeFileSync } from 'node:fs';

let VENUE = null;
try { ({ VENUE } = await import('./venue.local.mjs')); } catch { /* no live target */ }
if (!VENUE) { console.error('live target not configured — create ./venue.local.mjs (a withheld finding).'); process.exit(1); }

const MINT = VENUE.target.mint;
const TICK = VENUE.target.ticker;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';   // 6 decimals
const DEC = 8;                                                  // collateral decimals
const pxArg = process.argv.indexOf('--px');
const PX = pxArg > -1 ? +process.argv[pxArg + 1] : 310;         // rough px to size the token amount
const API = 'https://lite-api.jup.ag/swap/v1/quote';           // public DEX aggregator quote

async function quote(usd) {
  const amt = Math.round((usd / PX) * 10 ** DEC);
  const url = `${API}?inputMint=${MINT}&outputMint=${USDC}&amount=${amt}&slippageBps=5000`;
  try {
    const j = await (await fetch(url)).json();
    if (j.error || !j.outAmount) return { usd, routed: false };
    return { usd, routed: true, out: Number(j.outAmount) / 1e6, impact: Number(j.priceImpactPct) };
  } catch (e) { return { usd, routed: false, err: e.message }; }
}

const sizes = [5000, 10000, 25000, 50000, 75000, 100000, 110000, 120000, 130000, 150000, 200000];
const curve = [];
let ceiling = null;
console.log(`measuring real ${TICK} sell-side liquidity (live DEX aggregator quotes):\n`);
for (const u of sizes) {
  const q = await quote(u);
  if (q.routed) {
    curve.push({ usd: u, impactPct: q.impact * 100 });
    console.log(`  $${u.toLocaleString().padStart(7)}  →  impact ${(q.impact * 100).toFixed(2)}%`);
  } else {
    if (ceiling == null) ceiling = u;
    console.log(`  $${u.toLocaleString().padStart(7)}  →  NO ROUTE`);
  }
}

const out = {
  asset: TICK, mint: MINT, source: 'dex-aggregator',
  capturedAt: new Date().toISOString(),
  routableCeilingUSD: ceiling,           // first size with no route (liquidity exhausted)
  curve,                                 // measured [{usd, impactPct}] below the ceiling
};
writeFileSync(new URL('./measured.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`\n  routable ceiling ≈ $${(ceiling || 0).toLocaleString()} — beyond this, no on-chain route exists.`);
console.log(`  wrote measured.json (${curve.length} points). Feed it: node ariete.mjs --measured\n`);

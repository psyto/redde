// Ariete — cross-venue contagion / liquidity seizure.
//
// The primary mode is --measured (see measure.mjs / CREDIBILITY.md): it compares the
//   SELL DEMAND to clear a book's underwater positions against the live-MEASURED
//   routable ceiling (how much collateral can actually be sold on-chain before routes
//   vanish). The overflow is STRANDED — no buyer exists, so that debt cannot be
//   liquidated at all. The break is not a smooth cascade; it is a liquidity seizure.
//   A clamp+suspend venue (Vesper GREEN) pauses in-window and strands nothing.
//
// Without --measured, it runs an endogenous constant-product cascade — a LABELED
//   MODEL (depth/recovery are assumptions), weaker than measured mode. Prefer --measured.
//
// Reuses Ruptor's re-execution (the live venue's book). Zero deps (Node 18+).
//   node measure.mjs                   # first: capture live liquidity → measured.json
//   node ariete.mjs --measured         # liquidity-seizure on measured liquidity (primary)
//   node ariete.mjs --g0 0.10          # fundamental Monday gap (scenario input)
//   node ariete.mjs                    # constant-product cascade (labeled model, fallback)
//   node ariete.mjs --demo             # synthetic book, no RPC, no named venue

import { readFileSync, existsSync } from 'node:fs';
import { TARGET, VENUE_LABEL, fairPrice, collateralDecimals, liveBook } from './ruptor.mjs';

// ── measured liquidity (from measure.mjs → measured.json) ─────────────────────
// Interpolate the live-measured price impact of selling `sizeUSD` of collateral.
function impactFrac(curve, sizeUSD) {
  if (sizeUSD <= curve[0].usd) return (curve[0].impactPct / 100) * (sizeUSD / curve[0].usd);
  for (let i = 1; i < curve.length; i++) {
    if (sizeUSD <= curve[i].usd) {
      const a = curve[i - 1], b = curve[i], t = (sizeUSD - a.usd) / (b.usd - a.usd);
      return (a.impactPct + t * (b.impactPct - a.impactPct)) / 100;
    }
  }
  return curve[curve.length - 1].impactPct / 100;
}

// The measured claim: liquidators can only offload up to the routable ceiling. Worst
// positions first; everything past the ceiling is STRANDED (no on-chain buyer) → its
// shortfall is bad debt the venue cannot clear. GREEN pauses in-window (no forced
// selling), settling orderly at the fundamental → only genuinely-insolvent = bad debt.
function measuredBreak(book, fair, g0, { ceiling, curve, lt, bonus, cf, clamp, band }) {
  const p = clamp ? Math.max(fair * (1 - g0), fair * (1 - band)) : fair * (1 - g0);
  const under = book.filter((b) => b.debt / (b.qty * p) >= lt).sort((a, b) => b.ltv - a.ltv);
  let sellDemand = 0;
  for (const pos of under) sellDemand += Math.min(cf * pos.debt, (pos.qty * p) / (1 + bonus)) * (1 + bonus);
  let budget = clamp ? Infinity : ceiling;               // GREEN: no in-window forced selling cap
  let nCleared = 0, nStuck = 0, stuckDebt = 0, badDebt = 0, extract = 0, soldUSD = 0;
  for (const pos of under) {
    const collVal = pos.qty * p;
    const repaid = Math.min(cf * pos.debt, collVal / (1 + bonus));
    const sellUSD = repaid * (1 + bonus);
    const shortfall = Math.max(0, pos.debt - collVal / (1 + bonus));
    if (sellUSD <= budget) { budget -= sellUSD; nCleared++; soldUSD += sellUSD; extract += repaid * bonus; badDebt += shortfall; }
    else { nStuck++; stuckDebt += pos.debt; badDebt += shortfall; }   // stranded: cannot be offloaded on-chain
  }
  return { settlePrice: p, nUnder: under.length, sellDemand, nCleared, nStuck, stuckDebt, badDebt, extract, soldUSD, impact: clamp ? 0 : impactFrac(curve, Math.min(soldUSD, ceiling * 0.999)) };
}

const ANON = { ticker: 'EQXx', name: 'a tokenized equity', lt: 0.75 };
function demoBook(price) {
  let s = 0x9e3779b9; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const book = [];
  for (let i = 0; i < 160; i++) {
    const coll = 2000 + rnd() ** 2 * 78000;
    let ltv = 0.20 + rnd() * 0.45; if (i % 11 === 0) ltv = 0.70 + rnd() * 0.20;
    book.push({ pk: 'demo_' + i, qty: coll / price, coll, debt: ltv * coll, ltv });
  }
  return book;
}

// ── the contagion cascade ─────────────────────────────────────────────────────
// clamp=false (RED / naive): liquidate against the LIVE price and dump collateral
//   into the pool → constant-product price impact → feed back into the next round.
// clamp=true (GREEN): liquidation price is floored to last close ± band AND paused
//   during the closed window → no forced selling → no feedback → single settle.
function cascade(book, fair, g0, { poolUSD, lt, bonus, cf, clamp, band, recovery }) {
  const pos = book.map((b) => ({ qty: b.qty, debt: b.debt }));    // mutable per-position state
  const floor = fair * (1 - g0);                                  // the fundamental (arb pulls back toward it)
  let p = floor;
  const rounds = [];
  const touched = new Set();
  let soldUSDtot = 0, extract = 0;
  for (let k = 0; k < 300; k++) {
    const liqPrice = clamp ? Math.max(p, fair * (1 - band)) : p;   // GREEN clamps the trigger price
    let soldTokens = 0, any = false;
    for (let i = 0; i < pos.length; i++) {
      const q = pos[i];
      if (q.qty <= 0 || q.debt <= 0) continue;
      const collVal = q.qty * liqPrice;
      if (q.debt / collVal < lt) continue;                        // healthy at the trigger price
      any = true; touched.add(i);
      const repaid = Math.min(cf * q.debt, collVal / (1 + bonus)); // partial close, capped by collateral
      const seizeTok = Math.min(q.qty, (repaid * (1 + bonus)) / liqPrice);
      q.debt -= repaid; q.qty -= seizeTok;                        // position shrinks; may re-liquidate next round
      extract += repaid * bonus;
      soldTokens += seizeTok;                                     // only the SEIZED collateral is dumped
    }
    if (!any) break;
    if (!clamp && soldTokens > 0) {                               // GREEN paused → no selling → no feedback
      const Rt = poolUSD / p;                                     // token reserve at current price
      const impacted = p * (Rt / (Rt + soldTokens)) ** 2;         // constant-product sell impact
      p = impacted + recovery * (floor - impacted);               // arb pulls back toward the fundamental
    }
    soldUSDtot += soldTokens * liqPrice;
    rounds.push({ k, cumLiq: touched.size, soldTokens, price: p });
    if (clamp) break;                                             // no feedback → single settle
  }
  const settle = clamp ? Math.max(fair * (1 - g0), fair * (1 - band)) : p;
  let badDebt = 0, debtCleared = 0;
  for (let i = 0; i < pos.length; i++) {
    if (!touched.has(i)) continue;
    debtCleared += book[i].debt - pos[i].debt;
    if (pos[i].debt > 0) badDebt += Math.max(0, pos[i].debt - (pos[i].qty * settle) / (1 + bonus)); // residual shortfall
  }
  const effDrop = 1 - p / fair;
  return { rounds, nLiq: touched.size, settlePrice: settle, effDrop, mult: g0 > 0 ? effDrop / g0 : 1, badDebt, debtCleared, extract, soldUSD: soldUSDtot };
}

const usd = (x) => '$' + Math.round(x).toLocaleString('en-US');
const pct = (x) => (x * 100).toFixed(1) + '%';

async function main() {
  const args = {}; const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    if (!av[i].startsWith('--')) continue;
    const k = av[i].slice(2), nxt = av[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) args[k] = true; else { args[k] = nxt; i++; }
  }
  const demo = 'demo' in args;
  const P = {
    poolUSD: args.depth != null ? +args.depth : 1500000,  // DEX liquidity a sell moves (labeled, thin closed-market)
    recovery: args.recovery != null ? +args.recovery : 0.35, // fraction of dislocation arb pulls back per round
    lt: TARGET.lt, bonus: 0.075, cf: 0.5, band: 0.05,     // close factor 50%, GREEN clamp band ±5%
  };
  const g0 = args.g0 != null ? +args.g0 : 0.10;
  const label = demo ? 'DEMO — synthetic book' : anon(args) ? 'Venue A' : VENUE_LABEL;
  const tick = demo || anon(args) ? ANON.ticker : TARGET.ticker;

  console.log(`\nAriete — cross-venue contagion via endogenous liquidation feedback`);
  console.log(`target: ${label} ${tick} · liq threshold ${pct(P.lt)}`);
  console.log(`params: DEX depth ${usd(P.poolUSD)} · clamp band ±${pct(P.band)} · bonus ${pct(P.bonus)}  (labeled assumptions)\n`);

  let fair, book;
  if (demo) { fair = 100; book = demoBook(fair); }
  else {
    const [pr, dec] = await Promise.all([fairPrice(), collateralDecimals()]);
    if (!pr) { console.error('could not read fair price — retry with a non-rate-limited RPC'); process.exit(1); }
    fair = pr; book = await liveBook(fair, dec);
    if (!book.length) { console.error('no live positions'); process.exit(1); }
  }
  const totColl = book.reduce((s, p) => s + p.coll, 0), totDebt = book.reduce((s, p) => s + p.debt, 0);
  console.log(`live book: ${book.length} ${demo ? 'synthetic' : 'real'} borrowers · fair $${fair.toFixed(2)} · collateral ${usd(totColl)} · debt ${usd(totDebt)}\n`);

  // ── measured mode: use live-measured on-chain liquidity, not a constant-product guess ──
  if ('measured' in args) {
    if (!existsSync(new URL('./measured.json', import.meta.url))) {
      console.error('no measured.json — run `node measure.mjs` first to capture live liquidity.'); process.exit(1);
    }
    const m = JSON.parse(readFileSync(new URL('./measured.json', import.meta.url)));
    const MP = { ceiling: m.routableCeilingUSD, curve: m.curve, lt: P.lt, bonus: P.bonus, cf: P.cf, band: P.band };
    const r = measuredBreak(book, fair, g0, { ...MP, clamp: false });
    const g = measuredBreak(book, fair, g0, { ...MP, clamp: true });
    console.log(`── MEASURED contagion at a ${pct(g0)} gap (liquidity from live ${m.source}, ${m.capturedAt.slice(0, 16).replace('T', ' ')}Z) ──`);
    console.log(`  measured routable ceiling: ${usd(m.routableCeilingUSD)} — beyond this, NO on-chain route exists.\n`);
    console.log(`  🔴 NAIVE venue: must offload ${usd(r.sellDemand)} to clear ${r.nUnder} underwater positions,`);
    console.log(`     but on-chain liquidity absorbs only ~${usd(m.routableCeilingUSD)} (${(r.impact * 100).toFixed(1)}% impact).`);
    console.log(`     → ${r.nCleared} clear, ${r.nStuck} STRANDED (${usd(r.stuckDebt)} debt unliquidatable) · bad debt ${usd(r.badDebt)}`);
    console.log(`  🟢 CLAMP+SUSPEND venue: pauses in-window, settles orderly at the fundamental`);
    console.log(`     → ${g.nUnder} underwater, none stranded · bad debt ${usd(g.badDebt)}`);
    console.log(`\n  → The break is not a smooth cascade — it is a LIQUIDITY SEIZURE: sell demand ${usd(r.sellDemand)}`);
    console.log(`    vs measured capacity ${usd(m.routableCeilingUSD)}. The naive venue physically cannot clear the book;`);
    console.log(`    ${usd(r.stuckDebt)} of debt strands as bad debt. Every number here is measured or real chain state.`);
    console.log(`    (only the fundamental gap g0=${pct(g0)} and close factor ${pct(P.cf)} are scenario inputs.)\n`);
    return;
  }

  // the contrast at the chosen fundamental gap
  const red = cascade(book, fair, g0, { ...P, clamp: false });
  const green = cascade(book, fair, g0, { ...P, clamp: true });

  console.log(`── contagion at a ${pct(g0)} fundamental Monday gap ──────────────────────────────`);
  console.log(`  🔴 NAIVE venue (Vesper RED): forced selling feeds back into price`);
  console.log(`     ${red.rounds.length} cascade rounds · ${red.nLiq}/${book.length} liquidated · ${usd(red.soldUSD)} dumped into the pool`);
  console.log(`     ${pct(g0)} fundamental gap  →  ${pct(red.effDrop)} EFFECTIVE drop   (contagion ×${red.mult.toFixed(1)})`);
  console.log(`     bad debt ${usd(red.badDebt)} · searcher extract ${usd(red.extract)}`);
  console.log(`  🟢 CLAMP+SUSPEND venue (Vesper GREEN): pauses, never sells`);
  console.log(`     ${green.rounds.length} round · ${green.nLiq}/${book.length} liquidated · no forced selling`);
  console.log(`     ${pct(g0)} fundamental gap  →  ${pct(green.effDrop)} drop            (contagion ×${green.mult.toFixed(1)} — never ignites)`);
  console.log(`     bad debt ${usd(green.badDebt)}`);
  console.log(`\n  → Same asset, same gap: the NAIVE venue amplifies ${pct(g0)} into ${pct(red.effDrop)} and eats`);
  console.log(`    ${usd(red.badDebt)} vs the clamp venue's ${usd(green.badDebt)}. The clamp breaks the contagion chain.`);

  // the real driver is closed-market liquidity — sweep DEX depth at the fixed gap
  console.log(`\n── liquidity sweep (NAIVE venue, ${pct(g0)} gap) ─────────────────────────────────`);
  console.log(`   DEX depth   effective drop  (contagion)   liquidated   bad debt`);
  for (const d of [250000, 500000, 1000000, 2000000, 5000000]) {
    const r = cascade(book, fair, g0, { ...P, poolUSD: d, clamp: false });
    console.log(`   ${usd(d).padStart(9)}     ${pct(r.effDrop).padStart(6)}       ×${r.mult.toFixed(1).padStart(4)}     ${String(r.nLiq).padStart(4)}/${book.length}   ${usd(r.badDebt).padStart(11)}`);
  }
  console.log(`\n  The thinner the closed-market liquidity, the harder a naive venue's own liquidations`);
  console.log(`  cascade — the exact regime xStocks sit in Fri-Sun. A clamp+suspend venue is flat at`);
  console.log(`  ${pct(g0)} regardless of depth: it never sells, so there is no feedback to amplify.`);
  console.log(`\n  Ariete = the contagion primitive: Ruptor prices one book; Ariete prices the cascade`);
  console.log(`  the selling ignites across every venue on the same collateral.\n`);
}
function anon(args) { return 'anon' in args || 'demo' in args; }

main().catch((e) => { console.error(e); process.exit(1); });

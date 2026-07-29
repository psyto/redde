// Vesper — Closed-Market Liquidation Soundness (CMLS) verifier
// Redde lineage: zero-dep, deterministic, chain-derived verdicts.
//
// Act-1 scope: the verdict hinges on the closed-market PRICE INPUT, not the full
// liquidation waterfall. We re-derive, from on-chain state, the exact price each venue
// would liquidate against during the closed-market window, and classify its gap-safety.
//
// Status: verdict model + classifier + target registry are live and runnable.
// The on-chain adapter (probeOnChain) is the next rate-limiter — see TODO.

// ── Verdict model ────────────────────────────────────────────────────────────
export const VERDICT = Object.freeze({
  GREEN: 'GREEN', // CLAMPED: price bounded to last close ± band, market-status aware → safe
  YELLOW: 'YELLOW', // SUSPENDED: liquidations/borrows paused on staleness/confidence/status → safe but blunt
  RED: 'RED', // NAIVE: liquidates against stale/DEX price, no closed-market guard → gap-exposed
  UNKNOWN: 'UNKNOWN', // could not determine — NOT safe by default
});

// A ClosedMarketPolicy is what we re-derive from chain state for each (venue × equity).
// guard ∈ CLAMP_BAND | SUSPEND | NONE | UNKNOWN. priceSource is informational only —
// per the RED-hunt meta-finding, the vendor does NOT determine the verdict; the guard does.
export function classify(policy) {
  switch (policy.guard) {
    case 'CLAMP_BAND': return VERDICT.GREEN; // deliberate market-status band to last close
    case 'SUSPEND': return VERDICT.YELLOW; // deliberate market-status / confidence pause
    case 'STALENESS_ONLY': return VERDICT.YELLOW; // no market-status code; weekend safety is ACCIDENTAL (feed downtime × short staleness) and fragile
    case 'NONE': return VERDICT.RED; // liquidates on stale/DEX price with no guard
    default: return VERDICT.UNKNOWN;
  }
}

// Rough Act-1 exposure estimate for a RED venue: given a Monday-open gap, how far can a
// position be liquidated away from post-gap fair value before the guard (none) catches it.
// Returns fraction of collateral value exposed as potential bad debt / unfair liquidation.
export function stressExposure({ ltv, liqThreshold, guard }, gapPct) {
  if (guard !== 'NONE') return null; // only an unguarded (RED) venue has a definable gap exposure
  if (ltv == null || liqThreshold == null) return null;
  const gap = Math.abs(gapPct);
  // A position healthy at Friday close (LTV ≤ liqThreshold) becomes underwater by ~ the
  // gap minus the equity buffer (1 - liqThreshold). Exposure = shortfall vs post-gap value.
  const buffer = Math.max(0, liqThreshold - ltv); // headroom in price terms
  const shortfall = Math.max(0, gap - buffer);
  return +(shortfall).toFixed(4);
}

// ── Target registry (2026-07-23 RED-hunt) ────────────────────────────────────
// provenance: 'onchain' = re-execution confirmed | 'research' = secondary-source provisional | 'unknown'
export const TARGETS = [
  {
    venue: 'Kamino', chain: 'solana', role: 'collateral',
    program: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
    market: '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua', // dedicated xStocks market
    reserve: 'UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d', // SPYx reserve (liquidity.mint@128 ✓, stale=0)
    oracle: '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH', // Scope-owned (HFn8GnPA…) — market-status/Chainlink aggregator
    equities: ['SPYx', 'QQQx', 'AAPLx', 'NVDAx', 'TSLAx', 'GOOGLx', 'MSTRx', 'HOODx'],
    policy: { priceSource: 'Scope aggregator (Chainlink Data Streams xStocks feed w/ market-status)', guard: 'CLAMP_BAND', ltv: 0.70, liqThreshold: 0.80 },
    provenance: 'onchain-oracle+primary-source', // oracle WIRING re-execed on-chain; band %-deviation still primary-source
    // ON-CHAIN CONFIRMED (kamino-reserve.mjs): the SPYx reserve UvXjBuC7… (xStocks market 5wJeMrUY…) prices
    // SPYx off a SCOPE oracle account 3t4JZcue… (owned by Scope prog HFn8GnPA…), NOT a raw pushed feed. It does
    // NOT reference Jupiter's source_type=7 price A2GDb4Um… (absent from the reserve buffer). Scope is the
    // market-status/Chainlink-DS-capable aggregator — categorically different oracle architecture from Jupiter.
    note: 'GREEN — CLAMP. Oracle wiring re-executed on-chain (Scope aggregator, not a raw 24/7 pushed feed — '
      + 'the opposite architecture to Jupiter\'s RED). The band itself is primary-source (Chainlink post + Kamino gov): '
      + 'xStocks feed carries real-time MARKET-STATUS + staleness, and Kamino accepts a weekend/off-hours price ONLY '
      + 'within a custom %-deviation of last market close = protocol-side band (the meta-finding). NOTE: weekend-liveness '
      + 'canNOT prove GREEN (a Scope/Chainlink feed may still tick; the clamp is in-program). Remaining rigor: decode the '
      + 'exact band %-deviation from the reserve config / Scope price chain.',
  },
  {
    venue: 'Drift', chain: 'solana', role: 'perp',
    equities: [], // equity perps not yet live as of Dec 2025
    policy: { priceSource: 'Pyth (oracle-priced liq)', guard: 'SUSPEND', ltv: null, liqThreshold: null },
    provenance: 'research', note: 'Pauses fills/liquidations on extreme oracle error.',
  },
  {
    venue: 'NestUSD', chain: 'solana', role: 'collateral',
    program: 'HxbLPNuQD7KKDVQoSQgY1cLMLrsaoseT65Xoczh7zHQW',
    equities: ['SPYx', 'QQQx', 'AAPLx', 'MSFTx', 'GOOGLx', 'NVDAx', 'TSLAx'],
    // CODE-CONFIRMED (re-executed deployed source, github.com/NestUSD/contracts):
    // liquidation (ix/liquidation/two_step.rs::start_liquidation_with_oracle) prices via
    // domain::lower_confidence_bound — guards are ONLY: staleness ≤ 120s
    // (MAX_XSTOCK_PRICE_STALENESS_SECONDS=120) + confidence width ≤ max_confidence_bps (~100–200bps).
    // grep across repo: ZERO market-hours / market-status / band / clamp / weekend refs.
    // Oracle = Pyth Lazer (low-latency signed) + optional NEST self-signed price (NESTPRC1).
    policy: { priceSource: 'Pyth Lazer/Pro single-stock 24/5 (+NEST self-signed)', guard: 'STALENESS_ONLY', ltv: 0.60, liqThreshold: 0.75 },
    provenance: 'onchain',
    // Resolved fact: Pyth Lazer/Pro SINGLE-STOCK equity feeds are 24/5 (Blue Ocean ATS), closed
    // weekends; only Pyth *Indices* are 24/7. So the feed stops Fri ~20:00 ET → the 120s staleness
    // gate fires → borrows+liquidations halt all weekend. No stale-price weekend liquidation occurs.
    note: 'YELLOW but ACCIDENTAL + FRAGILE, not the advertised design. (1) Zero market-status code exists; the advertised "closure pause" is unimplemented. (2) Weekend safety is a side effect of 24/5 feed downtime × 120s staleness ceiling — one config change away from RED (raise max_staleness past the weekend, switch to a 24/7 Indices feed, or push a NEST self-signed price to keep it "fresh"). (3) Overnight (24/5 Blue Ocean, thin book) liquidations run unless confidence exceeds ~1–2% cap. (4) Separate RED vector: NEST-operated ed25519 self-signed price path (NESTPRC1) lets the operator set the price. NOT a clean gap-loss RED — the predicted stale-price weekend liquidation does not occur.',
  },
  {
    venue: 'Jupiter Lend', chain: 'solana', role: 'collateral+multiply',
    program: 'oracle jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc', // Fluid/Instadapp, @626b177f
    equities: ['SPYx', 'QQQx', 'TSLAx', 'NVDAx'],
    priceAccount: 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff', // SPYx source_type=7 pushed price — feed probeOnChain reads
    // LIVE RE-EXEC (weekend-liveness.mjs, 2026-07-25/26 closed window): 3046 updates in 66h,
    // 2396 of them while US equities CLOSED, max gap 20.8 min → LIVE_THROUGH_CLOSURE → guard NONE.
    // The RED is now reproducible on demand, not a static note: `node weekend-liveness.mjs A2GDb4Um… "Jupiter SPYx"`.
    // CODE-CONFIRMED (Instadapp/fluid-solana-programs @626b177f, the Jupiter-Lend audit commit):
    // oracle modules (pyth.rs / chainlink.rs) guard ONLY with staleness + confidence:
    //   MAX_AGE_LIQUIDATE = 7200s (2h!) — "less requirements on liquidate() to keep protocol safe"
    //   MAX_AGE_OPERATE   = 600s; confidence reject at 4% (liquidate) / 2% (operate).
    // grep across oracle+vaults: ZERO market-hours / market-status / band / clamp refs.
    // Jupiter's OWN docs admit the unmitigated closed-market deviation (freeze vs tradeable token).
    policy: { priceSource: 'Fluid oracle (Pyth/Chainlink), 2h liquidate staleness', guard: 'NONE', ltv: 0.70, liqThreshold: 0.80 },
    provenance: 'onchain-airtight',
    // AIRTIGHT (mainnet-confirmed 2026-07-23): 8 xStock vaults (#77–84, CF 65–75% / LT 75–85%,
    // supply=Backed "Xs" mints, borrow=USDC/JupUSD). Each vault's oracle PDA holds a single
    // source_type=7 (a 24/7 pushed price account, jupnw-owned, e.g. BJWkdfRiH2…). That price
    // account updates ~every 1.6 min INCLUDING WEEKENDS — 968 updates Sat 07-18, 1003 Sun 07-19,
    // max gap 6 min across a full 6-day span. So the price NEVER goes stale on weekends → the 2h
    // MAX_AGE_LIQUIDATE staleness gate NEVER fires → liquidations run 24/7 while the US market is
    // shut, with NO market-status guard and NO band to sanity-check vs last official close.
    note: 'RED — airtight. Unlike NestUSD (24/5 feed stops → 120s staleness halts weekend liquidations = accidentally safe), Jupiter\'s xStock oracle is a 24/7 pushed price that keeps updating all weekend, so its 2h staleness never fires and liquidations execute against a price the regulated US market never printed — the exact unmitigated closed-market deviation Jupiter\'s own docs warn about, now confirmed live. Second-largest xStock lending venue. Final characterization (for the artifact): whether the weekend value tracks the thin on-chain/DEX price (manipulation vector) or a re-pushed frozen close (stale-price vector) — both RED.',
  },
];

// ── On-chain adapter ─────────────────────────────────────────────────────────
// The RED half is now RE-EXECUTABLE from chain state (weekend-liveness.mjs): if the price
// account a venue liquidates against keeps updating THROUGH the closed-market window, the venue
// has no market-status guard → NONE → RED. This is the observable that made Jupiter airtight.
//
// Asymmetry (deliberate): LIVE_THROUGH_CLOSURE proves NONE/RED. It does NOT prove GREEN — a
// GREEN venue's feed may still tick while the venue's PROGRAM clamps it to last close ± band.
// So probeOnChain confirms RED live; GREEN still needs the reserve band/market-status decode
// (Kamino: Chainlink Data Streams market-status feed + custom-% band — primary-source confirmed,
//  on-chain config decode is the remaining rigor step).
import { weekendLiveness } from './weekend-liveness.mjs';
export async function probeOnChain(target, rpcUrl = process.env.RPC) {
  if (!target?.priceAccount) throw new Error(`probeOnChain: target ${target?.venue} has no priceAccount to observe`);
  const live = await weekendLiveness(target.priceAccount, { rpcUrl, hoursBack: 72 });
  // map the liveness signal onto a guard classification (RED side only)
  const guard = live.signal === 'LIVE_THROUGH_CLOSURE' ? 'NONE'
    : live.signal === 'FROZEN_THROUGH_CLOSURE' ? 'STALENESS_ONLY' // feed-halt safety (accidental) — YELLOW, not proven GREEN
      : 'UNKNOWN';
  return { venue: target.venue, priceAccount: target.priceAccount, liveness: live, guardFromLiveness: guard, verdictFromLiveness: classify({ guard }) };
}

// ── Report (runs today on the provisional registry) ──────────────────────────
export function report(targets = TARGETS) {
  const GAP = -0.20; // stress: 20% Monday-open gap down
  return targets.map((t) => {
    const verdict = classify(t.policy);
    const exposure = stressExposure(t.policy, GAP);
    return { ...t, verdict, exposureAt20pctGap: exposure };
  });
}

// CLI: `node verify-cmls.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = report();
  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', UNKNOWN: '❓' };
  console.log('\nVesper — CMLS league table (provisional, stress = 20% Monday gap)\n');
  for (const r of rows) {
    const exp = r.exposureAt20pctGap ? ` — exposure ${(r.exposureAt20pctGap * 100).toFixed(0)}% of collateral` : '';
    console.log(`  ${emoji[r.verdict]} ${r.verdict.padEnd(7)} ${r.venue.padEnd(13)} [${r.provenance}]${exp}`);
    console.log(`      ${r.note}`);
  }
  console.log('\n  ⚠ provenance=research/unknown are NOT verdicts yet — on-chain re-exec pending.\n');
}

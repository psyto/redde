// Vesper — VerifiableClaim (M0). Redde lineage: zero-dep, deterministic, verifiable.
//
// A claim is a re-executable statement, not an assertion. Anyone can reproduce its verdict from
// the pinned inputs with `verify.mjs` — "Don't trust, re-execute." This is the atomic unit of the
// re-execution truth network: run it single-node today, stake/dispute it tomorrow. A claim carries
//   • subject          — what is judged (venue × asset × price account)
//   • invariant        — the deterministic rule + the module that decides it
//   • inputs.observed  — the pinned chain observation (raw update-times) → offline re-execution
//   • inputs.trusted   — the ONLY trusted data (the holiday calendar); oracle_inputs is empty here
//   • verdict          — 🔴/🟡/🟢 + stress $ figures
//   • claim_id         — content hash of the semantic body → two nodes re-executing agree byte-for-byte
//
// The verdict is 100% endogenous re-execution over chain state + calendar: no price oracle is
// trusted to decide RED. That is what makes CMLS the clean founding claim.

import { createHash } from 'node:crypto';
import { classifyUpdateTimes } from './weekend-liveness.mjs';
import { classify, stressExposure } from './verify-cmls.mjs';
import { CALENDAR_2026 } from './campana.mjs';
import { merkleRoot } from './merkle.mjs';

export const CLAIM_SCHEMA = 'vesper.claim/v0';

// Canonical JSON: recursively sort object keys so identical content always serializes identically.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

// Content address over the SEMANTIC body only (excludes attestation/reproduce/emitted metadata).
// → two independent nodes that re-execute the same window produce the SAME claim_id. That equality
// is the network's agreement primitive; a mismatch is a provable, disputable disagreement.
export function claimBody(c) {
  return { schema: c.schema, claim_type: c.claim_type, subject: c.subject, invariant: c.invariant, inputs: c.inputs, computation: c.computation, verdict: c.verdict };
}
export function claimId(c) { return 'vc_' + sha256(canonical(claimBody(c))).slice(0, 40); }

// signal → guard → verdict flag (shares verify-cmls.mjs's classifier; single source of truth).
export function guardFromSignal(signal) {
  return signal === 'LIVE_THROUGH_CLOSURE' ? 'NONE'
    : signal === 'FROZEN_THROUGH_CLOSURE' ? 'STALENESS_ONLY'
      : signal === 'NO_DATA' ? 'UNKNOWN' : 'UNKNOWN';
}

// ── Pure re-derivation cores (shared by emit + verify = single source of truth) ───────────────
// Each claim_type has ONE deterministic function from pinned inputs → verdict. verify.mjs runs the
// SAME function on the claim's embedded inputs, so emit and verify can never drift.
export function reexecCmls(updateTimes) {
  const computation = classifyUpdateTimes(updateTimes);
  const guard = guardFromSignal(computation.signal);
  return { computation, guard, flag: classify({ guard }) };
}
// Redde-lineage solvency: re-derive the verdict from re-computed quantities. GREEN iff recomputed
// backing ≥ liability, redeemable backing is proven on-chain, and no records are stale.
export function reexecSolvency(q) {
  const inv1_ok = BigInt(q.virtualValue) >= BigInt(q.liability);
  const inv2b_ok = q.inv2b_ok === true;
  const stale_ok = q.staleRecords === 0;
  const flag = (!inv1_ok || q.inv2b_ok === false) ? 'RED' : (inv2b_ok && stale_ok) ? 'GREEN' : 'STALE';
  return { computation: { inv1_ok, inv2b_ok, stale_ok, backing: String(q.virtualValue), liability: String(q.liability) }, flag };
}

// Build a CMLS claim from a pinned observation. `updateTimes` are the raw blockTimes of the price
// account the venue liquidates against, within [window.from_ts, window.to_ts].
export function buildCmlsClaim({ subject, window, observations, stress }) {
  const { computation, guard, flag } = reexecCmls(observations.map((o) => o.blockTime));
  const rows = (stress?.gaps ?? [0.10, 0.20, 0.30]).map((g) => {
    const exp = stressExposure({ ltv: stress?.ltv, liqThreshold: subject.liqThreshold, guard }, g);
    return { gapPct: g, exposurePctOfCollateral: exp, badDebtUsdPer100k: exp == null ? null : Math.round(exp * (stress?.positionUsd ?? 100000)) };
  });

  const claim = {
    schema: CLAIM_SCHEMA,
    claim_type: 'closed-market-liquidation-soundness',
    subject, // { venue, asset, chain, role, priceAccount, liqThreshold, borrowFactor }
    invariant: {
      id: 'CMLS',
      statement: 'A lending venue must not liquidate tokenized-equity collateral against a price that keeps updating while the underlying US equity market is CLOSED, with no market-status guard.',
      module: 'weekend-liveness.mjs::classifyUpdateTimes',
      version: '0',
    },
    inputs: {
      // the ONLY trusted data — a versioned holiday calendar. Everything else is re-executed.
      trusted: { market_id: 'US_EQUITIES_REGULAR', calendar_version: CALENDAR_2026.version },
      // explicitly empty: the RED verdict is pure re-execution over chain state + calendar.
      // No price oracle is trusted to decide it. (This is the "verify computation, not inputs" line.)
      oracle_inputs: [],
      window, // { from_ts, to_ts, from_iso, to_iso }
      // canonical, by unique tx signature (successful updates only) → omission/fabrication are exact.
      // merkle_root commits the set in 32 bytes so a fraud proof can be checked in O(log n) on-chain.
      observed: { source: 'getSignaturesForAddress (successful updates, by signature)', account: subject.priceAccount, count: observations.length, merkle_root: merkleRoot(observations), observations },
    },
    computation,
    verdict: {
      flag, guard,
      reason: guard === 'NONE'
        ? `The price account updated ${computation.closedUpdates}× while the US equity market was CLOSED (max gap ${computation.maxGapMin} min) with no market-status halt — so liquidations execute against a price the regulated market never printed.`
        : `liveness signal = ${computation.signal}`,
      stress: { positionUsd: stress?.positionUsd ?? 100000, ltv: stress?.ltv ?? null, liqThreshold: subject.liqThreshold, rows },
    },
    reproduce: {
      level1_offline: 'node verify.mjs <claim.json>           # re-execute the verdict from embedded observations (zero-dep, no RPC)',
      level2_onchain: 'node verify.mjs <claim.json> --fetch   # re-pull the observations from Solana and confirm they are authentic',
    },
    attestation: { node: 'anon', sig: null, emitted_ts: Math.floor(Date.now() / 1000) },
  };
  claim.claim_id = claimId(claim);
  return claim;
}

// Build a solvency claim (claim_type #2) from a Redde re-computation — the SAME schema as CMLS.
// This is the "1 network × N claim types" demonstration: one verifiable-claim substrate, many invariants.
export function buildSolvencyClaim({ subject, window, quantities }) {
  const { computation, flag } = reexecSolvency(quantities);
  const claim = {
    schema: CLAIM_SCHEMA,
    claim_type: 'reserve-solvency',
    subject, // { protocol, asset, chain, stateAccount }
    invariant: {
      id: 'SOLVENCY',
      statement: 'A staking/reserve protocol’s claimed backing must be independently recomputable from chain state at the pinned slot, cover its liability, and carry no stale records.',
      module: 'claim.mjs::reexecSolvency (quantities from redde/verify-marinade.mjs)',
      version: '0',
    },
    inputs: {
      trusted: { chain: subject.chain },
      oracle_inputs: [], // solvency is recomputed from chain state; no price oracle decides it
      window, // { epoch, snapshotSlot }
      observed: { source: 'redde re-computation (verify-marinade.mjs)', quantities },
    },
    computation,
    verdict: {
      flag,
      reason: flag === 'GREEN'
        ? 'Recomputed backing covers liability; redeemable backing proven on-chain; no stale records.'
        : `inv1_ok=${computation.inv1_ok} inv2b_ok=${computation.inv2b_ok} stale_ok=${computation.stale_ok}`,
    },
    reproduce: {
      level1_offline: 'node verify.mjs <claim.json>              # re-derive the verdict from the recomputed quantities (offline)',
      level2_onchain: 'node ../redde/verify-marinade.mjs --json  # re-compute the quantities from mainnet at the pinned slot',
    },
    attestation: { node: 'anon', sig: null, emitted_ts: Math.floor(Date.now() / 1000) },
  };
  claim.claim_id = claimId(claim);
  return claim;
}

// closed-market price-GUARD (claim_type #3, GREEN side): does the venue BOUND the price it liquidates
// against — a heuristic band + a twap-divergence limit + tight staleness — rather than read a raw unguarded
// feed? BOUNDED → GREEN. A raw feed with none of these (cf. Jupiter) is NONE → RED. The re-derivation is
// pure over the pinned on-chain guards; the emitter decoded them from the reserve (scope-price.mjs).
export function reexecPriceGuard(g) {
  const hasHeuristic = g.heuristicHi > g.heuristicLo && g.heuristicLo > 0;
  const hasTwapBand = g.maxTwapDivPct > 0 && g.maxTwapDivPct < 100;
  const hasStaleness = g.maxAgePriceS > 0 && g.maxAgePriceS <= 3600;
  const bounded = hasHeuristic && hasTwapBand && hasStaleness;
  return { computation: { hasHeuristic, hasTwapBand, hasStaleness, bounded, maxTwapDivPct: g.maxTwapDivPct, maxAgePriceS: g.maxAgePriceS }, flag: bounded ? 'GREEN' : 'RED' };
}

// Build a price-guard claim (#3) — SAME schema, N-th invariant. HONEST by construction: the verdict grades
// only the ON-CHAIN guard set; the note records that the last-close CLAMP is upstream Chainlink (off-chain).
export function buildPriceGuardClaim({ subject, accounts, guards, values, window }) {
  const { computation, flag } = reexecPriceGuard(guards);
  const claim = {
    schema: CLAIM_SCHEMA,
    claim_type: 'closed-market-price-guard',
    subject, // { venue, asset, chain, role, reserve, scopeOracle }
    invariant: {
      id: 'CMLS-GUARD',
      statement: 'A venue listing tokenized equities must BOUND the price it liquidates against (heuristic band + twap-divergence limit + tight staleness) so a closed-market price cannot force an unsound liquidation; a raw unguarded feed is gap-exposed.',
      module: 'scope-price.mjs (reserve tokenInfo) + claim.mjs::reexecPriceGuard',
      version: '0',
    },
    inputs: {
      trusted: { chain: subject.chain, upstream_clamp: 'Chainlink Data Streams (OFF-CHAIN) — the last-close market-status clamp is NOT re-derived here; this grades only the on-chain guards' },
      oracle_inputs: [accounts.scopeOracle],
      window, // { observed_ts }
      observed: { source: 'Kamino reserve tokenInfo + Scope OraclePrices (getAccountInfo)', accounts, guards, values },
    },
    computation,
    verdict: {
      flag,
      reason: flag === 'GREEN'
        ? `Reserve bounds ${subject.asset}: heuristic $${guards.heuristicLo}-$${guards.heuristicHi}, ≤${guards.maxTwapDivPct}% twap-divergence, ≤${guards.maxAgePriceS}s staleness. Observed price $${values.price} is ${values.priceVsClosePct}% from last close, ${values.priceVsTwapPct}% from twap — in-band.`
        : 'no on-chain price bound found → gap-exposed',
      note: 'GREEN = on-chain BOUNDED + upstream Chainlink CLAMP. Materially safer than a zero-guard raw feed (RED), but it carries a Chainlink-Data-Streams trust dependency the RED verdict does not — the last-close clamp is off-chain and NOT re-derived here. On-chain re-execution stops at the guards.',
    },
    reproduce: {
      level1_offline: 'node verify.mjs <claim.json>       # re-derive BOUNDED/GREEN from the pinned on-chain guards',
      level2_onchain: 'node scope-price.mjs                # re-decode the reserve guards from mainnet (name@5032=="SPYx" self-validates)',
    },
    attestation: { node: 'anon', sig: null, emitted_ts: Math.floor(Date.now() / 1000) },
  };
  claim.claim_id = claimId(claim);
  return claim;
}

// ── Emit CLI: `node claim.mjs [cmls|solvency]` ────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const kind = (process.argv[2] || 'cmls').toLowerCase();
  const { writeFileSync, mkdirSync, readFileSync } = await import('node:fs');
  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', STALE: '🟡', UNKNOWN: '❓' };
  mkdirSync(new URL('./claims/', import.meta.url), { recursive: true });

  if (kind === 'solvency') {
    // claim_type #2 — wrap an existing Redde solvency re-computation into the same schema.
    const r = JSON.parse(readFileSync(new URL('../redde/marinade-result.json', import.meta.url)));
    const subject = { protocol: 'Marinade', asset: 'mSOL', chain: 'solana', stateAccount: r.target };
    const window = { epoch: r.currentEpoch, snapshotSlot: r.snapshotSlot ?? null };
    const quantities = {
      virtualValue: r.virtualValue, liability: r.liability, supplyDelta: r.supplyDelta,
      mintSupply: r.mintSupply, msolSupply: r.msolSupply, staleRecords: r.staleRecords, inv2b_ok: r.inv2b?.ok === true,
    };
    const claim = buildSolvencyClaim({ subject, window, quantities });
    writeFileSync(new URL('./claims/marinade-solvency.json', import.meta.url), JSON.stringify(claim, null, 2) + '\n');
    console.log(`\nVesper — emitting SOLVENCY claim · ${subject.protocol} ${subject.asset}`);
    console.log(`  ${emoji[claim.verdict.flag]} ${claim.verdict.flag}  backing=${claim.computation.backing} ≥ liability=${claim.computation.liability} → ${claim.computation.inv1_ok}`);
    console.log(`  claim_id: ${claim.claim_id}`);
    console.log(`  written:  claims/marinade-solvency.json`);
    console.log(`\n  reproduce (anyone, offline):  node verify.mjs claims/marinade-solvency.json\n`);
    process.exit(0);
  }

  // default: CMLS — Jupiter Lend SPYx (source_type=7 24/7 pushed price the vaults liquidate against).
  const { fetchObservations } = await import('./weekend-liveness.mjs');
  const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';
  const subject = {
    venue: 'Jupiter Lend', asset: 'SPYx', chain: 'solana', role: 'collateral+multiply',
    priceAccount: 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff',
    liqThreshold: 0.85, borrowFactor: 0.75,
  };
  const now = Math.floor(Date.now() / 1000);
  const from = now - 84 * 3600; // trailing window covering the last full closed weekend
  console.log(`\nVesper — emitting CMLS claim · ${subject.venue} ${subject.asset}\n  RPC: ${rpcUrl}\n  pinning window from ${new Date(from * 1000).toISOString()} → now\n`);
  const observations = await fetchObservations(subject.priceAccount, { rpcUrl, from, to: now });
  if (!observations.length) { console.error('  no updates fetched (RPC blocked / no data) — cannot emit.\n'); process.exit(1); }
  const bt = observations.map((o) => o.blockTime).sort((a, b) => a - b);
  const window = {
    from_ts: bt[0], to_ts: bt[bt.length - 1],
    from_iso: new Date(bt[0] * 1000).toISOString(), to_iso: new Date(bt[bt.length - 1] * 1000).toISOString(),
  };
  const claim = buildCmlsClaim({ subject, window, observations, stress: { positionUsd: 100000, ltv: 0.75, gaps: [0.10, 0.20, 0.30] } });
  writeFileSync(new URL('./claims/jupiter-spyx-cmls.json', import.meta.url), JSON.stringify(claim, null, 2) + '\n');
  console.log(`  ${emoji[claim.verdict.flag]} ${claim.verdict.flag}  ${claim.subject.venue} ${claim.subject.asset}`);
  console.log(`  observations: ${claim.computation.updates} updates (${claim.computation.closedUpdates} while CLOSED), max gap ${claim.computation.maxGapMin} min`);
  console.log(`  claim_id: ${claim.claim_id}`);
  console.log(`  written:  claims/jupiter-spyx-cmls.json`);
  console.log(`\n  reproduce (anyone, offline):  node verify.mjs claims/jupiter-spyx-cmls.json\n`);
}

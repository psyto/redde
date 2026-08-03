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
export function claimId(c) { return 'cmls_' + sha256(canonical(claimBody(c))).slice(0, 40); }

// signal → guard → verdict flag (shares verify-cmls.mjs's classifier; single source of truth).
export function guardFromSignal(signal) {
  return signal === 'LIVE_THROUGH_CLOSURE' ? 'NONE'
    : signal === 'FROZEN_THROUGH_CLOSURE' ? 'STALENESS_ONLY'
      : signal === 'NO_DATA' ? 'UNKNOWN' : 'UNKNOWN';
}

// Build a CMLS claim from a pinned observation. `updateTimes` are the raw blockTimes of the price
// account the venue liquidates against, within [window.from_ts, window.to_ts].
export function buildCmlsClaim({ subject, window, updateTimes, stress }) {
  const computation = classifyUpdateTimes(updateTimes);
  const guard = guardFromSignal(computation.signal);
  const flag = classify({ guard });
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
      observed: { source: 'getSignaturesForAddress', account: subject.priceAccount, update_times: updateTimes },
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

// ── Emit CLI: `node claim.mjs` → writes a fresh Jupiter-SPYx claim over last weekend ──────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { fetchUpdateTimes } = await import('./weekend-liveness.mjs');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';

  // Jupiter Lend — SPYx (source_type=7 24/7 pushed price the vaults liquidate against).
  const subject = {
    venue: 'Jupiter Lend', asset: 'SPYx', chain: 'solana', role: 'collateral+multiply',
    priceAccount: 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff',
    liqThreshold: 0.85, borrowFactor: 0.75,
  };
  // Pin the last full closed window: Fri 16:00 ET → Mon 09:30 ET (use a trailing 84h grab).
  const now = Math.floor(Date.now() / 1000);
  const from = now - 84 * 3600;
  console.log(`\nVesper — emitting CMLS claim · ${subject.venue} ${subject.asset}\n  RPC: ${rpcUrl}\n  pinning window from ${new Date(from * 1000).toISOString()} → now\n`);
  const updateTimes = await fetchUpdateTimes(subject.priceAccount, { rpcUrl, from, to: now });
  if (!updateTimes.length) { console.error('  no updates fetched (RPC blocked / no data) — cannot emit.\n'); process.exit(1); }
  const window = {
    from_ts: updateTimes[0], to_ts: updateTimes[updateTimes.length - 1],
    from_iso: new Date(updateTimes[0] * 1000).toISOString(), to_iso: new Date(updateTimes[updateTimes.length - 1] * 1000).toISOString(),
  };
  const claim = buildCmlsClaim({ subject, window, updateTimes, stress: { positionUsd: 100000, ltv: 0.75, gaps: [0.10, 0.20, 0.30] } });
  mkdirSync(new URL('./claims/', import.meta.url), { recursive: true });
  const out = new URL('./claims/jupiter-spyx-cmls.json', import.meta.url);
  writeFileSync(out, JSON.stringify(claim, null, 2) + '\n');
  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', UNKNOWN: '❓' };
  console.log(`  ${emoji[claim.verdict.flag]} ${claim.verdict.flag}  ${claim.subject.venue} ${claim.subject.asset}`);
  console.log(`  observations: ${claim.computation.updates} updates (${claim.computation.closedUpdates} while CLOSED), max gap ${claim.computation.maxGapMin} min`);
  console.log(`  claim_id: ${claim.claim_id}`);
  console.log(`  written:  claims/jupiter-spyx-cmls.json`);
  console.log(`\n  reproduce (anyone, offline):  node verify.mjs claims/jupiter-spyx-cmls.json\n`);
}

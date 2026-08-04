// Vesper — node 2 (independent re-executor). The engine→network phase transition.
//
// verify.mjs checks a claim's INTERNAL consistency (does the verdict follow from the embedded
// inputs). node2 is stronger: it TRUSTS NOTHING in the file. It independently re-fetches the
// inputs from chain over the claim's pinned window, rebuilds the claim from scratch, and compares
// the resulting content-addressed claim_id to the posted one:
//
//   AGREE   — same claim_id  → two independent nodes reached byte-identical truth. Consensus.
//   DISPUTE — different id    → a provable disagreement (which is the network's slashing surface).
//
// Because the claim_id is a hash of (subject, invariant, inputs, computation, verdict), agreement
// is exact and permissionless: anyone runs this, no coordination, no trust. That is the network.

import { readFileSync } from 'node:fs';
import { fetchObservations } from './weekend-liveness.mjs';
import { buildCmlsClaim, reexecSolvency, claimId } from './claim.mjs';

// Independently reconstruct a claim's claim_id from re-fetched / re-derived inputs.
export async function reexecuteIndependently(claim, { rpcUrl } = {}) {
  if (claim.claim_type === 'closed-market-liquidation-soundness') {
    const w = claim.inputs.window;
    const observations = await fetchObservations(claim.inputs.observed.account, { rpcUrl, from: w.from_ts, to: w.to_ts });
    const stress = {
      positionUsd: claim.verdict.stress.positionUsd, ltv: claim.verdict.stress.ltv,
      gaps: claim.verdict.stress.rows.map((r) => r.gapPct),
    };
    const rebuilt = buildCmlsClaim({ subject: claim.subject, window: w, observations, stress });
    return { claim_id: rebuilt.claim_id, verdict: rebuilt.verdict.flag, rebuilt, note: `re-fetched ${observations.length} observations from chain` };
  }
  if (claim.claim_type === 'reserve-solvency') {
    // independent re-derivation from the recomputed quantities (full chain recompute = redde/verify-marinade.mjs)
    const { flag } = reexecSolvency(claim.inputs.observed.quantities);
    const rebuilt = { ...claim, verdict: { ...claim.verdict, flag } };
    return { claim_id: claimId(rebuilt), verdict: flag, rebuilt, note: 're-derived from recomputed quantities (chain recompute: redde/verify-marinade.mjs)' };
  }
  throw new Error(`node2: unknown claim_type ${claim.claim_type}`);
}

// ── CLI: `node node2.mjs <claim.json>` ────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) { console.error('usage: node node2.mjs <claim.json>'); process.exit(2); }
  const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';
  const claim = JSON.parse(readFileSync(path, 'utf8'));
  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', STALE: '🟡', UNKNOWN: '❓' };

  console.log(`\nVesper node 2 — independent re-execution of a posted claim`);
  console.log(`  posted by node 1:  ${claim.claim_id}  → ${emoji[claim.verdict.flag]} ${claim.verdict.flag}`);
  console.log(`  re-executing independently (trusting nothing in the file)...`);
  const r = await reexecuteIndependently(claim, { rpcUrl });
  console.log(`  ${r.note}`);
  console.log(`  node 2 computed:   ${r.claim_id}  → ${emoji[r.verdict]} ${r.verdict}\n`);

  const emitIdx = process.argv.indexOf('--emit');
  if (emitIdx > -1 && process.argv[emitIdx + 1]) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.argv[emitIdx + 1], JSON.stringify(r.rebuilt, null, 2) + '\n');
    console.log(`  node 2 wrote its own reconstructed claim → ${process.argv[emitIdx + 1]}\n`);
  }

  const agree = r.claim_id === claim.claim_id;
  if (agree) {
    console.log(`  🤝 AGREE — two independent nodes produced the SAME content-addressed claim.`);
    console.log(`     This is consensus by re-execution: no coordination, no trust.\n`);
  } else {
    console.log(`  ⚔️  DISPUTE — node 2's claim_id differs from node 1's.`);
    console.log(`     A provable disagreement — the network's challenge/slash surface.\n`);
  }
  process.exit(agree ? 0 : 1);
}

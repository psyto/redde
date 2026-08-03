// Vesper — judge. The deterministic function IS the judge. This is what gives DISPUTE teeth.
//
// node2 detects that two nodes disagree. judge RESOLVES it, and catches the harder attack: a
// dishonest emitter who GAMES THE INPUTS — omitting closed-window updates to flip RED→GREEN, or
// fabricating observations that were never on chain. The judge rebuilds the CANONICAL input set
// from chain (the full set of updates in the pinned window), re-executes the verdict from it, and
// rules on the claim:
//
//   VALID    — inputs authentic + complete, verdict follows → nothing to slash.
//   INVALID  — inputs omitted / fabricated, or verdict wrong → provably false → SLASHABLE.
//
// Because the canonical inputs and the re-execution are both deterministic, the ruling is not an
// opinion — anyone re-runs judge and gets the same verdict. That is the network's court.

import { readFileSync } from 'node:fs';
import { fetchUpdateTimes } from './weekend-liveness.mjs';
import { reexecCmls, reexecSolvency } from './claim.mjs';

// Adjudicate a single claim against canonical chain state.
export async function adjudicate(claim, { rpcUrl } = {}) {
  if (claim.claim_type === 'closed-market-liquidation-soundness') {
    const w = claim.inputs.window;
    const canonical = await fetchUpdateTimes(claim.inputs.observed.account, { rpcUrl, from: w.from_ts, to: w.to_ts });
    const embedded = claim.inputs.observed.update_times;
    // Multiset diff: Solana blockTime is second-granularity, so same-second updates share a
    // timestamp. Counting by multiplicity (not set membership) makes omission/fabrication exact.
    const freq = (arr) => { const m = new Map(); for (const t of arr) m.set(t, (m.get(t) || 0) + 1); return m; };
    const canonF = freq(canonical), embedF = freq(embedded);
    let omitted = 0, fabricated = 0;
    for (const [t, c] of canonF) omitted += Math.max(0, c - (embedF.get(t) || 0));      // on chain, under-counted by the claim
    for (const [t, c] of embedF) fabricated += Math.max(0, c - (canonF.get(t) || 0));   // in the claim, not (that many) on chain
    const truth = reexecCmls(canonical);                          // the verdict from the FULL, honest input set
    const authentic = fabricated === 0;
    const complete = omitted === 0;
    const verdictMatches = claim.verdict.flag === truth.flag;
    const valid = authentic && complete && verdictMatches;
    const reasons = [];
    if (!authentic) reasons.push(`${fabricated} fabricated observation(s) not on chain`);
    if (!complete) reasons.push(`${omitted} closed/qualifying observation(s) omitted from the claim`);
    if (!verdictMatches) reasons.push(`claimed ${claim.verdict.flag} but canonical re-execution is ${truth.flag}`);
    return {
      claim_type: claim.claim_type, valid, slashable: !valid,
      claimedVerdict: claim.verdict.flag, truthVerdict: truth.flag,
      canonicalUpdates: canonical.length, embeddedUpdates: embedded.length,
      omitted, fabricated,
      reason: valid ? 'inputs authentic + complete; verdict follows from canonical re-execution' : reasons.join('; '),
    };
  }
  if (claim.claim_type === 'reserve-solvency') {
    // Authenticity of the recomputed quantities requires the full chain recompute
    // (redde/verify-marinade.mjs at the pinned slot). Here the judge re-derives the verdict from
    // the claimed quantities and rules on internal correctness; input authenticity is delegated.
    const truth = reexecSolvency(claim.inputs.observed.quantities);
    const valid = claim.verdict.flag === truth.flag;
    return {
      claim_type: claim.claim_type, valid, slashable: !valid,
      claimedVerdict: claim.verdict.flag, truthVerdict: truth.flag,
      reason: valid ? 'verdict follows from claimed quantities (input authenticity: re-run redde/verify-marinade.mjs)'
        : `claimed ${claim.verdict.flag} but re-derivation is ${truth.flag}`,
    };
  }
  throw new Error(`judge: unknown claim_type ${claim.claim_type}`);
}

// Resolve a dispute between two claims over the same subject: whichever matches canonical truth wins.
export async function resolve(claimA, claimB, opts) {
  const [a, b] = await Promise.all([adjudicate(claimA, opts), adjudicate(claimB, opts)]);
  const winner = a.valid && !b.valid ? 'A' : b.valid && !a.valid ? 'B' : a.valid && b.valid ? 'BOTH-VALID' : 'BOTH-INVALID';
  return { A: a, B: b, winner };
}

// ── CLI: `node judge.mjs <claim.json> [<claimB.json>]` ────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [pathA, pathB] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!pathA) { console.error('usage: node judge.mjs <claim.json> [<claimB.json>]'); process.exit(2); }
  const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';
  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', STALE: '🟡', UNKNOWN: '❓' };

  if (pathB) {
    const A = JSON.parse(readFileSync(pathA, 'utf8')); const B = JSON.parse(readFileSync(pathB, 'utf8'));
    console.log(`\nVesper judge — dispute resolution by canonical re-execution\n`);
    const r = await resolve(A, B, { rpcUrl });
    for (const [k, v] of [['A', r.A], ['B', r.B]]) {
      console.log(`  claim ${k}: ${v.valid ? '✅ VALID' : '❌ INVALID (SLASHABLE)'}  claimed ${emoji[v.claimedVerdict]}${v.claimedVerdict} vs truth ${emoji[v.truthVerdict]}${v.truthVerdict}`);
      console.log(`           ${v.reason}`);
    }
    console.log(`\n  ⚖️  winner: ${r.winner}\n`);
    process.exit(0);
  }

  const claim = JSON.parse(readFileSync(pathA, 'utf8'));
  console.log(`\nVesper judge — adjudicate one claim against canonical chain state\n`);
  console.log(`  claimed: ${emoji[claim.verdict.flag]} ${claim.verdict.flag}  (${claim.claim_type})`);
  const v = await adjudicate(claim, { rpcUrl });
  if (v.canonicalUpdates != null) console.log(`  canonical updates on chain: ${v.canonicalUpdates}  ·  embedded in claim: ${v.embeddedUpdates}  (omitted ${v.omitted}, fabricated ${v.fabricated})`);
  console.log(`  canonical re-execution: ${emoji[v.truthVerdict]} ${v.truthVerdict}\n`);
  if (v.valid) console.log(`  ✅ VALID — ${v.reason}\n`);
  else console.log(`  ❌ INVALID — SLASHABLE\n     ${v.reason}\n`);
  process.exit(v.valid ? 0 : 1);
}

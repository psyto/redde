// Vesper — succinct fraud proof. The path to TRUSTLESS enforcement.
//
// A Solana program cannot re-execute over chain history, so it cannot run the judge. The optimistic
// pattern instead: a challenger posts a SUCCINCT fraud proof, and the program verifies it in
// O(log n) — never re-fetching the full observation set. This module builds and checks such a proof
// for the CMLS omission attack (an emitter drops closed-window observations to flip the verdict).
//
// A fraud proof asserts: "the claim omitted a qualifying observation." It carries ONE witness:
//   1. market-status  — the witness's blockTime falls in the CLOSED window   (deterministic, cheap)
//   2. inclusion      — the witness is in the canonical set (merkle proof under canonical_root, O(log n))
//   3. non-membership — the witness is NOT under the claim's committed merkle_root
//   4. contradiction  — canonical_root != the claim's merkle_root
//
// What a program checks cheaply: (1) market-status (port Campana), (2) inclusion (log-sized), (4)
// root inequality. THE RESIDUAL is trust in `canonical_root` as the TRUE set — the data-availability
// gap no vanilla program can close (it can't independently enumerate historical signatures). Honest
// resolutions: a staked resolver network (EigenLayer-AVS style), the feed operator's own DA
// commitment, or a zk proof of the RPC-equivalent derivation. This module reduces trust from
// "re-run the whole judge" to "trust one 32-byte root" — and isolates exactly that residual.
//
// (3) non-membership is shown here directly against the claim's embedded set; the fully on-chain
// form is a sorted-merkle non-membership (adjacency) proof — a documented extension.

import { readFileSync } from 'node:fs';
import { marketStatus, STATUS } from './campana.mjs';
import { merkleRoot, inclusionProof, verifyInclusion, leafHash, indexOf } from './merkle.mjs';

// Build a fraud proof that `claim` omitted a closed-window observation present in `canonical`.
export function proveOmission(claim, canonical) {
  const claimSigs = new Set(claim.inputs.observed.observations.map((o) => o.sig));
  const w = claim.inputs.window;
  const witness = canonical.find((o) =>
    !claimSigs.has(o.sig) && o.blockTime >= w.from_ts && o.blockTime <= w.to_ts &&
    marketStatus(o.blockTime).status === STATUS.CLOSED);
  if (!witness) return null; // no omission found
  const idx = indexOf(canonical, witness);
  return {
    claim_id: claim.claim_id,
    claim_root: claim.inputs.observed.merkle_root,
    canonical_root: merkleRoot(canonical),
    canonical_count: canonical.length,
    witness, market_status: 'CLOSED',
    inclusion: inclusionProof(canonical, idx),
  };
}

// Verify a fraud proof the way a program would — cheaply, without the full set.
export function verifyFraudProof(claim, proof) {
  const w = claim.inputs.window;
  const checks = [];
  // (1) market-status: witness is in the CLOSED window (deterministic)
  const st = marketStatus(proof.witness.blockTime).status;
  checks.push(['witness is a closed-market observation', st === STATUS.CLOSED && proof.witness.blockTime >= w.from_ts && proof.witness.blockTime <= w.to_ts, st]);
  // (2) inclusion: witness ∈ canonical set (O(log n) merkle proof)
  checks.push(['witness proven in canonical set (merkle, log n)', verifyInclusion(proof.canonical_root, leafHash(proof.witness), proof.inclusion), `${proof.inclusion.length} siblings`]);
  // (3) non-membership: witness ∉ the claim's committed set  [direct here; sorted-merkle proof on-chain]
  const inClaim = claim.inputs.observed.observations.some((o) => o.sig === proof.witness.sig);
  checks.push(['witness absent from the claim set', !inClaim, inClaim ? 'present' : 'absent']);
  // (4) contradiction: the two roots disagree, and the proof targets THIS claim
  checks.push(['proof targets this claim (root matches)', proof.claim_root === claim.inputs.observed.merkle_root, '']);
  checks.push(['canonical root differs from claim root', proof.canonical_root !== claim.inputs.observed.merkle_root, '']);
  const proven = checks.every((c) => c[1]);
  return { proven, checks };
}

// ── CLI: `node fraudproof.mjs <claim.json> <canonical-claim.json>` ────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [claimPath, canonPath] = process.argv.slice(2);
  if (!claimPath || !canonPath) { console.error('usage: node fraudproof.mjs <claim.json> <canonical-claim.json>'); process.exit(2); }
  const claim = JSON.parse(readFileSync(claimPath, 'utf8'));
  const canonical = JSON.parse(readFileSync(canonPath, 'utf8')).inputs.observed.observations;

  console.log(`\nVesper fraud proof — succinct omission proof (O(log n), not O(n))\n`);
  const proof = proveOmission(claim, canonical);
  if (!proof) { console.log('  no omission found — the claim is complete against this canonical set.\n'); process.exit(0); }
  console.log(`  witness: sig ${proof.witness.sig.slice(0, 12)}… slot ${proof.witness.slot} (${new Date(proof.witness.blockTime * 1000).toISOString().slice(0, 16)}Z)`);
  console.log(`  canonical set: ${proof.canonical_count} obs · root ${proof.canonical_root.slice(0, 16)}…`);
  console.log(`  claim root:    ${(proof.claim_root || 'none').slice(0, 16)}…`);
  console.log(`  inclusion proof: ${proof.inclusion.length} sibling hashes (vs ${proof.canonical_count} to re-fetch)\n`);

  const v = verifyFraudProof(claim, proof);
  for (const [label, ok, detail] of v.checks) console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  console.log(`\n  ${v.proven ? '⚖️  FRAUD PROVEN — the claim omitted a closed-window observation → SLASHABLE (verified in O(log n)).' : '  not proven.'}`);
  console.log(`  residual trust: canonical_root as the true set (the data-availability gap — resolver / DA / zk).\n`);
  process.exit(v.proven ? 0 : 1);
}

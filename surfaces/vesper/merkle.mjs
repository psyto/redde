// Vesper — merkle commitment over a claim's observation set. Zero-dep (node:crypto sha256).
//
// Why: a claim that embeds 3600+ raw observations is huge AND forces a verifier to re-fetch the
// whole set. A merkle ROOT commits the same set in 32 bytes, and lets anyone prove a SINGLE
// observation's membership with a log-sized proof. That is what turns O(n) re-execution into an
// O(log n) on-chain check — the basis for a succinct fraud proof a Solana program can afford.

import { createHash } from 'node:crypto';
const h = (s) => createHash('sha256').update(s).digest('hex');
const parent = (a, b) => h(a + '|' + b); // ordered concat (position matters)

// Canonical leaf: the observation's identity, hashed. Same (slot, sig) ordering as fetchObservations.
export function leafHash(o) { return h(`${o.slot}:${o.blockTime}:${o.sig}`); }
export function canonicalLeaves(observations) {
  return [...observations]
    .sort((a, b) => a.slot - b.slot || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))
    .map(leafHash);
}

export function merkleRoot(observations) {
  let level = canonicalLeaves(observations);
  if (!level.length) return h(''); // empty set
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(parent(level[i], i + 1 < level.length ? level[i + 1] : level[i]));
    level = next;
  }
  return level[0];
}

// Inclusion proof for the observation at canonical index `index`: the sibling hashes up to the root.
export function inclusionProof(observations, index) {
  let level = canonicalLeaves(observations), idx = index;
  const proof = [];
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const sibIdx = isRight ? idx - 1 : (idx + 1 < level.length ? idx + 1 : idx);
    proof.push({ sib: level[sibIdx], onRight: !isRight }); // is the sibling on the right of acc?
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(parent(level[i], i + 1 < level.length ? level[i + 1] : level[i]));
    level = next; idx = Math.floor(idx / 2);
  }
  return proof;
}

// Verify a leaf's membership under `root` given its proof — O(log n), no full set needed.
export function verifyInclusion(root, leaf, proof) {
  let acc = leaf;
  for (const { sib, onRight } of proof) acc = onRight ? parent(acc, sib) : parent(sib, acc);
  return acc === root;
}

// Canonical index of an observation in a set (by (slot, sig)), or -1 if absent.
export function indexOf(observations, obs) {
  return canonicalLeaves(observations).indexOf(leafHash(obs));
}

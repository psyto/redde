# Codex request — round 9 (signed attestation layer)

New component: `attest.mjs` (produce an ed25519-signed, content-addressed
solvency attestation) + `verify-attestation.mjs` (verify against a pinned
signer). Same trust model as a non-custodial release gate — pinned signer,
recompute hash, verify signature, check expiry. Adversarially review the crypto
and binding; this is the shape a consumer would gate real money on.

## What it does
- `bindingFrom(verdict, class, signer)` extracts `{domain, class, target, epoch,
  verdict, liability, backing, evidence_commitment, issued_at_slot, expiry_slot,
  signer}` from either checker's `--json`. `evidence_commitment = sha256(canonical(evidence))`.
- `claim_hash = sha256(canonical(binding))`; `signature = ed25519(claim_hash)` via
  `node:crypto` (native). Signer is a raw 32-byte ed25519 key, base58 like a Solana pubkey.
- Verifier: recompute `claim_hash` from `binding`, reject on mismatch; reject if
  `--pin` given and `binding.signer != pin`; ed25519 verify; expiry enforced only
  with `--at-slot`. No `--pin` → "self-consistent only, NOT authentication".

## Confirmed working (mainnet)
- JitoSOL + Marinade attest → PASS authenticated; tamper (flip verdict) → hash
  mismatch reject; wrong `--pin` → reject; no-pin → self-consistent (not auth).

## Adversarial questions (rank by "could authorize a false action")
1. **Canonical JSON fidelity.** `canonical()` sorts keys and uses `JSON.stringify`
   for scalars. Numbers here are strings (lamports) or small ints (epoch/slot). Is
   there any value (float, big int, unicode, `-0`, duplicate-after-sort) where the
   signer's canonical bytes and a verifier's differ, breaking or forging a match?
2. **Domain / class separation.** `domain = "redde-solvency-v1"` and `class` are
   inside the signed binding. Is that enough to stop a GREEN for one class/target
   being replayed as another? Should the signature domain-separate at the sign
   step (prefix), not just inside the payload?
3. **Replay / freshness.** Binding carries `issued_at_slot` + `expiry_slot` but
   verification only enforces expiry with `--at-slot`. Is a stale GREEN a real
   hazard (a pool solvent at slot S, insolvent later, attestation still verifies)?
   Should expiry be mandatory, and should the verifier fetch the current slot itself?
4. **evidence_commitment.** It hashes the checker's own reported numbers, not the
   raw chain inputs — so it commits to the producer's claim, not independently
   reproducible state. Is that honest as "evidence", or should it commit to the
   input account set (pubkeys + slot) so a verifier can re-fetch and recompute?
5. **Self-consistent footgun.** The no-`--pin` path prints PASS. Even labeled "NOT
   authentication", is a bare PASS dangerous? Should it exit non-zero / print WARN?
6. **Key handling.** Secret in `redde-signer.key` (gitignored, mode 0600),
   generated on first run. Anything unsafe in that flow?

## Deliverable
Ranked findings + minimal patches. Flag anything that lets a verifier accept an
attestation the signer did not intend (false authorization) as P0. Note: this is
NOT folded into the Liquet seam — it is the seam-ready shape, to be folded as a
`SolvencyAttestation` slot only when a real solvency-gated flow appears
(demand-not-feasibility, per Liquet's SEAM.md).

---

## Resolution (applied)

All P0s closed; verifier now separates VALIDITY from AUTHORIZATION.

- **P0 #1/#3 — authorization vs signature validity.** `verify-attestation.mjs`
  rewritten: exit **0 only** for a schema-valid, pinned-signer (`--pin`),
  unexpired **GREEN** whose `class`/`target` equal the caller's `--expect-class`
  / `--expect-target` and whose `domain == redde-solvency-v1`. Missing any of the
  three inputs → `VALID BUT NON-AUTHORIZING` (exit 2). `RED`/`STALE`, wrong/replayed
  target or class, wrong signer → `NOT AUTHORIZED` (exit 1). Tamper/bad sig →
  `INVALID` (exit 1). Verified by exit-code battery.
- **P0 #2 — expiry.** `verify-marinade.mjs` now emits `snapshotSlot`; the attester
  **refuses to sign a GREEN with no issued slot**; authorization requires a slot —
  `--at-slot` (strict non-negative integer, `NaN` rejected) or the finalized RPC
  slot, fail-closed. Schema enforces integer slots, `expiry >= issued`, TTL cap.
- **P1 #4 — honesty.** `evidence_commitment` → `report_commitment` (commits to the
  checker's reported numbers; full raw-input manifest is future work).
- **P1 #5 — domain separation.** Signature is over `SIG_CONTEXT || claim_hash`, so
  the key's signatures can't be reused as another protocol's message.
- **P2 #7 — key perms.** Loader tightens `redde-signer.key` to 0600 if lax.
- **P2 #6 — canonical JSON.** Small-int fields are cross-impl deterministic;
  full JCS + decimal-string slots remain the documented gap for external verifiers.

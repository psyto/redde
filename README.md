# Redde

> *redde rationem* — "render the account."
>
> **Solvency, whether they like it or not.**

Redde is a permissionless solvency verifier. It reconstructs a protocol's
*claimed* financial truth (backing intact, shares fully redeemable) from mainnet
state — **without the protocol's consent, cooperation, or self-report** — and
renders a verdict.

On-chain finance runs on self-attestation. A dashboard says "1:1." An audit says
"as of last quarter." Redde says: *I re-executed your claim against the chain,
now. Here is what the state actually implies.*

## Status

| Slice | Scope | Verdict | Review |
| ----- | ----- | ------- | ------ |
| **1** | JitoSOL — one SPL stake pool, full backing proof | GREEN | Codex rounds 1–4, signed off |
| **2** | Every SPL stake pool on Solana (234) — the board | 6 GREEN / 0 RED / 173 STALE-EPOCH / 55 UNVERIFIED | Codex round 5, shipped |
| **3** | Marinade (mSOL) — second invariant class (non-SPL, Anchor) | GREEN | Codex rounds 6–8, signed off |

One engine, two liquid-staking architectures, zero cooperation. No RED has ever
been manufactured; every candidate RED was caught and diagnosed before publishing
(an INV-1 over-strictness, an authority-scan spoofing gap, a record-stride error).

Documented limitation: `isOnCurve` does not enforce strict Ed25519 point
canonicality (negligible for sha256-derived PDAs; tighten before treating
derivation as adversarial).

## What this is (and is not)

- **Is:** an outward-facing verification tool. The invariant is declared in the
  open, the method is reproducible, the checker runs against public RPC.
- **Is not:** an accusation engine. Redde publishes **only** what it can
  independently recompute from public claims + public state. It targets stated
  solvency claims, not private internals. No embargoed findings, no unverifiable
  "gotchas." A `GREEN` means "the claim survives an independent backing check,"
  not "the protocol is safe."

## The stance (why an independent verifier)

A prime broker that also audits itself is not audited. A protocol that reports
its own solvency reports the solvency it wants you to see. The verifier must be
**independent of the verified** — that is the entire point. Redde does not ask
permission because permission is the corruption. See `MANIFESTO.md`.

## The verdict model

| verdict | meaning |
| ------- | ------- |
| `GREEN` | authentic + fresh state, and every invariant holds — the claim survives independent recomputation |
| `RED`   | an invariant fails — the chain state contradicts the stated claim, reproducible by anyone |
| `STALE` | the claim cannot be recomputed now (opaque/mutating/unfresh state, or an RPC that won't serve the needed reads). Not a pass — an unverifiable claim is a published property. |

On the population board a fourth label, `UNVERIFIED`, marks a fresh pool whose
backing could not be read this cycle under RPC limits — a coverage gap, not a
finding.

## Files

- `MANIFESTO.md` — the stance, long form.
- `INVARIANT_SPEC.md` — the SPL stake-pool invariant set (class #1), exact
  accounts and formulas.
- `verify.mjs` — the SPL stake-pool checker. Zero deps (Node 18+).
- `verify-marinade.mjs` — the Marinade (mSOL) checker, invariant class #2. Zero deps.
- `scan.mjs` — audit every SPL stake pool → 3-state board data (`scan-results.json`).
- `attest.mjs` / `verify-attestation.mjs` — turn a verdict into an ed25519-signed,
  content-addressed attestation, and verify it against a pinned signer.
- `enumerate.mjs` — list all SPL stake pools (scouting).
- `gen-board.mjs` — render `site/board.html` from the scan + Marinade result.
- `probe.mjs`, `probe-marinade.mjs`, `probe-marinade2.mjs` — layout/offset probes
  used to confirm byte layouts empirically against mainnet.
- `review/` — the adversarial-review log: 8 rounds of red-teaming (builder ↔
  independent reviewer) that caught every false GREEN / false RED before shipping.
- `site/index.html` — the manifesto + JitoSOL exhibit (the weapon's face).
- `site/board.html` — the full-population board across both invariant classes.

## Run

```
# any mainnet RPC; reads only, no debug/trace. Defaults to the public endpoint.
export SOLANA_RPC_URL=...

node verify.mjs                    # JitoSOL (default SPL stake-pool target)
node verify.mjs --json <pool>      # machine-readable, any stake-pool pubkey
node verify-marinade.mjs           # Marinade (mSOL) verdict
node verify-marinade.mjs --json

node scan.mjs                      # audit all SPL stake pools -> scan-results.json
node verify-marinade.mjs --json > marinade-result.json
node gen-board.mjs                 # build site/board.html from the two above
```

A `GREEN`/`RED` verdict needs an RPC that serves `getProgramAccounts` for the
Stake and Marinade programs; the default public endpoint throttles it, so most of
the long-tail pools fall to `UNVERIFIED` on it. A dedicated RPC closes that gap.

### Class #1 — SPL stake pools (JitoSOL, epoch 1004)

```
verdict: [ GREEN ]   (704 validators, single finalized slot)
INV-1  no excess minting        hold ✓   mint <= header pool_token_supply
INV-2a validator-list reconc.   hold ✓   reserve + list >= claimed total
INV-2b canonical backing proof  hold ✓   redeemable 10,029,277.75 SOL >= claimed
                                10,029,213.19 SOL   (707 usable PDAs, 0 unusable,
                                1 non-canonical ignored, reserve rent excluded)
```

Backing summed only from validator-derived canonical PDAs whose staker,
withdrawer, lockup and vote delegation prove the pool can spend them; reserve
rent excluded; single finalized slot with a pool + validator-list mutation guard.

### Class #2 — Marinade (mSOL, epoch 1004)

```
verdict: [ GREEN ]   (48 stake records, 0 stale)
M-INV-1  no excess minting      hold ✓   mint 1,708,592.412 <= state 1,708,592.415 mSOL
liability (redeemable)          2,383,199.196 SOL   (mint * virtual_value / msol_supply)
M-INV-2b independent backing    hold ✓   net 2,383,216.708 SOL   (margin +17.512)
                                48/48 listed stakes usable, 1077 tickets reconciled
```

Backing inventory comes from Marinade's own `stake_list` (not an authority scan a
third party could spoof); each listed stake verified Stake-owned with both
authorities equal to the `[state,"deposit"]` / `[state,"withdraw"]` PDAs and
counted rent-net; unstake tickets enumerated, deducted, and reconciled exactly to
the header; `msol_price` (display-only) and the LP leg excluded.

## Invariant classes

Redde is one engine — PDA derivation, rent-net backing, list-as-truth inventory,
freshness gate, full-snapshot mutation guard — pointed at a per-protocol invariant
set. Adding a protocol means describing its custody and its liability, not
rebuilding the machine.

- **Class #1 — SPL stake pools.** `INVARIANT_SPEC.md`. INV-1 (no excess minting),
  INV-2a (validator-list reconciliation, gate only), INV-2b (usable canonical-PDA
  backing ≥ required backing).
- **Class #2 — Marinade.** `verify-marinade.mjs` + `CODEX_HANDOFF_6.md`. M-INV-1,
  M-INV-2b (stake_list-sourced backing ≥ liability), with `msol_price` and LP leg
  excluded and unstake tickets deducted.

## Signed attestations (seam-ready)

A verdict can be emitted as an ed25519-signed, content-addressed attestation —
same trust model as a non-custodial release gate. **Signature validity and
authorization are separate outcomes**, because a validly-signed `RED` is still a
valid signature over a "no" — treating it as success would be the whole bug.

```
node verify.mjs --json          | node attest.mjs --class spl        # signed attestation
node verify-marinade.mjs --json | node attest.mjs --class marinade

# authorize a real action — ALL of --pin, --expect-class, --expect-target required:
... | node verify-attestation.mjs --pin <signer> --expect-class marinade \
        --expect-target <pubkey>            # AUTHORIZED (exit 0) only if pinned-signer,
                                            # unexpired GREEN for that exact class+target
... | node verify-attestation.mjs           # VALID BUT NON-AUTHORIZING (exit 2) — inspection
```

The attestation binds `{domain, class, target, epoch, verdict, liability,
backing, report_commitment, issued_at_slot, expiry_slot, signer}`, signed over a
context-prefixed content hash. The verifier exits **0 only** for a pinned-signer,
schema-valid, unexpired **GREEN** matching the caller's demanded class + target;
every other case (wrong signer, `RED`/`STALE`, wrong/replayed target or class,
expired, tampered, or unpinned) fails closed with a non-zero exit — a money path
cannot mistake a valid signature for an authorization. Expiry is checked against
the finalized RPC slot (or `--at-slot`), fail-closed. `report_commitment` commits
to the checker's *reported* numbers, not the raw chain inputs — so it is a
convenience, and the real check is to re-run the checker and reproduce the verdict.

This is the drop-in shape that folds into an independent non-custodial
verification gate as a `SolvencyAttestation` slot the moment a real
solvency-gated flow needs it — deliberately not folded speculatively.

## Roadmap

1. ✅ One target, one invariant, live independent backing proof (Slice 1).
2. ✅ N targets — every SPL stake pool as a 3-state board (Slice 2).
3. ✅ A second invariant class proving the engine generalizes (Slice 3, Marinade).
4. A dedicated RPC to close the `UNVERIFIED` coverage gap → complete SPL coverage.
5. Off-chain-backed assets (stablecoins, wrapped tokens): the honest verdict is
   `STALE` — "this peg cannot be verified from the chain" — which is itself a finding.
6. Continuous run → a public status page that turns RED in real time.
7. Re-execution (not just reads): replay protocol logic against forked state to
   check invariants static reads cannot reach.

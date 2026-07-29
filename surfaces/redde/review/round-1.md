# Codex review request — Redde Slice 1 checker

**Role split:** CC (Claude Code) built and empirically validated this slice.
You (Codex) are the convergence/review pass — adversarial correctness + layout
verification against the authoritative source. Return concrete findings and
patch suggestions; the user pastes them back to CC to apply.

## What to read
- `verify.mjs` — the checker (zero-dep, Node 18+). Primary review target.
- `INVARIANT_SPEC.md` — INV-1 / INV-2 definitions.
- `probe.mjs` — the empirical offset probe (context only).

## What CC already established (empirically, on JitoSOL mainnet)
Stake pool `Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb`, pool epoch 1004:
- Header offsets confirmed: `poolMint@162` decodes to the known JitoSOL mint
  `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` (validates the whole offset chain).
- `validatorList` account size = `9 + 10000*73 = 730009` bytes exactly →
  header = AccountType(1) + max_validators(u32) + vec_len(u32) = 9 bytes; item = 73.
- Reconstructed backing (reserve + Σ active + Σ transient over 704 validators)
  = 10,029,213.0609306 SOL vs header total 10,029,213.0586477 SOL. Difference is
  exactly one rent-exempt stake minimum (2,282,880 lamports). INV-1 exact. → GREEN.

So the happy-path decode is almost certainly correct. Your job is what's *wrong,
unsafe, or incomplete*, not to re-confirm the happy path.

## Verify against upstream source
Pull the canonical layout from `solana-program-library` (stake-pool program,
`program/src/state.rs`) — `StakePool`, `ValidatorList`, `ValidatorStakeInfo` —
and confirm/refute:
1. The header field byte offsets in `verify.mjs` `OFF` (validatorList 98,
   reserveStake 130, poolMint 162, totalLamports 258, poolTokenSupply 266,
   lastUpdateEpoch 274).
2. `ValidatorStakeInfo` = 73 bytes with `active_stake_lamports` @0 and
   `transient_stake_lamports` @8 (both little-endian u64).
3. Whether these offsets are **stable across stake-pool program versions**, or
   whether any deployed version reorders/pads fields before `lastUpdateEpoch`.

## Adversarial correctness questions (rank by severity)
1. **Owner check.** `verify.mjs` accepts any account with `data[0]==1` and
   length ≥ 282. It does NOT verify the account is owned by the SPL stake-pool
   program. Can a spoofed account forge a GREEN? Propose the fix.
2. **Epoch staleness.** `total_lamports` and the validator list's recorded
   active/transient are refreshed once per epoch (UpdateStakePoolBalance). If
   `lastUpdateEpoch < currentEpoch`, INV-2 reconciles a stale header against a
   stale list — internally consistent but not *current*. Should an out-of-date
   pool render STALE instead of GREEN? Is INV-2 (header-vs-list) even meaningful,
   given both come from the pool's own self-report?
3. **The real INV-2.** The honest backing check reads each validator's *actual*
   stake account lamports, not the list's recorded figure (roadmap item 4). Is
   the current header-vs-list check worth shipping as GREEN, or does it overclaim?
   Where exactly should the spec's honesty boundary be redrawn?
4. **Tolerance sign / mid-transient states.** `ε_rent` only forgives `controlled`
   falling *short* by up to `(count+1) * rent_exempt`. Correct direction? Does
   counting transient stake (activating/deactivating) inflate or deflate the
   floor? Any state (deactivating, manager fee, PreferredValidator) that breaks it?
5. **STALE completeness / BigInt edges.** Mint decimals assumed to match pool
   share decimals — safe? Any RPC-shape or empty-vec edge that throws instead of
   rendering STALE?

## Deliverable
A ranked list of findings (severity + concrete failure scenario) and, for each,
a minimal patch to `verify.mjs` / `INVARIANT_SPEC.md`. Flag anything that could
make Redde publish a *false GREEN* (worst case) as P0.

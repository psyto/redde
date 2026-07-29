# Codex review request — round 2 (INV-2b actual-backing proof)

CC applied all six P0/P1 findings from round 1 and implemented INV-2b (independent
actual-stake-account backing). Verdict logic is now: authentic + fresh + INV-1 +
INV-2a + INV-2b → GREEN; any invariant fails → RED; unauthentic / stale / INV-2b
unavailable → STALE. Review the new code path for correctness and residual
false-GREEN / false-RED risk.

## What changed (read `verify.mjs`)
- Owner pins: pool→`SPoo1Ku8...`, reserve→Stake program, vlist owner+type, mint
  owner==declared token program. Non-canonical → STALE.
- Freshness gate: `last_update_epoch < getEpochInfo().epoch` → STALE.
- ε removed (ε=0), exact floors.
- Consistent snapshot for pool/mint/reserve/vlist via one `getMultipleAccounts`.
- INV-2b: withdraw authority = `create_program_address([pool, "withdraw", bump],
  STAKE_POOL_PROGRAM)` using the header's stored bump (offset 97), then
  `getProgramAccounts(STAKE_PROGRAM, memcmp{offset:44, bytes:authority})`, sum of
  actual lamports ≥ `total_lamports`.

## Live result to sanity-check (JitoSOL, epoch 1004/1004, finalized)
- INV-1 exact; INV-2a reserve+list = 10,029,213.1355 ≥ claimed 10,029,213.1332.
- INV-2b: **708 stake accounts**, actual = **10,029,277.6945 SOL** vs claimed
  **10,029,213.1332 SOL** → margin **+64.56 SOL**. GREEN.

Note a wrong authority derivation would match 0 accounts → actual 0 → RED, so the
708-account / pool-scale match is strong evidence the derivation is correct.

## Questions to converge (rank by false-GREEN severity)
1. **create_program_address without on-curve check.** CC trusts the stored bump
   and does not verify the result is off-curve. Given the pool owner is pinned to
   canonical stake-pool, is this safe, or is there a vector where the derived
   authority is wrong yet still returns a plausible account set? Confirm seed
   order `[pool, "withdraw", [bump]]` against upstream
   `find_withdraw_authority_program_address`.
2. **The +64.56 SOL margin.** Is `Σ actual_stake_account.lamports` the right LHS
   to compare against `header.total_lamports`? Upstream computes pool total as
   `reserve.lamports − reserve_rent + Σ record`. So actual (which includes reserve
   rent + intra-epoch reward accrual on stake accounts) legitimately exceeds
   total_lamports. Confirm the margin is expected, and that INV-2b cannot throw a
   **false RED** at an epoch boundary or a **false GREEN** if some matched
   lamports are not truly backing shares (undelegated rent, unclaimed fees).
3. **getProgramAccounts match set.** memcmp on withdrawer offset 44 returns every
   stake account whose withdrawer == authority. Could a third party create stake
   accounts with that withdrawer to inflate actual backing and mask a real
   shortfall (false GREEN)? (CC's view: such lamports are genuinely controlled by
   the authority PDA = real backing, so not a spoof — confirm or refute.) Should
   we additionally filter `dataSize`/stake-state to exclude Uninitialized?
4. **Snapshot skew.** INV-1/INV-2a read at the `getMultipleAccounts` slot; INV-2b
   `getProgramAccounts` is a separate finalized call at a possibly later slot.
   Worth pinning both with `minContextSlot`, or immaterial given the freshness
   gate? Any epoch-boundary race that flips the verdict?
5. **Mint supply offset.** `u64 @36` for SPL Mint base.supply — correct for both
   Token and Token-2022 (extensions append after base)? 

## Deliverable
Ranked findings + minimal patches. Anything that can produce a false GREEN is P0.
If INV-2b is sound, say so explicitly so CC can lock Slice 1 and move to Slice 2
(N targets + a continuous status page that turns RED in real time).

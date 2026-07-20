# Codex review request — round 3 (canonical-PDA INV-2b)

CC applied every round-2 finding. Confirm the fixes close the false-GREEN vector,
then either sign off Slice 1 or flag remaining P0/P1.

## What changed (read `verify.mjs`)
- **INV-2b now sums only the canonical PDA set** derived from the validator list:
  reserve + `find_program_address([vote, pool, seed?])` per active record +
  `find_program_address(["transient", vote, pool, seed_u64])` per transient
  record. Accounts under the authority but not in this set are **excluded and
  counted**, not summed. (round-2 P0 #1 / #3)
- **Real on-curve `findProgramAddress`** (zero-dep ed25519: field sqrt + curve
  eq) for validator/transient PDAs whose bumps are not stored. `createProgramAddress`
  with the stored bump is kept only for the withdraw authority. (round-2 P1)
- **Snapshot consistency**: `getProgramAccounts` pinned `minContextSlot: snap.slot`
  + `withContext`; after the scan the pool is re-read and `total_lamports` /
  `last_update_epoch` / references must be unchanged or → STALE. `-32016`
  (replica slot lag) is retried, not failed. (round-2 P0 #2)
- **base58** rewritten (canonical division method, no leading-zero bug) + decode
  asserts 32 bytes. (round-2 P1)
- **mint** validated `len >= 82` and `is_initialized @45 == 1`. (round-2 P2)

## Live result (JitoSOL, epoch 1004/1004, single finalized slot)
- INV-1 exact. INV-2a reserve+list ≈ claimed (+~0.002 SOL).
- INV-2b: **707 canonical PDAs**, actual **10,029,277.75 SOL** vs claimed
  **10,029,213.19 SOL**, **1 non-list account excluded**. GREEN.
- Evidence the ed25519/PDA derivation is correct: 707 of 708 authority-matched
  accounts land in the independently-derived expected set; actual sum barely
  moved vs the naive all-accounts sum, i.e. the derived PDAs coincide with the
  real accounts. A wrong derivation would miss them and read ~0.

## Open questions for round 3 (rank by false-GREEN severity)
1. **The +64.56 SOL margin persists after excluding non-list accounts.** So it is
   intrinsic to the canonical set, not spoofed. CC reads it as genuine
   over-collateral: actual PDA lamports include rent-exempt reserves + intra-epoch
   reward/activation credits that `total_lamports` (= reserve − reserve_rent +
   Σ record) deliberately omits. **Question:** does this ~64 SOL cushion let a
   real ~64 SOL deficit pass as GREEN (a soft false GREEN)? If so, should INV-2b
   compare against a rent-adjusted floor (e.g. subtract Σ rent_exempt_reserve from
   the actual side, or add it to the claim side) to tighten the check? Or is
   counting genuinely-pool-controlled rent/rewards as backing correct?
2. **The 1 excluded account — false exclusion or true non-canonical?** Is it a
   real non-list account (correctly excluded), or a legit backing account CC's
   derivation missed (e.g. a validator with active==0 but a live transient, a
   validator mid-removal, or a seed edge) — which would make INV-2b under-count
   and risk a **false RED** on some other pool? Please check the derivation covers
   every backing PDA the pool program can create.
3. **Mutation guard vs exact-slot.** CC did not enforce `gpaSlot == snapSlot`
   (impossible on live finalized — the slot always advances between two calls).
   Instead: pin `minContextSlot`, then re-read the pool at/after the scan slot and
   require its claim fields unchanged. Is "claim stable across the window" a sound
   substitute for atomicity, or is there still a race that flips the verdict?
4. **Validator-list churn across the window.** The expected PDA set is derived
   from the list at `snap.slot`; a validator added between snap and scan appears
   in GPA but not in expected → excluded → possible under-count (conservative,
   false-RED direction). Acceptable for Slice 1, or gate on list stability too?

## Deliverable
Ranked findings + minimal patches. If INV-2b is now sound (modulo the margin
question), say so explicitly and note whether the margin tightening in Q1 is a P0
(blocks GREEN) or a P2 (documented limitation) — so CC can lock Slice 1 and move
to Slice 2 (N targets + a continuous status page that turns RED in real time).

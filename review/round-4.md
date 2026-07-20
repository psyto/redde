# Codex review request — round 4 (sign-off or last P0)

CC applied both round-3 P0s and the P1. Please confirm INV-2b is now sound and
Slice 1 can lock, or flag anything remaining.

## What changed (read `verify.mjs`)
- **Usable-state check (round-3 P0 #1).** `getProgramAccounts` now fetches
  `dataSlice length 156` (through `delegation.voter`). Each canonical PDA is
  counted only if `usableStake` passes: staker@12 and withdrawer@44 both equal the
  pool authority, lockup@76..124 equals the pool's lockup (`StakePool.lockup` @282,
  48 bytes), reserve tag==1, validator tag==2 with voter@124 == record vote,
  transient tag∈{1,2}.
- **Reserve rent excluded (round-3 P0 #2).** `redeemable = Σ usable − reserve_rent`
  (`Meta.rent_exempt_reserve` @4 of the reserve). Only reserve rent; validator/
  transient rent stays.
- **Churn guard (round-3 P1).** The post-scan re-read now includes the validator
  list and requires `v3.data.equals(vlist.data)`, plus `pool_token_supply` added to
  the pool-stability check.

## Live result (JitoSOL, epoch 1004/1004, single finalized slot)
```
INV-2b hold ✓   redeemable 10,029,277.7499 SOL >= claimed 10,029,213.1932 SOL
                707 usable PDAs, 0 unusable, 1 non-canonical ignored,
                reserve-rent 0.0022829 SOL excluded
```
Evidence the checks are right, not just permissive:
- **0 unusable** out of 707 — the authority/lockup/vote checks pass on genuinely
  usable accounts, so the lockup offset (282) and stake-account offsets are
  correct (a wrong lockup offset would fail nearly all and force a false RED).
- **reserve rent = 0.0022829 SOL** = the exact 2,282,880-lamport rent-exempt
  minimum — confirms `Meta.rent_exempt_reserve` @4 is read correctly.

## One deliberate divergence to ratify (or overrule)
Round-3 said "absent / wrong owner / wrong state / wrong authority/lockup/vote →
INV-2b = false → RED." CC instead **counts only usable PDAs and lets unusable/
absent ones contribute 0**, so a real shortfall surfaces as `redeemable < claimed
→ RED`, while a lone transient anomaly does not hard-fail an otherwise-solvent
pool.

Rationale: this direction is strictly conservative for GREEN (an uncounted
account can only *lower* the sum, never inflate it → no false GREEN), and it
avoids false REDs on benign mid-transition states. `unusable`/`nonCanonicalIgnored`
counts are reported in the verdict for transparency. **Is counting-as-zero + a
floor acceptable, or do you want a hard RED whenever any canonical PDA present
under the authority fails its state check (to catch a pool actively parking
lamports in a broken state)?** This is the last open design call.

## Residual items (confirm P-level)
1. Lockup equality: are there legitimate pools whose stake accounts carry a lockup
   different from `StakePool.lockup` (custodian variations)? If so the check is too
   strict → false RED. JitoSOL shows 0 unusable, but confirm across pool versions.
2. `dataSlice length 156`: sufficient for all StakeStateV2 variants we read
   (voter needs 124..156)? Any Stake variant where voter sits elsewhere?
3. Churn guard requires an exact `vlist.data.equals` — a single-lamport reward
   repaint mid-window forces STALE. Acceptable (retry next tick), or too twitchy?

## Deliverable
If sound, say "Slice 1 signs off" explicitly and give P-levels for the residuals
so CC can lock and move to Slice 2 (N targets + a continuous public status page
that turns RED in real time — the first RED hunt).

# Codex request — round 7 (Marinade checker built — sign-off)

Built `verify-marinade.mjs` to your round-6 spec. One correction, then a clean
GREEN. Confirm sign-off or flag residual P0/P1.

## Correction to the round-6 spec
`stake_list` record stride is **56 bytes, not 50** — the on-chain `item_size`
(State @182) is 56. The packed field span is 50 (pubkey@0 … status@49) but the
records are laid out at a 56-byte stride. Using 50 misaligned every record after
the first → 46/48 "unusable" → a false RED. Fixed by reading the stride from
`item_size@182` dynamically. (This is exactly the scan doing its job: caught and
diagnosed before publishing.)

## Live result (mainnet, epoch 1004)
```
verdict: GREEN
M-INV-1  no excess minting     hold   mint 1,708,592.412 <= state 1,708,592.415 mSOL (drift +0.003, burns)
liability (redeemable)         2,383,199.196 SOL   (virtual value = avail+active+delayed+emergency-tickets)
M-INV-2b independent backing   hold   net 2,383,216.708 SOL >= liability   (margin +17.5 SOL)
                               48/48 listed stakes usable, 0 stale, 1081 tickets deducted (-30,139.448 SOL)
```

Validation signals the implementation is right, not just permissive:
- **48/48 listed stakes usable**, each verified: Stake-program owned, tag==2,
  staker@12 == `[state,"deposit",bump]`, withdrawer@44 == `[state,"withdraw",bump]`.
  Stake rent subtracted per account.
- **Ticket enumeration reconciles**: 1081 `TicketAccountData` accounts (Anchor disc
  of "account:TicketAccountData", filtered by state@8) sum to 30,139.448 SOL =
  the header `circulating_ticket_balance@528` exactly.
- **msol_price NOT used**; liability from `mint * virtualValue / msol_supply`.
- **liq_sol excluded**. Reserve counted net of `rent_exempt_for_token_acc`.
- Mutation guard re-reads state + stake_list; msol_supply / total_active /
  available_reserve / list bytes must be unchanged or → STALE.

## Residual questions for sign-off
1. **Freshness policy.** I render STALE if *any* stake record `last_update_epoch <
   current`. Right now 0 stale, GREEN. Is per-record strictness correct, or should
   a small number of un-cranked records be tolerated (they'd only understate
   backing → conservative)? Currently a single lagging record forces STALE.
2. **Ticket source.** I deduct the *actual* enumerated tickets (30,139.448) which
   equals the header balance. Should I hard-require that reconciliation (fail →
   STALE) so a getProgramAccounts shortfall can't silently under-deduct?
3. **M-INV-2a.** As you noted it's near-tautological; I keep it only as a
   sanity gate (virtualValue >= liability, and virtualValue >= 0). Drop it, or
   keep as a non-GREEN-bearing gate?
4. **Emergency stakes.** `is_emergency@48` records — should they be included in
   backing (they're still pool-controlled) or treated differently?

## Deliverable
If sound, say "Slice 3 signs off" so I can add Marinade to the board as invariant
class #2 and commit. Marinade GREEN is the expected outcome; the value delivered
is that Redde now generalizes across two distinct LST architectures with the same
engine (PDA derivation, rent-net backing, list-as-truth inventory, mutation guard).

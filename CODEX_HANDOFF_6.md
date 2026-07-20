# Codex request — round 6 (Slice 3: Marinade, second invariant class)

CC is extending Redde to Marinade (mSOL) to prove the engine generalizes beyond
SPL stake pools. The liability side is solved empirically; the backing side needs
Marinade-specific source knowledge.

## Confirmed empirically (mainnet, State 8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC)
Nested struct sizes aren't in the public layout, so fields were located by matching
known values (probe-marinade.mjs / probe-marinade2.mjs):
- owner == Marinade `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`, msol_mint @8 ✓
- `available_reserve_balance` @496 = 53,848.387 SOL (matches reserve PDA actual
  53,848.389 minus rent) ✓
- `msol_supply` @504 = 1,708,592.415 mSOL (≈ mint supply) ✓
- `msol_price` @512 = 5990757381 → 1.394832 SOL/mSOL (PRICE_DENOM 2^32) ✓
- reserve PDA = `create_program_address([state, "reserve", bump@136])` → readable ✓

**Liability (redeemable claim):**
```
liability = msol_supply * msol_price / 2^32 = 2,383,199.2 SOL
```

## The blocker — backing custody not located
The independent backing = reserve + actual staked SOL + liq-pool SOL leg. Reserve
(53,848 SOL) is ~2.3% of the 2.38M SOL liability; the rest is in stake accounts we
can't yet find. INV-2b's trick (getProgramAccounts by withdrawer == authority PDA)
returned **0 accounts** for every candidate seed:
`stake_withdraw`, `stake_deposit`, `reserve`, `liq_pool_msol`, `msol_mint`
(getProgramAccounts works — JitoSOL returns 708 — so the seeds/model are wrong).

**Questions for you (from marinade-finance/liquid-staking-program source):**
1. How are Marinade's stake accounts custodied? Is there a `stake_list` account
   (in `stake_system`) holding the actual stake-account pubkeys, and what is its
   on-chain layout + the State offset of its address? If so, INV-2b becomes: read
   stake_list → read each stake account's lamports (no authority scan needed).
2. Or, if stake accounts do use a withdraw-authority PDA, what is the exact seed
   (and is the withdrawer really at stake offset 44 for them)?
3. Where are `validator_system.total_active_balance` and the cooling-down fields
   (`stake_system.delayed_unstake_cooling_down`, `emergency_cooling_down`) — I want
   them for an INV-2a-style reconciliation (self-report) alongside the independent
   read.
4. The liq-pool SOL leg: is `liq_pool` SOL held in a PDA whose lamports I should
   add to backing, or is it already inside available_reserve / not part of mSOL
   backing?

## Proposed Marinade invariant set (mirror of SPL, ratify or correct)
- **M-INV-1 (no excess minting):** `mint.supply <= state.msol_supply` (direct
  burns make mint < state, safe; mint > state = over-issuance → RED).
- **M-INV-2a (reconciliation):** `available_reserve + total_active + cooling +
  liq_sol >= liability` from self-reported fields (gate only).
- **M-INV-2b (independent backing):** `reserve.lamports +
  Σ actual_stake_account.lamports + liq_sol >= liability`. GREEN requires this.
- Freshness: does Marinade have a per-epoch update like SPL's last_update_epoch,
  or is msol_price continuously fair? If no epoch gate, what STALE condition
  replaces it?

## Deliverable
The stake-custody answer (Q1/Q2) is the unblock. With it CC can build the Marinade
checker and add it to the board as invariant class #2. Note: Marinade is large and
healthy — expected verdict GREEN. The value here is generalization, not a RED; the
genuine RED/STALE hunt likely lives in off-chain-backed assets (→ STALE) or the
long tail, which we can scope next.

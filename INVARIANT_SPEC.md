# Invariant specification — Slice 1

**Target class:** a Solana liquid-staking token (LST) backed by an SPL
stake pool. The public claim: *every LST share is redeemable for its pro-rata
amount of staked SOL — the pool's stated value is actually staked.*

Redde does not take the pool's word for its own value. It authenticates the
pool, gates on freshness, and recomputes the claim from **actual** stake
accounts — then compares.

## Authenticity gates (fail → STALE)

A verdict is rendered only on state Redde can trust:

- The pool account must be owned by the **canonical mainnet SPL stake-pool
  program** (`SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`). Arbitrary owners are
  never decoded — pinning the program pins the ABI.
- The reserve must be owned by the **Stake program**
  (`Stake11111111111111111111111111111111111111`); the validator list must be
  owned by the stake-pool program with account type `2`; the pool mint must be
  owned by the pool's declared `token_program_id`.
- Pool, mint, reserve, and validator list are read in a single finalized
  snapshot (`getMultipleAccounts`), and the pool's references must be unchanged
  within it.

## Freshness gate (fail → STALE)

> `header.last_update_epoch` must equal the current epoch.

Upstream refreshes `total_lamports` and each validator record once per epoch
(`UpdateStakePoolBalance`). A stale header reconciled against a stale list is
the same self-report read twice — not a check. Out-of-date → `STALE`.

## INV-1 — No excess minting (directional)

> The LST mint's on-chain supply must not exceed the header's `pool_token_supply`.

```
mint.supply  <=  header.pool_token_supply
```

`mint.supply > header` means more shares exist than the pool accounts for —
over-issuance / under-collateralization risk. **Fail → RED.**

`mint.supply <= header` is safe: outstanding liability is at most the header
claim. `header > mint` drift is normal — a holder's direct SPL Token `Burn`
lowers the mint supply without touching the pool header — and prices the pool
conservatively for holders. The drift is reported as a `SUPPLY-DRIFT` note, not a
failure. The exact per-share redemption rate is a separate property; INV-1 only
guarantees no excess minting.

The redemption liability of the actually-minted shares is folded into INV-2b:

```
liability = ceil(mint.supply * header.total_lamports / header.pool_token_supply)
required_backing = max(header.total_lamports, liability)
```

## INV-2a — Validator-list reconciliation (gate, not proof)

> The current header must not exceed its current validator-list accounting.

```
reserve.lamports  +  Σ record(active + transient)  >=  header.total_lamports
```

No tolerance. This catches a pool whose header contradicts its own list. It is
**not** an independent backing proof — both sides are the pool's self-report, so
INV-2a alone can never yield GREEN. **Shortfall → RED.**

## INV-2b — Actual backing proof (required for GREEN)

> The **actual** lamports in the stake accounts the pool controls must cover the
> value it claims.

Redde derives the pool's withdraw authority from the header's stored bump
(`create_program_address([pool, "withdraw", bump], stake_pool_program)`) and
independently derives the **canonical backing PDA set** from the validator list:

- the reserve stake account, plus
- each validator stake PDA `find_program_address([vote, pool, seed?], program)`
  for every record with `active_stake_lamports > 0`, plus
- each transient stake PDA
  `find_program_address(["transient", vote, pool, seed_u64], program)` for every
  record with `transient_stake_lamports > 0`.

PDA derivation uses a real on-curve program-address search (the validator and
transient bumps are not stored). Redde then reads the actual accounts under the
authority (`getProgramAccounts`, memcmp on the withdrawer at offset 44) and sums
only the lamports of canonical PDAs that pass a **usable-state check**:

- staker and withdrawer both equal the pool withdraw authority;
- lockup equals the pool's lockup;
- reserve is `Initialized`; a validator PDA is `Stake` and its delegation votes
  for the record's vote account; a transient PDA is `Initialized` or `Stake`.

Lamports at a canonical address with the wrong authority, lockup, or vote are
**not backing** — the upstream updater ignores or repairs them — so they are not
counted. Non-canonical accounts under the authority are ignored entirely
(otherwise a third party could park a stake account to inflate backing and forge
a GREEN). Finally the reserve's rent-exempt reserve is subtracted, because the
pool total is defined as `reserve.lamports − reserve_rent + Σ record`:

```
Σ usable_canonical_pda.lamports  −  reserve_rent  >=  required_backing
```

where `required_backing = max(header.total_lamports, liability)` from INV-1
(equal to `total_lamports` in the safe `mint <= header` direction).
Only the reserve rent is subtracted; validator and transient rent is already
inside the records and the header total. If the RPC does not serve
`getProgramAccounts` for the Stake program, backing cannot be proven and the
verdict is `STALE`, not GREEN. **Shortfall → RED.**

### Consistent snapshot

The pool, mint, reserve, and validator list are read in one `getMultipleAccounts`
at slot `S`; `getProgramAccounts` is pinned with `minContextSlot: S`. After the
scan, the pool is re-read and its `total_lamports`, `last_update_epoch`, and
account references must be unchanged across the window; a deposit/withdraw/update
mid-read renders `STALE`, never a verdict on mixed slots.

## Verdicts

| verdict  | condition                                                            |
| -------- | ------------------------------------------------------------------- |
| `GREEN`  | authentic + fresh, and INV-1, INV-2a, **INV-2b** all hold.           |
| `RED`    | INV-1, INV-2a, or INV-2b fails — chain state contradicts the claim.  |
| `STALE`  | not authenticatable, not fresh, or INV-2b unprovable right now.      |

`STALE` is not a pass. An unverifiable claim is a published property.

## Honesty boundary

A `GREEN` is "fresh, authentic account state passed the independent actual-stake
backing check" — not "the protocol is safe." A `RED` is "the chain state
contradicts the stated claim," reproducible by anyone with this spec and an RPC
endpoint that serves `getProgramAccounts`. Redde never renders GREEN on a
self-report it has not independently checked against actual accounts.

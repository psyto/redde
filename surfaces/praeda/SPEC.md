# Reconstruction specification — Slice 1

**Target class:** a discrete collapse of an on-chain system (a lending market
drained, a pool rugged, a peg broken) in which value crossed a declared boundary
within a bounded time window. Praeda reconstructs **boundary flows** and **when
each account's net flow became committed** — from public
state and public transaction history, with no cooperation from any party.

Praeda computes two objective measures per participant and sorts by them. It does
**not** decide who knew, who is an insider, or who is guilty. See *Honesty
boundary*.

## The window (the unit of reconstruction)

A collapse is reconstructed over an explicit window `W = [t0, t1]`:

- `t0` — the last block at which the system's headline invariant still held
  (peg intact, market solvent, pool full). Declared, with the on-chain state that
  witnesses it.
- `t1` — the first block at which the collapse is complete (pool at floor, market
  insolvent, peg abandoned). Declared, with the state that witnesses it.
- The **drawdown curve** `D(t)` over `W` — the system's headline value (TVL,
  pool balance, price) sampled block-by-block from state. Normalized so
  `D(t0)=0%` drawn down, `D(t1)=100%`.

Everything below is measured strictly inside `W`. An account's activity outside
`W` is context, never a measure.

## Measure 1 — net realized extraction `E` (objective)

> The signed value an account pulled **out of the collapsing system** across `W`.

For each resolved account `a`, sum every transfer that crossed the declared
boundary (the market's vaults, the pool's reserves, the token's backing) during
`W`. First retain the result as a per-mint vector. A USD total may be computed
only from a versioned **reference manifest** whose source, timestamp, method,
and asset coverage are declared in the case file. The reference must not use a
venue, oracle feed, or route involved in the collapse:

```
E(a) = Σ value_out(a, W)  −  Σ value_in(a, W)          (reference-priced)
```

- `E(a) > 0` — net boundary outflow to the resolved account.
- `E(a) < 0` — net boundary inflow from the resolved account.
- Priced at the manipulated price, extraction would look "fair." Praeda prices at
  the pre-collapse reference so the extraction is measured in real value, not in
  the fiction the collapse briefly printed.

An asset with no qualifying reference remains `UNPRICED` in its native-unit
vector and is excluded from the USD rank; it is never silently assigned a
convenient price. `E` is an arithmetic identity over recorded transfers. It
carries no claim about why the account acted.

### Reference manifest and sensitivity (required)

The case file must pin `referenceSlot`, the complete mint list, decimals, and a
content-addressed reference manifest before it may produce a USD sort. For each
mint the manifest records: source identifier and retrieval payload, the declared
pre-event timestamp, a deterministic aggregation rule, and why that source is
independent of the failure path. A case must also publish a sensitivity table
using each admissible source. If the top-k set changes, the USD classes are
`REFERENCE-SENSITIVE` and no account receives an early-top rank. For Mango,
MNGO cannot use the contemporaneous Pyth/affected-market price as its reference;
until a genuinely independent historical quote is pinned, MNGO remains
`UNPRICED` for the USD sort.

## Measure 2 — lead `L` (objective)

> How far ahead of the drawdown an account's decisive action landed.

For each account, net its boundary flow within each slot, then take `t_a` to be
the **commitment slot**: the first slot after which its cumulative net flow
stays on the final side of, and at least half of, its terminal `E`. Read the
drawdown that had **not yet happened** at that slot:

```
L(a) = 1 − D(t_a)            L ∈ [0, 1]
```

- `L ≈ 1` — the measured commitment time was before the observed reserve decline.
- `L ≈ 0` — the measured commitment time was near the sampled post-peak trough.

`L` is timing, read from the same curve for everyone. It is **not** a claim of
foreknowledge, market awareness, or a causal role in the reserve change.
Using the commitment slot rather than the largest transfer prevents a two-sided
market maker's one large fill from becoming its supposed "decisive" action.
Praeda reports the timing; it does not explain it.

## Node classes (the sort, not a charge)

Each participant is placed by its two measures alone. The names describe the
**position in the sort**, never a state of mind:

| class             | definition (reproducible)                                         |
| ----------------- | ----------------------------------------------------------------- |
| `EARLY_TOP_OUTFLOW` | top-k by `E`, with `L` above the window median. |
| `NET_OUTFLOW`       | `E > 0` but not `EARLY_TOP_OUTFLOW`.                            |
| `NET_INFLOW`        | `E < 0`.                                                        |
| `NET_ZERO`          | `E = 0`.                                                        |
| `ENDPOINT_UNVERIFIED` | a token-balance match identifies an observed owner but does not yet prove a participant endpoint. Excluded from ranks. |
| `ROUTE_UNRESOLVED`  | boundary flow reached an intermediary without a deterministic, transaction-local destination. |
| `UNRECONSTRUCTED` | flows across `W` not retrievable from available history — Praeda declines to place. |

`EARLY_TOP_OUTFLOW` is a rank, not an indictment. It means *this resolved
account is at the top of the declared USD outflow sort with above-median timing*
— and nothing about intent, beneficial ownership, or coordination.

## Attribution boundary (required)

The first account outside a boundary is an **observed endpoint**, not necessarily
a beneficiary. Resolve token-account owners, but never rank an executable
program, program-derived address, router escrow, relayer, or custody omnibus as
an end participant merely because it is the immediate counterparty. A flow may
be collapsed through an intermediary only when one transaction's ordered inner
instructions prove a one-to-one, value-conserving path from the boundary to one
resolved destination (allowing only declared protocol fees). Otherwise publish
the amount and intermediary as `ROUTE_UNRESOLVED`, exclude it from account ranks,
and do not infer a next-hop link across transactions. This rule is deliberately
incomplete: ambiguity is a result, not permission to invent attribution.

A one-to-one balance delta alone does not satisfy this rule. Until the ordered
instruction/CPI path establishes the route, retain the owner as
`ENDPOINT_UNVERIFIED` in an audit trail and exclude it from account ranks. This
also applies to a large one-off transfer: magnitude is not route evidence.

## Sampling boundary (required)

A transaction sample may render an explicitly labelled **sample view**, but it
may not publish a population total, participant count, concentration share,
top-k class, or timing share. Systematic samples in particular have no automatic
confidence interval and must not be described as representative. Do not scale a
sample by its stride. To publish a tail or share, either reconstruct all
USDC-moving transactions, or use a declared probability design with a suitable
uncertainty estimate and still route-verify the relevant endpoints. Figures from
the sample must be named `sample-observed`, state its denominator and stride, and
stay out of headlines.

Transactions with `meta.err` are `ONCHAIN_FAILED`; successfully executed
transactions that do not change the declared value vault are `NO_VALUE_MOVE`.
An unavailable RPC response is a retrieval failure, not a failed transaction.

## The boundary-flow ledger (the render)

The money shot is `W` played forward: observed outflows and inflows placed on the
drawdown curve by `L`, with unresolved routes visibly retained. A concentrated
early outflow pattern is *shown*, not explained. The engine draws the
distribution; the reader draws the conclusion.

## Honesty boundary

- Praeda publishes **only** `E` and `L`, both reproducible from public state and
  public transaction history with this spec and an RPC that serves the window's
  history. Where the default endpoint prunes it, an archival endpoint reproduces
  it; where none does, the verdict is `UNRECONSTRUCTED`, not a guess.
- Praeda **never** publishes intent, knowledge, identity, beneficial ownership,
  or a criminal characterization. `E>0` with `L≈1` means only high measured net
  outflow with early timing.
- Slice 1 may use an adjudicated case for external context, but adjudication is
  not an input to the engine's classifications and does not expand what they mean.
- `UNRECONSTRUCTED` is neither a pass nor an acquittal. It says only that the
  specified reconstruction could not be produced from the available record.

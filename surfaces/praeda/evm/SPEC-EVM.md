# Praeda — EVM leg (Slice 1)

The EVM sibling of [`../SPEC.md`](../SPEC.md). Same window `W`, same two measures
(`E`, `L`), same node classes, same honesty boundary. **Only the substrate changes.**
This file records the mapping; the discipline is inherited verbatim.

## One engine, a second VM — why EVM is the *easier* leg for Praeda

| SPEC concept | Solana leg | EVM leg |
| --- | --- | --- |
| boundary | init-time ATA vaults, resolved on-chain | **a contract address** (given) |
| boundary crossing | `getSignaturesForAddress` paging + CPI inner-instruction attribution | **one `Transfer(address,address,uint256)` log** — the same ABI for every ERC-20 on every EVM chain |
| window `W` | slots; UTC→slot mapped by hand | a **block range**; block→timestamp is `eth_getBlockByNumber` |
| drawdown `D(t)` | vault balance sampled per slot | `balanceOf(boundary)` via `eth_call` at a historical block |
| archival | 2022 windows pruned / rate-limited (the live blocker) | 2022–23 collapses served on commodity archival |

The consequence: the wall that keeps the Solana LIBRA case `UNRECONSTRUCTED`
(archival access) is **thin** on EVM. And because `revm`/log semantics are identical
across all EVM chains, one engine + a per-chain config row covers Ethereum + every
L2 — the compounding surface the verifier-league thesis needs.

## Measure 1 — net boundary outflow `E`

Every ERC-20 `Transfer` whose `from` **or** `to` is a boundary contract, inside `W`,
is a signed boundary crossing. No attribution guesswork — the log **is** the record.

```
from = boundary, to = a   →  value left the system to a   →  E(a) += price(value)
from = a, to = boundary    →  value entered the system      →  E(a) -= price(value)
```

Priced at the pinned pre-collapse reference (never a venue/oracle/route involved in
the collapse). An asset with no independent reference stays `UNPRICED` and is
excluded from the USD sort — never silently assigned a convenient price.

`topics[0] = keccak256("Transfer(address,address,uint256)")`
`= 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` — the one
constant shared by the whole EVM. Fetched with `eth_getLogs` filtered by the token
set and the boundary topic; no full re-execution required for `E`.

## Measure 2 — lead `L`

`D(t)` = normalized boundary reserve, sampled by `balanceOf(boundary)` at `S` blocks
across `W`. An account's commitment block `t_a` = the first block after which its
cumulative net flow stays on the terminal side of, and at least half of, its
terminal `E` (not its largest single transfer). `L(a) = 1 − D(t_a)`.

## Attribution boundary (inherited)

The first address outside the boundary is an **observed endpoint**, not a
beneficiary. Routers, bridges, and CEX omnibus deposits are declared as
`intermediaries` and rendered `ROUTE_UNRESOLVED` — excluded from account ranks. A
flow is collapsed through an intermediary only when one transaction's ordered
internal transfers prove a one-to-one, value-conserving path to a single resolved
destination. Ambiguity is a result, not permission to invent attribution.

## Bytecode clustering (an attribution *aid*, not an attribution)

Boundary crossings on EVM frequently land on a swarm of freshly-deployed contracts.
At Euler the ledger's immediate counterparties were **13 contracts, zero EOAs** — a
clone-pair exploit (a "violator" template cloned N times, a "donor" template cloned
N times). Raw per-account `E` then over-reads: gross out ($797M) and gross in ($623M)
are the flash-loan/self-liquidation plumbing; they net to **+$173.6M ≈ the reserve
drain**.

Praeda rolls the ledger up by **exact bytecode** (`eth_getCode`, fingerprinted with a
zero-dep FNV-1a over the full code — length alone is not enough; nearly every contract
shares the `0x60806040…` dispatcher prologue). Identical bytecode is an **on-chain
fact** — one deployed template — so the clone machinery collapses into a few clusters
whose net positions are legible. This is an *aid*: it asserts that members share one
bytecode, and **nothing** about who deployed the cluster, who controls it, or why.
Naming a terminal beneficiary would require following value past the boundary through
each transaction's ordered internal transfers — the "lockable" upgrade — which Praeda
does not fake.

## Transaction-local terminal attribution (the lockable upgrade)

The immediate-counterparty ledger attributes a crossing to whoever the boundary
transacted with *directly*. A clone that receives from the boundary and forwards
onward in the **same transaction** then over-reads as a terminal beneficiary when
it is a conduit. `lock.mjs` follows the value one honest step further — but only
where the chain proves it.

Per transaction, per token, compute each address's **net token delta** from the
`Transfer` logs. That delta is an **exact identity**: every `Transfer` adds `+v`
to `to` and `−v` from `from`, so within a transaction the positive deltas exactly
balance the negatives — no epsilon, no heuristic, no trace RPC (for an all-ERC-20
collapse the `Transfer` logs are the complete value record). Conduits net to
exactly zero and drop out; what remains net-positive is the set of addresses that
**retained** the boundary's value at the end of that transaction — the
transaction-local terminal endpoints.

Two honest stops:

- **Burn / unwrap.** Value sent to `0x0` (a wstETH→stETH unwrap, a redeem) leaves
  the tracked token and continues as another token. It is not a beneficiary — it
  is `ROUTE_UNRESOLVED`.
- **Terminal contract.** A terminal endpoint that is itself a protocol contract
  (an Aave `aToken`, say) received a *deposit* whose beneficiary holds a derived
  claim. Praeda reports where the *token* terminated; it does not name the party
  behind a protocol contract.

At Euler this collapses the 13 immediate counterparties to: **$55.9M** provably
retained by two holding contracts (the exploit contracts), **$117.8M** unwrapped
(wstETH → `0x0`) and left `ROUTE_UNRESOLVED`. Reconciliation is exact — gross
outflow `$173,640,654` = resolved + burned to the dollar; less `$993` returned to
the boundary = `$173,639,661`, which ties to `balanceOf(t0) − balanceOf(t1)`.

## Honesty boundary (inherited, non-negotiable)

The engine publishes **only** `E` and `L`, both reproducible arithmetic over
recorded `Transfer` logs. It **never** asserts intent, knowledge, identity,
beneficial ownership, or guilt. `EARLY_TOP_OUTFLOW` is a position in a declared
outflow sort, not an indictment. When `W`'s history is not served, the verdict is
`UNRECONSTRUCTED` — never a guess.

## Where reth/revm enters (later tier)

Slice 1 needs only logs + historical `balanceOf` (commodity archival). Full `revm`
re-execution is the **Redde** leg's tool (re-executing a solvency invariant at a
pinned state) and Praeda's later tier — reconstructing a boundary's *internal*
accounting when raw `Transfer` logs under-describe the crossing (rebasing tokens,
internal-balance AMMs). The zero-dep engine here is the shared substrate; `revm` is
an upgrade to specific cases, not a prerequisite.

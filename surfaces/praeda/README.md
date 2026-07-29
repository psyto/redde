# Praeda

> **A collapse leaves a transfer record. Praeda reconstructs it.**

Praeda reconstructs the **distribution** of an on-chain collapse — which value
crossed a declared system boundary, and when net flow became committed — from
public state and public transaction history, **without any party's cooperation or
confession**. It renders a boundary-flow ledger, each resolved account placed on
the collapse curve by its measured timing.

A collapse is remembered as an event in the passive voice — *the pool was
drained*. The chain remembers it as a transfer with a sender and a receiver.
Praeda reads the receiver.

## What this is (and is not)

- **Is:** an outward-facing reconstruction. Two objective measures per account —
  **net boundary outflow** (`E`) and **drawdown timing** (`L`, how much of the
  drawdown had not occurred when the account committed) — both recomputable by a
  stranger with the spec and an archival RPC.
- **Is not:** an accusation engine. Praeda **never** asserts intent, knowledge,
  identity, beneficial ownership, or guilt. `EARLY_TOP_OUTFLOW` is a rank in a
  declared outflow sort, not an indictment. See the honesty boundary in the spec.

## One engine, two virtual machines

Praeda is a single re-execution engine with two VM backends. The measures, the
node classes, and the honesty boundary are identical across both; only the
substrate differs.

| | **Solana leg** | **EVM leg** |
| --- | --- | --- |
| reconstructor | [`reconstruct.mjs`](reconstruct.mjs) | [`evm/reconstruct-evm.mjs`](evm/reconstruct-evm.mjs) |
| spec | [`SPEC.md`](SPEC.md) | [`evm/SPEC-EVM.md`](evm/SPEC-EVM.md) |
| a boundary is… | a vault, resolved on-chain | a **contract address** |
| a crossing is… | signature paging + instruction tracing | one `Transfer(address,address,uint256)` **log** — one ABI, every ERC-20, every EVM chain |
| the window `W` | a slot range | a **block range** (block→timestamp is trivial) |
| the drawdown `D(t)` | vault balance sampled per slot | `balanceOf` at a historical block |
| RPC | `SOLANA_RPC_URL` | `ETH_RPC_URL` (chain-parameterized — any EVM chain) |

The EVM leg is the *cheaper* substrate: archival for recent collapses is
commodity, and one engine + a config row covers Ethereum and every L2. Adding a
chain is a case file, not a rewrite.

## The exhibits (a standing gallery)

The engine is target-independent; each collapse is a declared case file.

- **Exhibit A — $LIBRA on Solana.** The 2025-02-14 boundary-flow case.
  [`site/index.html`](site/index.html).
- **Exhibit B — Euler Finance on Ethereum.** The 2023-03-13 collapse.
  [`site/euler.html`](site/euler.html). Reserve $173.6M → $993 in 14m 36s; the
  boundary's 13 immediate counterparties are contracts, zero EOAs — grouped by
  exact bytecode they collapse to a few clone templates whose net position lands
  on the reserve drain ($173.6M). The reference was read from Chainlink + Lido at
  the boundary block, and caught the SVB weekend (USDC $0.9910, DAI $0.9915) —
  Praeda does not assume $1, and does not name a terminal beneficiary.

Each first firing is deliberately an **adjudicated or externally-settled** case
(Euler's funds were returned; the framing is public record), exactly as Redde's
first firing was on the safe, uncontroversial JitoSOL. Praeda's `E`/`L` ledger is
a separate, smaller, reproducible claim beside that settled record.

## Run

**EVM leg** (chain-parameterized; the default case is Euler 2023-03-13 on Ethereum):

```sh
export ETH_RPC_URL=...                 # an archival endpoint (mainnet or any EVM chain)
node evm/reconstruct-evm.mjs           # reconstruct the default case; boundary-flow ledger + bytecode clusters
node evm/reconstruct-evm.mjs --json    # machine-readable
# free-tier endpoints cap eth_getLogs at ~10 blocks: PRAEDA_LOG_STEP=10
```

**Solana leg**:

```sh
export SOLANA_RPC_URL=...              # an RPC that serves the window's history (archival)
node reconstruct.mjs                    # reconstruct the wired case
node reconstruct.mjs --json
```

If the endpoint prunes the window, the reconstruction renders `UNRECONSTRUCTED` —
honestly — rather than inventing a distribution. Both legs are zero-dependency
(Node 18+), read-only, and reproducible by a stranger: the engine, the case file,
and any archival endpoint recompute the exhibit exactly.

## The node classes (the sort, never a charge)

`EARLY_TOP_OUTFLOW` · `NET_OUTFLOW` · `NET_INFLOW` · `NET_ZERO` ·
`ROUTE_UNRESOLVED` · `UNRECONSTRUCTED`

Names describe a position in the declared sort, never a state of mind. See the
spec for the three refusals (`UNRECONSTRUCTED`, `UNPRICED`, `ROUTE_UNRESOLVED`)
and, on the EVM leg, the bytecode-cluster attribution *aid* — shared bytecode is
an on-chain fact that asserts no deployer, owner, or intent.

## Files

- `MANIFESTO.md` — the stance, long form (VM-agnostic).
- `SPEC.md` / `evm/SPEC-EVM.md` — the window, the two measures, the node classes,
  the honesty boundary; the EVM file maps each measure onto the EVM substrate.
- `reconstruct.mjs` — the Solana reconstructor.
- `evm/reconstruct-evm.mjs` — the EVM reconstructor (chain-parameterized).
- `evm/lock.mjs` — the lockable upgrade (transaction-local terminal attribution).
- `evm/case-euler.mjs` — the Euler case file (boundary, window, reference — all
  resolved on-chain, pinned).
- `evm/discover*.mjs` — provenance of the on-chain pins (boundary, window,
  reference, endpoint resolution).
- `site/index.html`, `site/euler.html` — the public exhibits. The money shots.

## Relation to Redde

Same armory, opposite time. **Redde** re-executes a *present* solvency claim and
renders GREEN/RED/STALE — verification, now. **Praeda** re-executes a *past*
collapse and renders its boundary-flow ledger — reconstruction, after. Both share
the cross-VM engine (Solana + EVM); both publish only what they can independently
recompute, and neither asserts what it cannot prove.

## Roadmap

1. ✅ Two measures, one boundary-flow ledger, on two virtual machines.
2. ✅ A standing gallery of reconstructed collapses (Solana + Ethereum).
3. More chains — a config row per EVM chain, a case file per collapse.
4. ✅ The "lockable" upgrade — following value past the boundary only through a
   transaction-local, value-conserving path (never a faked next hop). Done for
   Euler ([`evm/lock.mjs`](evm/lock.mjs)): the 13 immediate counterparties collapse
   to $55.9M provably retained by two holding contracts + $117.8M unwrapped and
   left `ROUTE_UNRESOLVED`, reconciling to `balanceOf` exactly.
5. Cross-collapse recurrence — the same resolved addresses across multiple
   ledgers, a fact about recurrence, still never a claim about intent or control.

# Praeda — EVM leg

The EVM backend of Praeda. Same engine as the Solana leg ([`../reconstruct.mjs`](../reconstruct.mjs)),
a second virtual machine. Same two measures (`E`, `L`), same node classes, same
honesty boundary — see [`SPEC-EVM.md`](SPEC-EVM.md) for how each maps onto the EVM
substrate, and [`../SPEC.md`](../SPEC.md) for the measures themselves.

Why EVM is the *easier* substrate for Praeda: a boundary is a contract address; a
boundary crossing is a single `Transfer(address,address,uint256)` log (one ABI,
every ERC-20, every EVM chain — no instruction-tracing); the window `W` is a block
range; the drawdown `D(t)` is `balanceOf` at a historical block; and archival for
recent collapses is commodity. Nothing here hardcodes Ethereum — a case pins
`{ chainId, RPC, boundary, tokens, window, reference }`, so the same engine runs
on any EVM chain.

## Run

```sh
export ETH_RPC_URL=...                 # an archival endpoint
node reconstruct-evm.mjs               # default case: Euler 2023-03-13; ledger + bytecode clusters
node reconstruct-evm.mjs --json        # machine-readable
node reconstruct-evm.mjs --case ./case-euler.mjs   # explicit case file
```

Env knobs (mostly for throttled free tiers):

- `PRAEDA_LOG_STEP` — `eth_getLogs` block-chunk size (free tiers cap at ~10; default 2000).
- `PRAEDA_CURVE_SAMPLES` — drawdown-curve sample count (default 24).
- `PRAEDA_RPC_RETRIES` — transient-error retries with backoff (default 8).
- `PRAEDA_NO_CODE=1` — skip endpoint resolution / bytecode clustering.

When the endpoint cannot serve the window, or the case is not fully pinned, the
verdict is `UNRECONSTRUCTED` (exit 2) — never a guess.

## The Euler case (Exhibit B)

`case-euler.mjs` is fully pinned **on-chain** (nothing guessed):

- **Boundary** — the Euler main module `0x27182842E098f60e3D576794A5bFFb0777E025d3`;
  `balanceOf` of all four drained assets fell from millions to ~0 across `W`.
- **Window** — `[16817995, 16818067]` (2023-03-13 08:50:47 → 09:05:23 UTC), each
  drain block located by binary search (`discover2.mjs`).
- **Reference** — Chainlink USD feeds + Lido `wstETH.stEthPerToken`, read at the
  boundary block (`discover3.mjs`). Chainlink was not the collapse mechanism, so it
  is admissible; it also captures the SVB weekend (USDC $0.9910, DAI $0.9915).

Result: 13 immediate counterparties, all contracts (0 EOAs). Grouped by exact
bytecode (`discover4.mjs`, `eth_getCode`), they collapse to a few clone templates.
Gross out $796.7M and gross in $623.1M are flash-loan plumbing; the **cross-cluster
net is +$173.6M ≈ the reserve drain**.

## The lockable upgrade — transaction-local terminal attribution

`lock.mjs` follows the value past the immediate counterparties, but only where the
chain proves it. Per transaction, per token, each address's net `Transfer` delta is
an exact identity (positives balance negatives exactly), so conduits — clones that
receive and forward in the same tx — net to zero and drop out; what remains
net-positive **retained** the value. Value that leaves via a burn/unwrap (`→ 0x0`,
continuing as another token) or into a protocol contract is `ROUTE_UNRESOLVED`,
never a named beneficiary.

```sh
ETH_RPC_URL=... node lock.mjs          # → data/euler-locked.json
```

At Euler: gross outflow `$173,640,654` = **$55.9M** provably retained by two holding
contracts + **$117.8M** unwrapped (wstETH → `0x0`, ROUTE_UNRESOLVED); less `$993`
returned = `$173,639,661`, ties to `balanceOf(t0) − balanceOf(t1)` exactly.
No trace RPC needed — an all-ERC-20 collapse's `Transfer` logs are the complete
value record. See [`SPEC-EVM.md`](SPEC-EVM.md).

## Bytecode clustering — an attribution *aid*, not an attribution

Identical bytecode is an on-chain fact: one deployed template. Praeda rolls the
ledger up by exact code (FNV-1a over the full `eth_getCode` string — byte length
alone false-merges on the shared `0x60806040` dispatcher prologue). It asserts that
members share one bytecode, and **nothing** about who deployed it, controls it, or
why. Naming a terminal beneficiary would require following value past the boundary
through each transaction's ordered internal transfers — the "lockable" upgrade,
which Praeda does not fake.

## Files

- `reconstruct-evm.mjs` — the reconstructor (zero-dep, chain-parameterized).
- `lock.mjs` — the lockable upgrade (transaction-local terminal attribution).
- `case-euler.mjs` — the Euler case file.
- `SPEC-EVM.md` — SPEC measures mapped onto the EVM substrate.
- `discover.mjs` — boundary confirmation (pre/post reserve drain).
- `discover2.mjs` — window pinning (per-asset drain block, binary search).
- `discover3.mjs` — reference pinning (Chainlink + Lido at t₀).
- `discover4.mjs` — endpoint resolution (contract vs EOA).
- `gen-euler-curve.mjs` — the drawdown-curve data for the exhibit.
- `data/euler-ledger.json`, `data/euler-curve.json`, `data/euler-locked.json` — reconstructed outputs.

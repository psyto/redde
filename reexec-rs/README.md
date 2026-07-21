# redde-reexec — the re-execution tier (slice 2)

> Reads trust the RPC. This executes the contract itself.

`verify-eth.mjs` asks the node for a value and believes it. This harness does not.
It pulls a contract's **code** and the **storage slots a call touches** from a pinned
block over JSON-RPC, loads them into a **local revm**, and runs the bytecode itself —
so it trusts neither the node's reads nor its execution. Together with slice 1
(`../reexec.mjs`, which proves those reads against the block `stateRoot` via Merkle
proofs), this is the re-execution tier: *trust the reporter for nothing.*

Standalone crate — depends on `revm` + a blocking JSON-RPC client (`ureq`), **not** on
the reth/alloy-provider node stack. Debug build is a few seconds after the first fetch.

## What it demonstrates

**B0 — capability.** Runs `stETH.totalSupply()` in the local EVM and checks it equals
the node's `eth_call` to the wei. stETH is a proxy, so this also resolves its
`delegatecall` to the implementation through our own DB — proving the harness executes,
it does not pass through.

**B1 — the redemption sweep: execute, reach what a read can't.** Points the engine at a
curated set of major ERC-4626 vaults. For each it finds a real holder (dynamically, via
`getAssetTransfers` with an `eth_getLogs`-window fallback), reads `previewRedeem` (the
price a naive user trusts), then SIMULATES `redeem()` for that holder against forked
state and reports what actually comes out. The read is the price; the verdict is what
`redeem()` does.

Result on a 12-vault blue-chip set (one block): **11 redemptions honored** — `GREEN`, the
assets actually leave (sDAI, sUSDS, sfrxETH, sFRAX, wUSDM, wOETH, Angle stUSD/stEUR, and
three MetaMorpho USDC/USDT vaults) — and **1 blocked**: sUSDe reverts with
`OperationNotAllowed()` (Ethena's cooldown — the price reads healthy but you cannot redeem
right now, which a static read never shows). No material underpay; no false `RED`. A
sub-basis-point rounding gap between `previewRedeem` and `redeem` is tolerated as dust.

## Design notes (why it is honest)

- **Local revm over RPC-fetched state.** `RpcDb` implements `revm::DatabaseRef`, lazily
  fetching `eth_getCode` / `eth_getStorageAt` / `eth_getBalance` at one pinned block.
- **Simulation, like `eth_call`.** EIP-3607 (code-sender), base-fee, nonce and balance
  checks are lifted so a *contract* holder can be simulated — we test whether the
  redeem *logic* honors the claim, not whether this exact tx would be minable.
- **No hardcoded 4-bytes.** Function selectors and revert error names are derived from
  `keccak256` at runtime.
- **No hardcoded holder.** Holders are discovered dynamically (`getAssetTransfers`, with
  an `eth_getLogs` 10-block-window fallback for plain RPCs).
- **Real temporal context.** The local EVM runs at the pinned block's actual `number` and
  `timestamp`; without it, rate-accruing vaults underflow on `now - lastUpdate` and Panic
  (see Integrity).
- **Asset vs share decimals.** Redeemed amounts print in the vault's *asset* decimals
  (6 for a USDC vault), not its 18-decimal shares; a zero/failed `previewRedeem` is
  inconclusive, never a false `GREEN`.

## Run

```
ETH_RPC_URL=<https…>  cargo run        # runs the redemption sweep over the curated vault set
```

(B0 — the `stETH.totalSupply()` local-vs-`eth_call` match — was the first milestone; see
the commit history. The current `main` runs the redemption sweep.)

The RPC key is read from `ETH_RPC_URL` and is **never** committed. `target/` is
gitignored; `Cargo.lock` is pinned.

## Integrity — false findings, caught before they were findings

Building the sweep surfaced two of *its own* bugs, each of which would have printed a page
of false alarms — both caught because the results looked too suspicious to be real:

- **Missing block context.** With the local EVM at a default `timestamp` of 0, eight
  unrelated rate-accruing vaults reverted identically with `Panic(0x11)` — an underflow on
  `now - lastUpdate`. Eight different protocols failing the same way is the harness's
  fault, not theirs. Fixed by pinning the block's real `number` / `timestamp`.
- **Share vs asset decimals.** USDC MetaMorpho vaults showed `previewRedeem 0.000` — a
  6-decimal USDC amount printed against 18-decimal shares — which also risked a false
  `GREEN` on a zero read. Fixed by using the asset's decimals and guarding `preview == 0`.

A verifier is only worth trusting if it kills its own false REDs before publishing. These
did not ship as findings.

## Where this goes

This is the seed of a pre-deployment agent-mandate verifier: execute an agent's (or a
protocol's) behavior against forked state and check it honors what it claims. Next:
state-transition invariants (donation / inflation attacks), a wider protocol sweep, and
porting the engine into that verifier.

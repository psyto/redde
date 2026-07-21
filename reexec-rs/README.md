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

**B1 — value: execute the redemption, reach what a read can't.** Simulates ERC-4626
`redeem()` for a *real* holder (discovered dynamically via `eth_getLogs`) against forked
state, and reports whether the assets actually come out. The read is the price; the
verdict is what `redeem()` does:

| vault | previewRedeem (the read) | redeem() (execution) | verdict |
| ----- | ------------------------ | -------------------- | ------- |
| **sUSDS** (Sky Savings USDS) | ~577.5M USDS | delivers the same | `GREEN` — redemption confirmed |
| **sUSDe** (Ethena staked USDe) | ~1.18M USDe | **REVERTS** `OperationNotAllowed()` | `FINDING` — cooldown; you cannot redeem right now |

A static price / `convertToAssets` reads perfectly healthy for sUSDe. Only executing
the withdrawal path reveals that it reverts. A sub-basis-point rounding gap between
`previewRedeem` and `redeem` is tolerated as dust — never cried as a false `RED`.

## Design notes (why it is honest)

- **Local revm over RPC-fetched state.** `RpcDb` implements `revm::DatabaseRef`, lazily
  fetching `eth_getCode` / `eth_getStorageAt` / `eth_getBalance` at one pinned block.
- **Simulation, like `eth_call`.** EIP-3607 (code-sender), base-fee, nonce and balance
  checks are lifted so a *contract* holder can be simulated — we test whether the
  redeem *logic* honors the claim, not whether this exact tx would be minable.
- **No hardcoded 4-bytes.** Function selectors and revert error names are derived from
  `keccak256` at runtime.
- **No hardcoded holder.** Recipients are discovered from recent `Transfer` logs
  (scanned in 10-block windows to fit a free RPC tier).

## Run

```
ETH_RPC_URL=<https…>  cargo run        # runs the B1 redeem simulations (sUSDS, sUSDe)
```

(B0 — the `stETH.totalSupply()` local-vs-`eth_call` match — was the first milestone;
see the commit history. The current `main` runs the B1 redemption simulations.)

The RPC key is read from `ETH_RPC_URL` and is **never** committed. `target/` is
gitignored; `Cargo.lock` is pinned.

## Where this goes

This is the seed of a pre-deployment agent-mandate verifier: execute an agent's (or a
protocol's) behavior against forked state and check it honors what it claims. Next:
state-transition invariants (donation / inflation attacks), a wider protocol sweep, and
porting the engine into that verifier.

# Vesper — weekend soundness readout

A standing, append-only, **re-executable** record of closed-market liquidation soundness for
tokenized equities on Solana. Each weekend the same asset is graded on multiple venues; every
row is a command you can run, not a claim to trust ([`../MANIFESTO.md`](../MANIFESTO.md)).

> *Don't trust — re-execute.* `node verify.mjs <claim.json>` reproduces any verdict below;
> add `--fetch` to re-pull the on-chain observations. A mismatch is provable, not deniable.

Every claim a week cites is frozen at `soundness-log/claims/<claim_id>.json`, where the
filename IS the sha256 content address of the claim body. Past weeks reproduce from this
checkout — no git archaeology, and no way to quietly restate what an old week said.

## 2026-W32  ·  _generated 2026-08-04T22:41:50.070Z_

| Asset | Venue | Verdict | Reproduces | Claim | Reproduce |
|---|---|---|:--:|---|---|
| SPYx | Jupiter Lend | 🔴 RED | ✅ | `vc_8732875c9…` | `node verify.mjs soundness-log/claims/vc_8732875c937e18b5c943e97243a94f9a00d3a1b2.json --fetch` |
| SPYx | Kamino | 🟢 GREEN | ✅ | `vc_c8f06563b…` | `node verify.mjs soundness-log/claims/vc_c8f06563b72969372a016bef0e71c27211d71293.json` |

**Money-shot — SPYx:** 🔴 **RED** on Jupiter Lend (`vc_8732875c9…`) vs 🟢 **GREEN** on Kamino (`vc_c8f06563b…`) — same chain, same asset, opposite closed-market gap-safety.

Anchored on Solana: [`4uuiP1tirPuY…`](https://explorer.solana.com/tx/4uuiP1tirPuYnyZm4gNrbVvK7kJwzSKsAEMK7bN5eq331N3vNtH1aaFoT5CTcLrBLjQmLwFik68RAYwkbyPZ1x3P?cluster=devnet) · `218`-byte memo.

> **Kamino SPYx — honest residual.** GREEN = on-chain BOUNDED + upstream Chainlink CLAMP. Materially safer than a zero-guard raw feed (RED), but it carries a Chainlink-Data-Streams trust dependency the RED verdict does not — the last-close clamp is off-chain and NOT re-derived here. On-chain re-execution stops at the guards.

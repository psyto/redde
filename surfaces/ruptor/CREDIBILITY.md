# Credibility — how Ruptor proves it, not just claims it

The easy trap for any "this protocol can be broken" tool is to become a **parameterized
simulation** — pick a DEX depth, a recovery rate, a close factor, and out comes a scary number
anyone can dispute by changing the knobs. That is Gauntlet's / Chaos Labs' territory
(statistical simulation), and it has no credibility moat. Ruptor's job is to stay on the
**re-execution** side: numbers that anyone can reproduce against mainnet, and knobs replaced by
live measurement wherever possible.

This document is the honest ledger of what is proven vs assumed, and the ladder from here.

---

## What is measured / re-executed vs assumed

| Quantity | Source | Reproducible? |
|---|---|---|
| Borrower positions (qty, tick) | the venue's `Position` accounts, decoded from chain | ✅ anyone re-runs → same |
| LTV, collateral, debt | `LTV = tickBase^tick / price`, re-executed from chain | ✅ |
| Fair price | Chainlink Data Streams update, decoded from chain | ✅ |
| **Sell-side liquidity + routable ceiling** | **Live DEX aggregator quotes** (`measure.mjs`) | ✅ re-measure → same regime |
| Liquidation threshold (LT) | venue parameter (0.75 for the target asset) | ✅ |
| Liquidation bonus, close factor | **labeled assumption** (`--bonus`, `--cf`) | ⚠ scenario input |
| Fundamental Monday gap `g0` | **labeled assumption** (`--g0`) | ⚠ scenario input |
| Liquidation waterfall | **first-order model**, not a full program replay | ⚠ model |

Only two things are genuine scenario inputs — the fundamental gap `g0` and the close factor —
and **the headline conclusion is robust to both**: at a 10% gap, sell demand (~$445k) exceeds
measured capacity (~$150k) by 3×; doubling the close factor to 100% only widens the gap.

## What the measurement changed

The first draft of `ariete.mjs` assumed a constant-product DEX pool (a knob) and produced a
smooth cascade — a claim, not a proof. Replacing that knob with `measure.mjs` (live aggregator
quotes) revealed the real regime:

- $50k sell → 1.3% price impact
- $100k sell → 3.5%
- **> ~$150k → no route exists at all**

So the true failure mode is not a smooth price cascade — it is a **liquidity seizure**: the
liquidation market physically cannot absorb the collateral, and the unsellable debt strands.
This is a *stronger and more honest* result than the modeled cascade, because its binding
number (the routable ceiling) is measured, not chosen.

---

## The ladder

- **L0 — claim.** "Trust my number." Worthless.
- **L1 — measured (where Ruptor is now).** Positions re-executed from chain; liquidity
  live-measured; only `g0` and close factor are scenario inputs, and the conclusion is robust to
  them. Reproducible by anyone against mainnet + the aggregator.
- **L2 — fork replay (next).** Fork Solana at the current block, inject the gap into the oracle,
  and let the **real venue + AMM programs** execute the liquidations and swaps on LiteSVM. No
  model — whatever bad debt the real on-chain code produces is the answer. This eliminates the
  remaining first-order-waterfall assumption. (Lineage: the Aperio / LiteSVM real-SBF work.)
- **L3 — historical backtest.** Reconstruct a known past liquidity-seizure event from archive
  state and show the method reproduces the realized outcome. Best EVM candidate: the Aave / CRV
  (Egorov) cascade — computable ex-ante, already produced realized bad debt. (Lineage: Praeda.)

L1 is already a defensible, hackathon-grade result. L2/L3 move it from *measured* to
*unfalsifiable*.

---

## Provenance — why this is a prop / credibility weapon, not a product

An earlier framing — sell this re-execution as a **tail-risk pricing engine to on-chain
insurers/underwriters** — was tested against the record and **killed**:

- The binding constraint on gen-1 on-chain cover was **demand / distribution** (cover premiums
  erase the underlying yield → "nobody buys DeFi insurance"), not pricing.
- The pricing capability already exists: **Gauntlet publicly reconstructed** the Aave/CRV tail
  from chain state; the market acted on it. Pricing is not the missing piece.
- In the headline pricing-failure cases (InsurAce/Terra, Sherlock/Euler), the insurers **paid** —
  capacity held. Pricing was not what stopped the sector from scaling.

Conclusion: there is no clean startup in *selling* this. What survives is the **offensive /
credibility** use — extract the alpha yourself and publish the proof — which does not depend on
anyone buying anything. Ruptor is built for that use.

# Re-execution as the neutral resolver

**A standard for money-at-risk-on-a-verdict markets.**

Two markets are coming, and both are the same shape — a payout controlled by whether an on-chain
condition is true:

- **Prediction markets** on on-chain state: "is protocol X solvent?", "did stablecoin Y depeg?",
  "was contract Z exploited?", "did TVL cross W?" — $20B+/month of volume, and its resolution is
  already litigated ($85M markets in active lawsuit; UMA's ~$95M token-vote cap is smaller than a
  single market's stake, so bribery is rational; ~1 in 5 disputes had a conflicted voter).
- **Agent-payment escrow**: release vs refund, decided by whether the agent did what it claimed.

Today these are resolved by **token votes** (corruptible), **committees** (conflicted), or **price
oracles** (which answer prices, not state). None re-executes the on-chain truth.

## The standard

> A market's on-chain-state condition is resolved by **re-execution**: a `VerifiableClaim` recomputes
> the condition deterministically from pinned chain state, and the resolution is whatever anyone
> reproduces by re-running `verify.mjs`. No vote. No committee. No trusted oracle.

Because the condition is a deterministic function of public state, there is **one correct answer**;
honest resolvers must agree, and a false resolver is **provably wrong and slashable** (`judge.mjs`,
`bond.mjs`). The correct side of the market captures the stake. This is the same engine that grades
closed-market soundness and reserve solvency — retargeted from "is this venue sound" to "which side
of this market gets paid."

## Why this lane is open

- **Chainlink** answers **prices** — already commoditized to zero-dispute. Do not compete there.
- **UMA** answers **arbitrary claims by token vote** — corruptible at high stakes, and it does not
  re-execute anything.
- **Re-execution** answers **on-chain-STATE conditions** (solvency, soundness, depeg, exploit)
  deterministically — the slice a price feed can't reach and a vote shouldn't decide.

## The corpus (reproducible reference resolutions)

Each is a command, not a claim to trust. Re-run it; get the same answer.

| Market condition | Resolved | Basis | Reproduce |
|---|---|---|---|
| Does Jupiter Lend liquidate SPYx soundly across the closed-market weekend? | **NO** | RED · CMLS | `node verify.mjs claims/jupiter-spyx-cmls.json` |
| Is Marinade (mSOL) solvent (recomputed backing ≥ liability, no stale records)? | **YES** | GREEN · solvency | `node verify.mjs claims/marinade-solvency.json` |

The corpus accrues. Every added reference resolution is a public, reproducible datapoint that
compounds into the thing capital cannot buy later: **the standard, the track record, and the
recognition of re-execution as the neutral resolver** — established before the demand, and the
incumbents' capital, arrive.

## Honest scope

- These are **reference resolutions** — reproducible verdicts that establish the standard and the
  corpus. **Live-capital bonding on a live market** (posting a real stake as a permissionless
  disputer, or resolving for an operator) is the next step; it needs capital and a venue.
- The resolution **logic** is trustless re-execution. The residual trust is in the claim's **inputs**
  — closed via the on-chain [recorder](./recorder.mjs) root, or bridged by N-of-M attestation for
  historical data (see the input-commitment work).

**Don't trust the resolver. Re-execute it.**

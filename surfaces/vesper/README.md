# Vesper

Independent, re-execution-based verifier of **Closed-Market Liquidation Soundness (CMLS)** for
tokenized equities on Solana. Grades each venue on one invariant and publishes a neutral league table.

- 🟢 **GREEN** — price clamped to last close ± band, market-status aware (safe).
- 🟡 **YELLOW** — liquidations suspended off-hours (safe but blunt).
- 🔴 **RED** — liquidates against stale/DEX price with no closed-market guard (gap-exposed).

Tokenized equities trade 24/7; the underlying US market does not. In the gap window
(~Fri 20:00 → Sun 20:00 ET) there is no live underlying reference. Vesper re-derives, from onchain
state, the exact price each venue would liquidate against during that window — and classifies whether
that is gap-safe.

Redde engine, new invariant. Act-1 of the verifier-league. See [`SPEC.md`](./SPEC.md).

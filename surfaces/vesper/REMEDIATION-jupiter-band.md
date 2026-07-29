# Closed-Market Band — remediation spec for Jupiter Lend / Fluid xStock vaults

**Status:** draft proposal (Vesper, 2026-07-23). Grounded in `Instadapp/fluid-solana-programs`
@ `626b177f` + live mainnet state. Turns the CMLS verdict for Jupiter Lend's xStock vaults from
🔴 **RED → 🟢 GREEN** with one localized change at the oracle layer.

> This is a constructive hardening proposal, not an exploit. Every fact below is from public
> code and on-chain state. The same protection already runs, audited, on Kamino — this brings
> Fluid's xStock vaults to parity.

---

## 1. The gap (as it stands in code)

xStock collateral is priced through the oracle program (`jupnw4B6…4oc`). For each xStock vault
(#77–84) the oracle resolves to a single Chainlink Data Streams source, refreshed 24/7 via
`RefreshPriceFeedWithChainlink` (~1.6 min cadence, measured to run **straight through weekends** —
968 writes Sat 07-18, 1,003 Sun 07-19).

The only guards on that price at liquidation time are, per `programs/oracle/src/`:

| Guard | Value | File |
|---|---|---|
| Staleness (liquidate) | `MAX_AGE_LIQUIDATE = 7200s` (2h) | `constants.rs` |
| Staleness (operate) | `MAX_AGE_OPERATE = 600s` | `constants.rs` |
| Confidence (liquidate) | reject if conf > 4% | `constants.rs` / `modules/pyth.rs` |
| **Market-status / price band** | **none — 0 references** | (absent) |

Because the Chainlink feed never goes stale on weekends, the 2-hour staleness gate never fires, and
there is **no bound to the last regular-session close**. During the closed-market window
(≈ Fri 20:00 → Sun 20:00 ET) liquidations execute against a price the regulated market never printed.

**Severity is a tail, not routine.** Measured drift on the calm weekend of 07-18/19 was only
**~1.1%**, well inside the ~10% liquidation buffer (LT − CF) — no liquidation would have fired. The
exposure is the *volatile-news weekend*: a 5–15% Monday gap with no guard. The band exists to catch
exactly that tail.

---

## 2. The fix: a closed-market band on the liquidation price

Add a per-source **closed-market policy** applied only on the **liquidation** read path. In
pseudocode, wrapping the existing source read:

```
fn closed_market_guard(live: Price, pol: ClosedMarketPolicy, now, is_liquidate) -> Result<Price> {
    if !is_liquidate { return Ok(live); }              // operate path unchanged
    if market_status(pol, now) == OPEN { return Ok(live); }

    let dev = abs(live - pol.last_regular_close) / pol.last_regular_close;   // bps
    if dev > pol.band_extreme_bps {                    // genuine hard gap → don't act on it
        return err!(MarketGappedSuspendLiquidations);
    }
    // small/normal off-hours drift → bound to the last close ± band
    Ok(clamp(live, pol.last_regular_close, pol.band_normal_bps))
}
```

### Data model — extend `Sources` (or the `Oracle` account)

```
struct ClosedMarketPolicy {
    market_status_source: Pubkey,   // see §3
    last_regular_close:   u128,      // price captured at the last OPEN→CLOSED transition
    last_close_ts:        i64,
    band_normal_bps:      u16,       // clamp band while closed        (suggest 300 = 3%)
    band_extreme_bps:     u16,       // suspend beyond this            (suggest 1200 = 12%)
    mode:                 u8,        // CLAMP | SUSPEND_ONLY
}
```

`last_regular_close` is snapshotted **from the venue's own oracle** at the OPEN→CLOSED transition
(when the market-status source — Campana, §3 — flips), capturing the final regular-session mark. It
is the anchor the closed-market price is bounded to. The venue keeps its own price; only the *timing*
of the flip comes from the shared feed.

---

## 3. The one hard part: market status — read it, don't rebuild it

The band needs to know *is the regular session open right now?* Chainlink's tokenized-equity feed
does **not** flag holidays or halts — “the consuming protocol must detect closed markets itself.” This
is the piece a venue should **not** self-maintain: a hand-rolled hours-checker is (a) a perpetual
NYSE-calendar/holiday/half-day maintenance burden, and (b) a trust-sensitive input the venue's own
liquidations depend on — precisely the thing that should be *independent*, not marked by the venue itself.

**Recommended: read [`Campana`](./FEED-campana.md)** — a neutral, re-executable closed-market truth
feed (market status + session timing, price-agnostic) that any xStock/RWA venue reads instead of
building its own. One account read:

```
let c = read_campana(US_EQUITIES_REGULAR);
if c.status != OPEN { price = closed_market_band(live, venue.last_regular_close, pol); }
```

Because Campana's status is a deterministic function of the public NYSE schedule + holiday calendar,
its correctness is *verifiable by re-execution* — the venue is not trusting a discretionary flag, and
not maintaining a calendar. It is the shared rail; the venue supplies only its own price and band params.

**Zero-integration interim:** until wired to Campana, a venue can degrade with a **deviation-only
circuit breaker** — suspend liquidations whenever `dev > band_extreme_bps` vs a rolling median. Weaker
(can't distinguish a closed-market freeze from a live move) but removes the worst RED behavior with no
new dependency. Campana is the target state; this is the bridge.

---

## 4. Clamp vs suspend — graceful degradation

- **Normal off-hours drift** (`dev ≤ band_normal`): clamp `live` into `close ± band_normal`. Routine
  ~1% weekend moves pass through essentially unchanged; nothing breaks.
- **Moderate drift** (`band_normal < dev ≤ band_extreme`): clamp to the band edge — liquidations may
  proceed but never at a price more than `band_normal` off the last close.
- **Hard gap** (`dev > band_extreme`): **suspend liquidations** until the market reopens and the
  price is re-confirmed. A real weekend crash is not acted on with an unverified off-hours mark;
  positions settle at the confirmed reopen price. (This is the tail the whole change is for.)

This keeps the protocol solvent in the common case (clamp) and refuses to seize collateral on an
unverifiable extreme move (suspend) — strictly safer than today for both borrower and protocol.

---

## 5. Suggested parameters (grounded)

| Param | Suggested | Rationale |
|---|---|---|
| `band_normal_bps` | **300 (3%)** | Covers legitimate 24/5 overnight moves (measured routine weekend drift ~1.1%) with headroom; well inside the ~10% liq buffer. |
| `band_extreme_bps` | **1200 (12%)** | Above this, treat as a genuine gap and suspend; sits just above the liq buffer so a true breach waits for reopen confirmation. |
| `mode` | `CLAMP` | Matches Kamino; keeps liquidations flowing in the common case. |

Tune per ticker: single-stock xStocks (higher realized vol) may warrant a wider `band_normal` than
index xStocks (SPYx/QQQx).

---

## 6. Where it plugs in

Apply at the **oracle layer** (`programs/oracle`), inside the liquidation-path price read that today
calls `read_chainlink_source(...)` → combines `sources` into a rate. Wrapping the source read with
`closed_market_guard(..., is_liquidate=true)` covers **all eight xStock vaults at once** with no vault
changes. The `is_liquidate` flag already threads through the oracle read path (used for
`MAX_AGE_LIQUIDATE` vs `MAX_AGE_OPERATE`), so the seam exists.

Vault liquidation (`programs/vaults/src/utils/liquidate.rs`) is unchanged — it consumes the corrected
rate. Borrow/operate reads are unchanged.

---

## 7. Verification & certification (Vesper)

`verify-cmls.mjs` re-derives the verdict from chain state. On deploy:

1. Confirm `ClosedMarketPolicy` is populated for each xStock oracle and its `market_status_source`
   points at a neutral [`Campana`](./FEED-campana.md) feed (not a venue-controlled flag).
2. Replay the closed-market read path against a synthetic gap → assert clamp/suspend behavior.
3. Flip the vault's Vesper verdict 🔴 → 🟢 and record the certifying commit + oracle accounts.

Ongoing: Vesper monitors the policy (a param change that widens the band past the buffer, or a stale
market-status source, re-opens the verdict). The certification is a *living* status, not a one-time badge.

---

## 8. Honest tradeoffs & non-goals

- **Clamping can under-liquidate a real gap** until reopen → transient bad-debt risk the `band_extreme`
  suspend bounds. This is the same tradeoff Kamino accepts; it is strictly better than unbounded 24/7
  liquidation.
- **Market-status is the trust-sensitive input.** A wrong/stale status source is itself a risk — hence
  the preference for a deterministic, auditable hours program over a discretionary flag.
- **Not** a new oracle, **not** a change to which price vendor is used, **not** a borrow-side change.
- Routine weekends are already fine (~1%); this earns its keep only in the tail. That is the point of
  a solvency guard — it is cheapest to add before the tail arrives, not after.

---

## 9. Existence proof

Kamino runs a market-status band on the same Chainlink Data Standard for the same xStocks, double-audited
(Certora, Offside), and scores 🟢. The engineering is known and shipped one protocol over. This spec brings
Fluid's xStock vaults to that bar.

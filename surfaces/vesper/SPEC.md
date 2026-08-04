# Vesper — Act-1 Spec

**One line.** An independent, re-execution-based verifier that grades every Solana venue
listing tokenized equities on a single invariant — *Closed-Market Liquidation Soundness (CMLS)* —
and publishes a neutral GREEN / YELLOW / RED league table.

Vesper is the Redde engine (deterministic re-execution of on-chain state, no consent needed)
pointed at a new, thesis-relevant invariant. It is Act-1 ("proof") of the verifier-league
three-act: prove soundness dispersion publicly → earn a relier → turn reputation into Act-2 demand
(the consumer felt product, which reuses Vesper's closed-market pricing model as its risk engine).

---

## The invariant: Closed-Market Liquidation Soundness (CMLS)

Tokenized equities trade onchain 24/7, but the underlying US market is closed nights, weekends,
and holidays (Pyth confirms: outside hours "it's not clear what an equity's price is"; feeds freeze
at last price and delegate risk downstream). The structural gap window is roughly **Fri 20:00 ET →
Sun 20:00 ET** (no live underlying reference at all).

> **CMLS invariant.** For a lending/perp venue `V` listing a tokenized equity `E`, during the
> closed-market window `W`, the price `P_liq(V, E)` that `V` would use to *trigger and execute* a
> liquidation MUST be bounded to the last regular-session close within a declared band,
> **OR** liquidations MUST be suspended for the window. Otherwise `V` is *gap-exposed*: a Monday-open
> gap can force liquidations against a stale / DEX-spot price disconnected from fair value, producing
> bad debt or unfair liquidations that no party can hedge (the weekend has no TradFi hedge; onchain
> perps are the only, thin, hedge).

## Verdict classes

| Verdict | Closed-market price policy `P_cm(V,E)` | Meaning |
|---|---|---|
| 🟢 GREEN  | **CLAMPED** — price bounded to last regular close ± band, market-status aware (e.g. Chainlink Data Streams band) | Safe & capital-efficient |
| 🟡 YELLOW | **SUSPENDED** — liquidations/borrows paused on staleness / confidence / market-status | Safe but blunt (capital-inefficient, crude) |
| 🔴 RED    | **NAIVE** — liquidation proceeds against stale Pyth / last-trade / DEX-spot with no closed-market guard | Gap-exposed → potential bad debt |

Expected priors from mid-2026 research (to be verified, not assumed):
Kamino (Chainlink band) → GREEN · NestUSD (Pyth-confidence pause) → YELLOW · **?? → RED (must be found)**.

---

## Re-execution pipeline (per `V × E`)

1. **Locate** `V`'s market/reserve account for `E` onchain (program id + account).
2. **Extract oracle wiring** from chain state: which price feed `V` reads for `E`
   (Pyth pull account / Chainlink stream / Switchboard / internal DEX TWAP), plus risk params
   (max staleness, confidence limit, price band, LTV, liq threshold, liq penalty, borrow cap).
3. **Classify** `P_cm(V,E)` → CLAMPED / SUSPENDED / NAIVE, from the wiring + params (not from docs).
4. **Stress** — inject a synthetic Monday-open gap `g ∈ {-10%, -20%, -30%}` on `E`. Re-execute the
   pricing path to determine whether `V` would liquidate a representative position at a price
   disconnected from post-gap fair value; estimate resulting bad debt / unfair-liquidation size.
5. **Verdict** = class + a *reproducible evidence bundle* (accounts, params, the exact price path).

**Act-1 scope discipline.** The verdict hinges on the **closed-market price INPUT**, not the full
liquidation waterfall. We re-derive, from chain state, the exact price each venue would liquidate
against at the gap — and classify its gap-safety. We do NOT need to replay every venue's full
liquidation math to establish CMLS. (That is Act-1.5+.)

Style: zero-dep `.mjs`, Redde lineage. Chain-derived, deterministic, re-runnable each epoch.

---

## Deliverable (the artifact)

A public league table: rows = `(venue × tokenized-equity)`, cells = 🟢/🟡/🔴 with a click-through
evidence bundle. **Money-shot = ≥1 reproducible RED** with a concrete "a position of size $X on this
venue generates ~$Y bad debt on a Z% Monday gap."

## Relier hook (issuer-facing — the Act-1 → Act-2 gate)

Reframe the table for the **issuer** (xStocks/Backed, Ondo): *"Your token `E` is used as collateral
on N venues; M of them are gap-exposed (RED/YELLOW). Here is the list, with proof."* Issuers carry
brand risk from unsound downstream usage yet cannot grade downstream neutrally — a structural
型B/型C buyer with real skin. (SBI route composes here: issuer × soundness-gate.)

---

## Kill line (Act-1 success criteria)

- **Technical:** ≥1 real, reproducible RED found. *If everyone is safe (all GREEN/YELLOW), the
  verifier has no reason to exist — kill and fall back to Act-2 (①) directly.*
- **Demand (the Redde death test — "依拠者無" must be defeated this time):** the artifact is shaped
  to be forwardable to an issuer, and ≥1 relier (issuer / depositor / risk-DAO) actually engages
  with a verdict. No relier → shelve or fold the engine into ① and drop the standalone verifier.

## Non-goals (Act-1)

- Not selling an oracle (Chainlink's game — we verify, we don't supply price).
- Not a bespoke paid risk engagement (Gauntlet/Chaos Labs' game — we publish a neutral public table).
- Not the consumer product (that's Act-2 / ①).

## Differentiation vs incumbents (must hold all three or we're a poorer Gauntlet)

1. **Method** — deterministic re-execution from chain state, not statistical simulation.
2. **Lens** — closed-market / "24-7 token, closed underlying" soundness specifically.
3. **Form** — public neutral league table across the long tail, not private engagements for majors.

---

## Act-1 target — LOCKED (2026-07-23 RED-hunt)

Kill line (≥1 reproducible RED) **provisionally MET** at research level — dispersion is real:

| Venue | Asset role | Oracle | Closed-market policy | Verdict | Provenance |
|---|---|---|---|---|---|
| Kamino | xStocks collateral | Chainlink Data Streams + own band, double-audited | CLAMP | 🟢 GREEN | confirmed |
| Drift | perp | oracle-priced liq | pause on extreme oracle error | 🟡 YELLOW | confirmed |
| **NestUSD** | 7 xStocks collateral (SPYx 75%…TSLAx 60% LTV, $1–5M caps) | **Pyth** (freezes off-hours) | **pause hypothesis REFUTED 0-2 → no guard** | 🔴 **RED candidate** | research-provisional |
| Jupiter Lend | xStocks collateral + multiply (~$20M) | unknown | "staleness noted, mitigation unclear" (1-2) | ❓ UNKNOWN | needs on-chain |
| Rain.fi | — | — | P2P, no price liq | N/A | confirmed |

**Money-shot (locked):** the *same* SPYx is 🟢 on Kamino and 🔴-candidate on NestUSD — same chain,
same asset, opposite gap-safety. Act-1's one-strike artifact proves this on-chain.

**Meta-finding that justifies re-exec (verified, primary sources):** the oracle *vendor* does NOT
determine safety. Chainlink's own tokenized-equity feed reports last close with NO band and does NOT
flag holidays/halts ("the consuming protocol must detect closed markets itself"); Pyth freezes at last
price. GREEN is the *protocol's own* band/pause logic, not the feed. → A "which oracle do they use"
checklist cannot grade CMLS; only re-executing each protocol's closed-market logic can. This is
exactly the verdict only Vesper can produce.

**Next rate-limiter:** on-chain CONFIRM NestUSD's wiring (program id, oracle account, absence of any
band/pause) → flip 🔴-candidate to 🔴-confirmed + compute the gap-loss number. That confirmation IS the
first run of `verify-cmls.mjs`.

## Status (2026-08-04) — money-shot re-executed BOTH sides + anchored on-chain

The kill line is met with a stronger, self-reproducing artifact than the original NestUSD candidate: the
money-shot is now **SPYx 🔴 Jupiter Lend vs 🟢 Kamino**, each **re-executed from chain and anchored on
Solana (devnet Memo)**.

- **RED (Jupiter) — airtight, fully on-chain.** Its oracle is a raw 24/7 pushed price with zero
  closed-market guards; `weekend-liveness.mjs` shows LIVE_THROUGH_CLOSURE → NONE → RED. Anchored:
  tx `5HDpMX…`.
- **GREEN (Kamino) — re-executed to the guard layer, with an honest residual.** `scope-price.mjs` recovers
  the reserve `tokenInfo` guards from chain, self-validated by `name@5032 == "SPYx"`: heuristic $515–858,
  maxTwapDivergenceBps 500 (5%), 300s staleness; the Scope price it reads sits ~1% from the frozen
  last-close. **Honest refinement of the spec:** those on-chain guards are generic sanity, NOT a last-close
  clamp — the actual clamp is UPSTREAM Chainlink Data Streams (off-chain). So GREEN = on-chain-BOUNDED +
  upstream-Chainlink-CLAMPED, safer than a zero-guard raw feed but carrying a Chainlink trust dependency
  RED does not. Full on-chain re-execution stops at the guards; we say so in the claim. Anchored:
  tx `3B7An1…`.
- A method safeguard fell out of this: a market-status aggregator (Scope) ticks through closure too, so
  liveness alone would FALSE-RED a clamped venue — `probeOnChain` now refuses to grade aggregator feeds.

**Campana on-chain — LIVE (2026-08-04).** The market-status feed venues could read to stop being 🔴 is now
a deployed Solana program ([`campana-program/`](./campana-program/), Pinocchio, `no_std`): program
`67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i` on devnet. Its `market_status` is the *same deterministic
function* as `campana.mjs` — `cargo test` cross-checks it against the off-chain self-test verdicts, and a
live crank ([tx `2RQKrj4s…`](https://explorer.solana.com/tx/2RQKrj4sa454qm22y9aoGMB1yXLye8SfZGCrqfa383gNxZM9xDEDFtz9WvZAAVWgQ2R7mTn6ZZbZeRzK9kttNJp?cluster=devnet))
wrote `CLOSED · 2026-08-04` which the off-chain reference re-executed at the same slot ts reproduced exactly
(**ON-CHAIN == OFF-CHAIN**). The neutral rail is no longer only a claim — it exists on-chain and is
re-executable across the boundary.

**Making the demand, build-driven (2026-08-05).** Rather than wait for a relier, two rungs turn the
proof into a standing, self-publishing record:

- **Rung 1 — live keeper.** `campana-program/keeper.mjs` re-cranks the canonical status account
  `7j3VCB9f…` at every OPEN↔CLOSED flip and, after each crank, re-executes `campana.mjs` at the chain's
  timestamp to assert ON-CHAIN == OFF-CHAIN (a wrong crank throws). The rail is now a continuously live
  fact, not a one-shot demo; `launchctl load com.psyto.campana-keeper.plist` keeps it up.
- **Rung 2 — weekend readout (the demand engine).** `readout.mjs` re-executes every tracked claim
  (`verify.mjs` L1, offline), keeps only the verdicts that reproduce, appends an immutable
  `soundness-log/<ISO-week>.json`, regenerates the public board, and anchors the week's money-shot on
  Solana (Memo). First week live — 2026-W32: SPYx 🔴 Jupiter vs 🟢 Kamino, both reproduce, anchored on
  devnet (tx `4uuiP1ti…`). Every row is a command, not an assertion; the record compounds weekly, so when
  a weekend gap finally burns a venue the log shows the finding was published — reproducibly — beforehand.

Remaining: the demand kill line (a relier *engaging* a verdict) still gates Act-1 → Act-2. Build has taken
it as far as build can — a live rail + a compounding public record; the outward acts that convert attention
into an engaged relier (the issuer-facing forward to Backed, the public thread) are the founder's to fire.
A venue actually gating liquidations on Campana's `status == OPEN` is the adoption proof-point.

# Ruptor

**Offensive re-execution of live lending books.** Risk advisors (Gauntlet, Chaos Labs) stop at
*"this position is risky."* Ruptor re-executes real on-chain positions and prints **the
executable trade + the loss** — what a searcher extracts, and what the protocol eats — from a
Monday-open gap, using **live-measured** on-chain liquidity, no consent needed.

It is the offensive descendant of the Redde / Vesper / Praeda re-execution line: not a
verification report sold to the graded party, but a weapon that prices what a searcher takes.

```
node ruptor.mjs          # single-venue: the cheapest gap that breaks a book + the trade
node measure.mjs         # capture live on-chain sell-side liquidity  → measured.json
node ariete.mjs --measured   # cross-venue: liquidity-seizure on measured liquidity
```

Zero deps (Node 18+ global fetch). Reads a lending venue's `Position` accounts and derives
`LTV = tickBase^tick / price` from chain state. The live target (venue, program id, mint,
oracle, layout) loads from a withheld `./venue.local.mjs`; without it, only `--demo` runs.

---

## The three tools

### `ruptor.mjs` — single-venue break
Over the ENTIRE live book, searches for the smallest Monday gap `g*` that first forces bad
debt, and prices the **executable trade** at each gap (bad debt the protocol eats, value the
searcher captures). Where Vesper asks *"does MY position survive a fixed gap?"* (defensive,
per-position), Ruptor asks *"what breaks the whole book, and what's extractable?"* (offensive,
book-wide) — adding book aggregation, a 1-D gap search, and the trade + P&L.

### `measure.mjs` — live liquidity
Asks a Solana DEX aggregator *"if I dump $X of the collateral asset on-chain right now, what
price impact do I eat — and at what size do routes vanish?"* Writes `measured.json`. This
replaces the single biggest assumption (DEX depth) with a live measurement.

> **The finding that reframes everything:** in a live run, a tokenized-equity collateral had a
> routable ceiling around **$150k** — past that, the aggregator found no route at all. On-chain
> liquidity for a tokenized equity is thinner than a single large liquidation.

### `ariete.mjs` — cross-venue contagion / liquidity seizure
`--measured` mode uses `measured.json`: it compares the **sell demand** to clear a book's
underwater positions against the **measured routable ceiling**. The overflow is **stranded** —
no on-chain buyer exists, so that debt cannot be liquidated at all. The break is not a smooth
cascade; it is a **liquidity seizure**. A clamp+suspend venue (Vesper GREEN) pauses in-window
and strands nothing.

(`ariete.mjs` without `--measured` runs an endogenous constant-product cascade — a *labeled
model*, weaker than the measured mode. Prefer `--measured`.)

---

## The money-shot (a live run, target withheld)

Venue A — a live Solana lending venue listing a tokenized equity — 164 real borrowers, at a 10%
Monday gap (the named target and per-borrower data are withheld; see § posture):

- sell demand to clear underwater positions: **~$445k**
- measured on-chain capacity: **~$150k** (3× short)
- **~$584k of debt stranded** — unliquidatable, because there is no buyer
- a clamp+suspend venue strands **$0**

The conclusion (`demand ≫ capacity`) is robust: doubling the close factor does not flip it.

---

## Credibility — what is measured vs assumed

The whole point is *proof, not claim*. See **[CREDIBILITY.md](./CREDIBILITY.md)** for the full
ledger and the L1→L2 ladder. In short:

| | source |
|---|---|
| positions, LTV, collateral, debt | **real chain state** (re-executed now) |
| sell-side liquidity + routable ceiling | **live-measured** (DEX aggregator quotes) |
| remaining inputs | only the fundamental gap `g0` and close factor — both **scenario inputs**, and the conclusion is robust to them |

The liquidation waterfall is a first-order model, not a full replay. The next rung (L2) is a
**fork replay** on LiteSVM — running the real venue + AMM programs so the numbers are *executed,
not modeled* (see CREDIBILITY.md).

---

## Shareable artifacts (pages)

```
node ruptor.mjs --json > snapshot.json && node build-page.mjs snapshot.json break.html
node measure.mjs && node build-ariete-page.mjs        # → ariete-break.html (liquidity seizure)
node ruptor.mjs --demo --json > snapshot.demo.json && node build-page.mjs snapshot.demo.json break-demo.html
```

- `break.html` — Ruptor: gap slider, bad-debt curve, the trade.
- `ariete-break.html` — Ariete: measured liquidity curve + the demand-vs-capacity money-shot.
- `break-demo.html` — fully **synthetic**, no named venue — the safe-to-share method demo.

Self-contained, theme-aware, zero-dep HTML.

---

## Posture — engine public, live named findings local

Following the solinv line (tools public, findings withheld): the **engine**, `measure.mjs`, and
the **synthetic demo** are safe to share; the live, *named* run (which venue, which borrowers,
the real numbers) stays local. `.gitignore` excludes `venue.local.mjs`, `measured.json`, `snapshot.json`, `break.html`, and
`ariete-break.html` (the findings) — only the code and the anonymized demo ship.

```
node ruptor.mjs           # live named run (local only)
node ruptor.mjs --demo    # synthetic, no RPC, no named venue — shareable
node ruptor.mjs --anon    # real book, venue / asset / position ids stripped
node ariete.mjs --demo    # synthetic contagion
```

Publishing the named version to a URL is a deliberate, separate decision — it names a live
protocol offensively.

---

## Honest scope

- This is a **prop / credibility** artifact (extract alpha + publish the proof), not a product
  sold to anyone. Selling this verification to insurers was tested and killed — demand, not
  pricing, is the binding constraint in on-chain cover (see CREDIBILITY.md § provenance).
- The live target (venue, asset, program id, oracle) loads from a withheld `venue.local.mjs`.
  The break Ruptor/Ariete price **only exists on a naive (RED) venue** — one that liquidates
  against a stale/gapped closed-market price; a clamp+suspend venue removes the attack surface.

RPC: reads work on the public Solana RPC; point at another with `RPC=<url>`. Heavy
`getProgramAccounts` reads are CU-metered on some providers' free tiers — the public RPC handles
the book read fine.

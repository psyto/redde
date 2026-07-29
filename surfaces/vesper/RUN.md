# Try Vesper locally

Zero dependencies — just Node. From `/src/vesper/`:

## 1. The verdict — league table
```
node verify-cmls.mjs
```
Prints the closed-market soundness board: Kamino 🟢 / Drift 🟡 / NestUSD 🟡 / Jupiter 🔴,
each with the code-grounded basis.

## 2. The neutral rail — Campana (market-status truth feed)
```
node campana.mjs
```
Runs the self-test (9 cases + DST) and the demonstration: applied to the real 07-17→20 weekend it
flips CLOSED across exactly the window Jupiter's feed liquidated through.

## 3. The user tool — weekend safety gauge  ← the interactive one
```
node gauge.mjs                                   # reference scenario
node gauge.mjs --vault 77 --ltv 0.68             # your position
node gauge.mjs --lt 0.85 --collateral 10000 --debt 7000 --gap 0.15
node gauge.mjs --vault 80 --ltv 0.70 --at 2026-07-18   # test a specific (closed) day
node gauge.mjs --help
```
Tells you, for your Jupiter Lend xStock position: is the market open (Campana), your true distance to
liquidation, your weekend-safe max LTV, and ✅ hold / ⚠️ de-risk (with the exact repay %).

Vaults: 77 & 80 = LT 75%, 78 & 79 = LT 85%.

## 4. The artifact — league page
```
open league.html          # macOS — opens in your browser
```
The published version (same content) is at:
https://claude.ai/code/artifact/88dfa511-0be7-4df6-a914-de0674f51224

---

Everything above is off-chain — the deterministic engine and its proof. The on-chain Campana program
(that venues read) and live position wiring are the next build.

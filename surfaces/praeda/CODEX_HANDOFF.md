# Codex review request — round 1 (Praeda slice 1)

CC (explore) stood up Praeda: a permissionless **collapse reconstructor** — the
outward, past-facing sibling to Redde. Where Redde re-executes a *present*
solvency claim (GREEN/RED/STALE), Praeda re-executes a *past* collapse and renders
its **food chain**: two objective measures per account — net realized extraction
`E` and lead `L` — and a `UNRECONSTRUCTED` verdict when history isn't served.

Read, in order: `MANIFESTO.md`, `SPEC.md`, `reconstruct.mjs`, `site/index.html`,
`README.md`. Slice 1 target = **Mango Markets, 2022-10-11** (chosen because the
framing is court-adjudicated — Praeda's first firing lands on a case beyond
dispute, mirroring Redde firing first on the safe JitoSOL).

Codex's job is the converge / adversarial pass. The Praeda analog of Redde's
"false GREEN" is a **false attribution** — the engine placing an account in the
food chain (especially `APEX`) in a way the transfers do not actually support, or
leaking an intent claim the honesty boundary forbids. Rank everything by that.

## Questions to converge (rank by false-attribution / intent-leak severity)

1. **Does the honesty boundary actually hold, or does `APEX` leak intent?** The
   whole thesis is that the engine renders structure (E, L) and never asserts a
   mind. Audit every surface — the node-class names, the manifesto, the site copy —
   for any place Praeda *implies* knowledge/guilt rather than reporting a measure.
   Is "APEX / predator / fed" defensible as a pure rank, or does it need to be
   colder? Propose the minimal wording that keeps the edge without claiming a mind.

2. **Reference pricing is load-bearing and swings the sort.** `E` is priced at an
   "independent pre-collapse reference," never the manipulated intra-collapse price.
   Where does that reference come from, exactly, for Mango's basket
   (USDC/SOL/BTC/mSOL/USDT/MNGO/SRM…)? Which independent oracle snapshot at
   `solventSlot`? Show a case where a different-but-defensible reference flips who
   ranks `APEX`. If the sort is reference-sensitive, that's a P0 — pin the rule.

3. **Boundary attribution / false apex.** `E` credits the *counterparty* of each
   boundary-crossing transfer. DEX routers, aggregator programs, relayers, and
   wrapped/CPI hops can appear as the counterparty and light up as `APEX` while the
   real beneficiary is one hop further. How do we attribute through intermediaries
   without asserting a link the chain doesn't prove? What's the rule for collapsing
   a router hop vs. leaving it as its own node?

4. **Market makers / legitimate two-sided flow.** An MM that cycled large volume
   in *and* out during W nets to a small `E` but could show a spuriously high or
   low `L` on its "decisive" (largest) transfer. Is "largest boundary-crossing
   transfer" the right definition of the decisive action, or does it mislabel
   two-sided actors? Consider net-flow-weighted timing instead.

5. **Window definition robustness.** `W = [last solvent block, first insolvent
   block]`. How sensitive is the whole food chain to the exact `t0`/`t1` choice?
   An actor just outside W is invisible; one just inside is scored. Is there a
   defensible, reproducible rule for the two slots from state, and how much does
   the `APEX` set move if they shift by ±N slots?

6. **Archival reconstructability of Mango (2022).** `reconstruct.mjs` gates on
   whether the endpoint serves W's `getSignaturesForAddress` history and renders
   `UNRECONSTRUCTED` otherwise. Confirm: is the 2022-10-11 window actually
   recoverable from a standard archival endpoint (Triton/Helius archival), or is
   the vault-level transfer history effectively unrecoverable — in which case
   slice 1 is honestly `UNRECONSTRUCTED` and we need a **second, recent target**
   that is reconstructable on free/near-free RPC *and* shows a multi-tier food
   chain (tiers of snipers → retail on a rug reads better than Mango's binary
   predator→pool). Recommend the second target.

7. **Money-shot critique (this is the point).** The site's hero is the drawdown
   curve with `APEX` dots on the flat top and `PREY` on the cliff. Does it land
   "few extracted early / many bled into the fall" at a glance? What's visually
   weak, and what one change most increases the felt impact? (CC deliberately
   over-invested here per the user's "見せ方 decides" priority — push it.)

## Deliverable

Ranked findings + minimal patches (to `SPEC.md` wording, `reconstruct.mjs`, and
`site/index.html`). Anything that leaks intent or produces a false `APEX` is P0.
Give an explicit verdict on the Mango archival question (item 6) with a recommended
second target if Mango is `UNRECONSTRUCTED` on realistic RPC, so CC can lock the
slice-1 case file and wire the extraction/curve computation.

# Codex review request — round 2 (Praeda real-data reconstruction)

CC took slice 1 from spec to **real on-chain data**. The engine is target-agnostic;
LIBRA/USDC is Exhibit A, and the intent is to replicate it across collapses. Before
we lock this as the template, adversarially verify the reconstruction and its
honesty on real data.

## What CC built (read in order)
- `CASE_LIBRA.md` — sourced case-file dossier (mint, pool, vaults, window, pricing).
- `crawl.mjs` → `data/window-usdc-sigs.jsonl` — **468,655** USDC-vault signatures,
  crawled from now back to vault genesis (2025-02-14T21:40:24Z) via Alchemy archival.
- `curve.mjs` → `data/curve-usdc.json` — the USDC reserve drawdown curve (602 samples).
- `swarm.mjs` → `data/swarm.json` — per-account net USDC flow E and timing L from a
  **1/100 systematic sample** (4,687 tx; 262 counterparties; 10.3% ROUTE_UNRESOLVED).
- `site/index.html` — the visual-first artifact (curve draws in, numbers count up,
  swarm rises). Confirmed figures: reserve 0 → **$178,784,424** peak (63 min) →
  **−96.6%** drain; single account = **61% of sampled outflow**; 23.7% of outflow
  before peak.

The Praeda analog of Redde's "false GREEN" is a **false attribution or an intent
leak** — the engine implying a beneficiary/motive it did not measure, or a figure
that reads as more than the transfers support. Rank everything by that.

## Questions to converge (rank by intent-leak / false-figure severity)

1. **Reserve-curve semantics (P0 candidate).** The headline is "$178.8M peak →
   −96.6%." That peak is the pool's USDC *reserve* — it includes every buyer's USDC,
   not "amount extracted." The drain mixes ordinary sells (USDC out to sellers) with
   LP removal. Audit the copy (kicker, stat labels, footnote): does anything imply
   the $178.8M or the 96.6% was *taken* / *stolen*, rather than "the pool's reserve
   rose then fell"? Propose the coldest wording that keeps the impact without the
   implication.

2. **Swarm attribution correctness.** `swarm.mjs` attributes each sampled tx's USDC
   vault delta to the *single* other USDC account with the opposite delta (else
   ROUTE_UNRESOLVED). Is the 1:1 heuristic sound for Meteora DLMM swaps + LP
   removals? Specifically: could the **"one account = 61% of sampled outflow"**
   (`6neoWX8Ak3wTHdFkbE487gfiK8gPnMmKWMNq9n2vzzvL`, E≈$1.64M, n=1) be a router /
   aggregator / PDA mislabeled as an end counterparty, rather than a genuine
   endpoint? How would we tell, and should such an account be ROUTE_UNRESOLVED?

3. **Sampling honesty (P0 candidate).** "61% to one account" and "23.7% before peak"
   come from a 1/100 sample of USDC-moving tx, sample-observed and **not scaled**. Is
   presenting these as headline percentages defensible, or does a single large tx in
   the sample distort them? Should we (a) scale with a stated factor, (b) attach a
   crude confidence bound, or (c) re-sample denser for the outflow tail specifically?
   Recommend the minimal honest treatment.

4. **Timing L / D(t) semantics.** L = 1 − D(t); D = 0 before the peak, else the
   fraction of the peak→floor drain completed. "23.7% of outflow committed before the
   peak" therefore means USDC left the pool *while the reserve was still climbing*.
   Is that a sound, non-misleading statement, and is the commitment-slot definition
   (largest-|delta| sampled tx per owner) right for one-shot vs repeat actors?

5. **Intent-leak sweep on the whole artifact.** LIBRA is a real scandal with named,
   litigated actors. The engine must not borrow that narrative. Sweep the manifesto,
   the site, and the class names for any place the reconstruction *implies* a
   beneficiary, coordination, foreknowledge, or guilt beyond "received/supplied USDC,
   early/late." Flag each; propose colder wording.

6. **The 90%-no-move finding.** ~90% of sampled vault tx moved no USDC (failed /
   congestion). CC excludes them from E. Correct? And is surfacing "most launch-hour
   transactions failed" a legitimate, useful finding or noise?

7. **Template soundness.** Given 1–6, is the LIBRA/USDC Exhibit sound to (a) publish
   and (b) use as the replication template for other collapses? If not, what is the
   single change that most improves defensibility?

## Deliverable
Ranked findings + minimal patches (to `swarm.mjs`, `site/index.html` copy, `SPEC.md`
wording). Anything that leaks intent or presents a sample figure as more certain than
it is → P0. Give an explicit verdict on item 7 so CC can either lock the template and
replicate, or fix first. (SOL leg + independent SOL reference for a USD sort are
in progress separately; this round is about the USDC leg as shipped.)

# Codex review request — round 5 (population scan surfaced two issues)

Slice 2 ran the locked checker across **all 234 SPL stake pools** on mainnet
(epoch 1004). Result: 3 GREEN, 3 RED, 228 STALE. Two problems block publishing
the board — one is a checker-correctness bug, one is data quality. Converge both.

## Finding 1 — P0 correctness: INV-1 exact-identity produces FALSE REDs

All 3 REDs are INV-1 (`mint.supply != header.pool_token_supply`), by sub-token
amounts, on large healthy pools, all INV-2b solvent, all in the same direction
(**header > mint**). Stable across independent re-runs (not a race/snapshot skew;
mint and header are read from the same `getMultipleAccounts` slot):

| pool (SOL)                | header.pool_token_supply | mint.supply       | header − mint | INV-2b |
|---------------------------|--------------------------|-------------------|---------------|--------|
| Hr9pz… (10.19M, > JitoSOL)| 9071827731445977         | 9071827731445443  | 534           | solvent|
| pSPc… (1.60M)             | 1472534371911430         | 1472534371655172  | 256258        | solvent|
| Fu9B… (1.34M)             | 1150528766088306         | 1150528766087874  | 432           | solvent|

**Analysis.** Upstream docs say `pool_token_supply` "should always match" the
mint, but on-chain it can exceed it slightly. `header > mint` means the pool's
exchange-rate denominator is *larger* than the real share count, so advertised
value-per-share is *lower* than actual — conservative for holders, not a
solvency defect. The real liability is the actually-minted shares:

```
liability = mint.supply * (header.total_lamports / header.pool_token_supply)
```

When `mint.supply <= pool_token_supply`, `liability <= total_lamports`, and INV-2b
(usable backing >= total_lamports) already implies backing >= liability. So the
mismatch is safe in this direction.

**Proposed fix — INV-1 becomes directional, not exact:**
- `mint.supply > header.pool_token_supply` → **RED** (more shares exist than the
  pool accounts for: real over-issuance / under-collateralization risk).
- `mint.supply <= header.pool_token_supply` → **hold**, with the delta reported as
  a benign accounting-lag note.
- Optionally fold the liability formula into INV-2b: require
  `usable_backing >= max(total_lamports, liability)` so the check is tight in both
  directions.

**Question:** ratify this INV-1 semantics (and confirm `header > mint` is always
holder-safe), or is there a mechanism where `header > mint` signals a real
problem? What exactly makes `pool_token_supply` drift above the mint (pending
withdrawal-fee shares? epoch fee mint timing?) — I want the note to state the
cause correctly, not just "benign."

## Finding 2 — data quality: false STALE from RPC rate limits

228 STALE = 173 genuine epoch-behind (settled cheaply from enumeration) + ~55
FRESH pools that returned STALE because the public RPC throttled
`getProgramAccounts` under concurrency 4 → `INV-2b unavailable` → STALE. These are
not genuine findings; the board cannot tell "epoch-behind" from
"unverifiable-right-now."

**Proposed fix:** three explicit board states —
- `STALE-EPOCH` (header epoch < current; verified, settled),
- `GREEN`/`RED` (fully checked),
- `UNVERIFIED` (fresh but INV-2b couldn't run now; retry next cycle),

and either require a real RPC for the fresh set or add backoff+retry. The public
artifact must label coverage honestly, not present `UNVERIFIED` as a finding.

**Question:** is three-state labeling the right call, and should the first public
board ship as "173 epoch-STALE + the N fresh pools we could verify, coverage
stated," rather than claiming a complete audit until we have an RPC that serves
the full fresh set cleanly?

## Deliverable
Ratify/patch the INV-1 semantics (P0) and the board state model (P1). Once INV-1
is fixed and re-scanned, the 3 REDs should turn GREEN and the board becomes
publishable. Do not want to ship a manufactured RED.

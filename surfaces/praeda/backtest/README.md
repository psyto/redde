# Backtest — the same engine, pointed forward

Praeda reads collapses *after*. This directory tests the forward question: **could a
re-executable state invariant have flagged the fragility *before* the collapse was
acknowledged?** Economic / solvency class only — never a code-exploit prediction
(a novel logic bug leaves no state signal; only real-time drain detection catches it).

## Case 1 — stETH liquidity crisis (June 2022)

**Invariant:** a healthy stETH/ETH Curve pool (`steCRV`,
`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`) sits balanced — stETH ≈ 50% of the
pool. A rising stETH share means the hard exit asset (ETH) is draining while stETH
piles in: the exit door crowding. Computed from `eth_getBalance` (native ETH) +
`balanceOf` (stETH) at each sampled block. Reproducible by anyone.

**Result:**

| date | ETH in pool | stETH share |
| --- | --- | --- |
| Apr 20 – May 5 | ~789k | **50.2%** (balanced) |
| **May 13** | 271k (−63%) | **70.2%** ⚠ first crossing |
| Jun 11 | 137k | 79.5% |
| Jun 14 | 111k | **81.8%** (peak) |

The invariant crossed its 70% fragility threshold on **2022-05-13** — **~30 days
before** Celsius froze withdrawals (Jun 12) and ~5 weeks before stETH bottomed
(~Jun 18). A dead-simple, re-executable state read led the recognized crisis by
weeks.

**Honest bounds.** stETH did not go to zero — it depegged (~−6.5%) and recovered.
This is an early warning of a *liquidity crisis* and its leveraged casualties
(Celsius froze, 3AC failed), not a solvency-to-zero prediction, and not a
code-exploit forecast. The May wave carries UST contagion (market-wide risk-off);
the measurable fact — *ETH left the exit pool* — holds regardless. Celsius's freeze
is external context, not a claim derived here.

## Live scan — the same invariant, applied to mainnet now

`scan.mjs` runs the exit-balance invariant live across a watchlist of
systemically-relevant peg pools (LST/ETH and stablecoin Curve pools). Each pool is
**self-verified**: `coins()` are resolved on-chain (no hardcoded coin addresses),
`balances()` read, decimals normalized.

The key lesson: **balance imbalance alone is not a RED.** A deprecated / migrated pool
drains asymmetrically and looks identical to exit-pressure. So a second, decisive gate
is applied — the **peg price** (`get_dy`, dominant coin → scarce coin). A real red needs
*both*: a drained pool **and** the dominant coin actually trading at a discount.

| flag | meaning |
| --- | --- |
| `RED` | drained (≥75% one leg) **and** dominant coin off-peg (>1%) |
| `AMBER` | imbalanced and mildly off-peg |
| `benign` | imbalanced **but at peg** — a deprecated / migrated pool, not a warning |
| `green` | balanced |

First run (all systemically-relevant pools verified): **0 RED, 0 AMBER.** Two pools
flagged on balance alone — FRAXBP (90/10 FRAX/USDC) and frxETH/ETH (83/17) — were
correctly cleared as `benign`: both are small, migrated pools trading at peg
(1 FRAX → 0.991, 1 frxETH → 0.996). The majors (stETH, rETH, cbETH, ankrETH, USDe,
crvUSD) are balanced and pegged. The instrument fires 30 days early on 2022; today it
honestly reports all-clear. It is a *monitor*, not a one-shot — its value is catching
the next real event as it begins.

```sh
node scan.mjs                   # live peg-pool health scan (human-readable)
node scan.mjs --json            # → scan-latest.json
```

## Standing monitor

A snapshot is not the signal — the **trajectory** is. The 2022 backtest fired because
the share was *rising* day over day. `monitor.mjs` persists each run and alerts on
**deterioration deltas**, not just absolute flags:

- a leg's share **jumping** (≥5 pts since last run) — the leading signal, fires even
  while the pool is still `green`;
- the dominant coin's **discount widening** (≥0.5%) — the peg starting to slip;
- a flag crossing into `AMBER` / `RED`, or a pool **recovering**.

```sh
node monitor.mjs                # scan, diff vs last run, alert, persist history
node monitor.mjs --json         # machine-readable (exit 2=RED, 1=alert, 0=all-clear)
```

State lives in `monitor-state.json` (last observation per pool + a rolling history of
up to 500 runs — the forward trajectory). It, `.env`, and `monitor.log` are gitignored.

**Schedule it** with `run-monitor.sh` (reads `ETH_RPC_URL` from a local `.env`, appends
to `monitor.log`, surfaces alerts to stdout and a macOS notification):

```sh
cp .env.example .env            # then edit: ETH_RPC_URL=<your archival RPC>
./run-monitor.sh                # one run
```

**Installed schedule (this machine): once daily at 12:00 JST** via a launchd agent —
`com.psyto.praeda-monitor.plist` (`StartCalendarInterval` Hour 12; the Mac's timezone
is `Asia/Tokyo`, so 12:00 = noon JST). Peg deterioration accrues over days, so a daily
check catches a developing event the day after it begins. A launchd calendar job that
is missed while the Mac sleeps runs on next wake. Manage it:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.psyto.praeda-monitor.plist
launchctl kickstart -k gui/$(id -u)/com.psyto.praeda-monitor   # run now (test)
launchctl bootout   gui/$(id -u)/com.psyto.praeda-monitor      # stop / uninstall
```

For true 24/7 coverage, run the same wrapper from an always-on host (a small VPS /
Raspberry Pi) or a cloud cron instead — the Mac agent only fires while the Mac is awake.

The monitor states measurable facts and alerts on deterioration; it never predicts.
It is the forward-pointing counterpart of Praeda's reconstruction — built to catch the
next event as it *begins*, the way it would have on 2022-05-13.

## Run (backtest)

```sh
export ETH_RPC_URL=...          # archival
node stecrv.mjs                 # → stecrv.json (41 sampled blocks, Apr–Jun 2022)
```

## Files

- `stecrv.mjs` — the invariant, sampled block by block.
- `stecrv.json` — the reconstructed imbalance series.
- `stecrv.html` — the exhibit: the signal fired, the collapse arrived a month later.

# Vesper

Independent, **re-execution-based** verifier of **Closed-Market Liquidation Soundness (CMLS)** for
tokenized equities on Solana. *Don't trust — re-execute* ([`MANIFESTO.md`](./MANIFESTO.md)): every verdict
ships a command anyone can run to reproduce it, and each is anchored on-chain.

Tokenized equities trade 24/7; the underlying US market does not. In the gap window
(~Fri 20:00 → Sun 20:00 ET) there is no live underlying reference. Vesper re-derives, **from on-chain
state**, the exact price each venue would liquidate a tokenized-equity position against during that
window — and classifies whether it is gap-safe.

- 🟢 **GREEN** — the price is BOUNDED (heuristic band + twap-divergence limit + tight staleness) and the
  feed stays clamped to last close (market-status aware). Safe.
- 🟡 **YELLOW** — liquidations suspended off-hours (safe but blunt / accidental).
- 🔴 **RED** — liquidates against a live/stale price with no closed-market guard (gap-exposed).

## The money-shot — the SAME asset, opposite verdicts, both reproducible and on-chain

SPYx is collateral on multiple venues. Re-executed from chain, they disagree — and each verdict is a
content-addressed claim anchored on Solana (devnet Memo):

| Asset | Venue | Verdict | Why (re-executed from chain) | On-chain |
|---|---|---|---|---|
| SPYx | Jupiter Lend | 🔴 **RED** | raw 24/7 pushed feed, **zero** closed-market guards → `weekend-liveness` shows LIVE_THROUGH_CLOSURE | [tx `5HDpMX…`](https://explorer.solana.com/tx/5HDpMXqp5pTX17xFgXRQ8fhskAWgPa9YbuSns9SxgLk94NZF4aSgDufEFy5jmWUHhbnZzuLuZJ5bX82RdJP2cU49?cluster=devnet) |
| SPYx | Kamino | 🟢 **GREEN** | reads a Scope/Chainlink market-status feed, bounded on-chain (heuristic $515–858 · ≤5% twap-div · ≤300s) → `scope-price` | [tx `3B7An1…`](https://explorer.solana.com/tx/3B7An1hSzyW18S3vn638zUGcKPZthJdZs7L5GkRsLFDCShNxYoGZXqKWGSi3fqS7dD3Hg3NtMzANnMWtWxSxYzpz?cluster=devnet) |

## Two-sided re-execution (the method)

The verdict hinges on the **closed-market price input**, re-derived from chain — never a checklist of
"which oracle do they use" (the vendor does not determine safety; the guard does).

- **RED side — liveness.** `weekend-liveness.mjs` reads the update times of the price account a venue
  liquidates against. If it keeps ticking *through* the closed market with no guard → NONE → RED. This is
  airtight for a **raw** feed the venue reads directly (Jupiter).
- **GREEN side — the price value + guards.** A market-status aggregator (Scope/Chainlink) keeps ticking
  too, so liveness alone would FALSE-RED a clamped venue (`probeOnChain` now guards this). `scope-price.mjs`
  instead recovers, from chain, the reserve's `tokenInfo` guards (self-validated: `name@5032 == "SPYx"`)
  and the exact Scope price it reads — the real GREEN observable.

**Honest residual.** Kamino's *on-chain* guards are generic sanity (band + twap-divergence + staleness),
not a last-close clamp; the actual clamp is **upstream Chainlink Data Streams (off-chain)**. So GREEN =
on-chain-BOUNDED + upstream-CLAMPED — materially safer than a zero-guard raw feed, but it carries a
Chainlink trust dependency the RED verdict does not. On-chain re-execution stops at the guards; we say so.

## A claim is a command, not an assertion

The atomic unit is a **VerifiableClaim** ([`claim.mjs`](./claim.mjs)): pinned on-chain observations + a
deterministic verdict + a content hash (`claim_id`). Two nodes that re-execute the same inputs produce
the *same* `claim_id` — agreement is content-addressed; a mismatch is provable, disputable fraud. One
harness, N invariants (CMLS liveness · reserve solvency · closed-market price-guard).

```
emit  →  claim.json  →  verify (anyone reproduces)  →  post to the registry  →  anchor on Solana
```

## The standing record — published, not pitched

Demand for a verifier isn't waited for; it's created by making the finding impossible to ignore.
[`soundness-log/`](./soundness-log/) is an append-only public board: each weekend `readout.mjs` re-executes
every tracked claim, keeps only the verdicts that **reproduce**, writes an immutable `<ISO-week>.json`, and
anchors the week's money-shot on Solana. The record compounds — so when a weekend gap eventually burns a
venue, it shows the finding was published, reproducibly, every week beforehand. Meanwhile
[`campana-program/keeper.mjs`](./campana-program/) keeps the on-chain market-status rail live at every flip.

## Reproduce it yourself

```bash
# the league board (off-chain, zero-dep)
node verify-cmls.mjs

# RED side — re-execute a venue's weekend price liveness from mainnet
RPC=<url> node weekend-liveness.mjs A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff "Jupiter SPYx"

# GREEN side — re-decode Kamino's SPYx price + on-chain guards from mainnet (name@5032=="SPYx" self-validates)
RPC=<url> node scope-price.mjs

# emit + reproduce a claim, then anchor it on Solana Memo
RPC=<url> node emit-kamino.mjs                        # → claims/kamino-spyx-guard.json (🟢 GREEN)
node verify.mjs claims/kamino-spyx-guard.json         # re-derive the verdict from the pinned inputs
node broadcast.mjs claims/kamino-spyx-guard.json      # dry-run the on-chain memo (add --send --keypair to anchor)

# the ledger: agreement / dispute across nodes
node registry.mjs consensus
```

See [`RUN.md`](./RUN.md) for more, and [`SPEC.md`](./SPEC.md) for the Act-1 thesis.

## Map

```
MANIFESTO.md        Don't trust — re-execute
claim.mjs           VerifiableClaim: build + content-hash + the re-exec cores (CMLS / solvency / price-guard)
verify.mjs          reproduce a claim (L1 offline re-exec + hash · L2 --fetch re-pull inputs)
collateral-scan.mjs the venue side: which lending markets list a closed-market asset, and is the
                    listing LIVE or still ⚪ NOT-LIVE (dust vault + placeholder price wiring)?
weekend-liveness.mjs  RED-side observable: does the feed tick through closure?
verify-cmls.mjs     the league board + classify() + probeOnChain (with the aggregator false-RED guard)
scope-price.mjs     GREEN-side re-exec: Kamino's SPYx price + on-chain guards, decoded from chain
kamino-reserve.mjs  locate + read Kamino's SPYx reserve wiring (which oracle it prices from)
emit-kamino.mjs     emit the Kamino price-guard claim from chain
registry.mjs        append-only ledger + content-addressed consensus + the Solana Memo payload
broadcast.mjs       anchor a claim's verdict on Solana (Memo) — dry-run by default
campana.mjs         market-status truth feed (holiday/hours calendar)
campana-program/    the SAME feed on-chain: a deployed Solana program (Pinocchio, no_std) + cross-check client
readout.mjs         weekend readout: re-execute tracked claims → append-only log → board → anchor
run-weekend.sh      the weekly job (re-emit both sides from chain, then readout --send); wire via the plist
soundness-log/      the standing public board — one immutable JSON per week + generated README.md
gauge.mjs           consumer tool: is your xStock position weekend-safe?
claims/             emitted claims (jupiter-spyx-cmls 🔴 · kamino-spyx-guard 🟢 · marinade-solvency)
```

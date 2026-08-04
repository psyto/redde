# Redde — the re-execution verifier league

> *redde rationem* — "render the account."

One re-execution engine, four surfaces. Each takes public on-chain state, **re-executes**
the relevant invariant without any party's consent or self-report, and renders a neutral
verdict. They differ only in **time and stance** — not in machinery — so they live in one
repository instead of four.

| Surface | Stance | Invariant |
| --- | --- | --- |
| [`praeda`](surfaces/praeda) | **past** — reconstruct | Collapse-boundary flow reconstruction (e.g. Euler 2023) |
| [`redde`](surfaces/redde) | **present** — verify | Solvency re-computation |
| [`vesper`](surfaces/vesper) | **present** — verify | Closed-Market Liquidation Soundness (tokenized equities) |
| [`ruptor`](surfaces/ruptor) | **adversarial** — weaponize | Liquidity-seizure capacity (the executable trade + the loss) |

```
node run.mjs            # render the league (console)
node run.mjs --html     # also write site/league.html
```

The surfaces re-execute *off-chain* (zero-dep `.mjs`), but the neutral rail one of them proposes now
also exists *on-chain*: [`surfaces/vesper/campana-program`](surfaces/vesper/campana-program) is a deployed
Solana program (Pinocchio, `no_std`) publishing US-market OPEN/CLOSED status, whose `market_status` is the
*same deterministic function* as vesper's `campana.mjs` — cross-checked live (ON-CHAIN == OFF-CHAIN). The
re-execution property, carried across the chain boundary. Vesper also publishes a standing, append-only
[weekend soundness board](surfaces/vesper/soundness-log) — the same asset graded on each venue every week,
every row a command, each week anchored on-chain.

## Layout

```
core/                 shared library (was copy-pasted into every surface)
  rpc.mjs             JSON-RPC clients: solanaRpc / jsonRpc / makeCrawlRpc
  solana.mjs          base58 (b58encode / b58decode / pk) + account decode
  board.mjs           the league renderer (console + HTML)
run.mjs               league driver — indexes surfaces/*/surface.json
surfaces/
  praeda/  redde/  vesper/  ruptor/     each self-contained; run from its own dir
```

Each surface is self-contained and still runs standalone exactly as before:

```
cd surfaces/vesper && node verify-cmls.mjs
cd surfaces/praeda && node reconstruct.mjs
```

## History

`vesper`, `ruptor` and `praeda` were previously separate repositories
(`psyto/vesper`, `psyto/ruptor`, `psyto/praeda`), now archived and folded in here.
`redde` is the etymological root of the line — every other surface began as
"Redde, but for X." Their pre-merge git history remains at the archived repos.

## Shared core

`core/` is the canonical home for the RPC / decode / board logic every surface
once copied. All four surfaces' Solana scripts have been migrated onto it — the
inline `rpc()` and base58 copies are gone.

### `core/rpc.mjs` — three clients, one per contract

The surfaces did not all want the *same* RPC behavior, so `core` exposes the three
contracts they actually relied on rather than flattening them into one:

| Export | Behavior | Used by |
| --- | --- | --- |
| `solanaRpc(url, opts)` | throws on error; `opts.tries`, `opts.retryOn` (regex/predicate) | most Solana verify/probe scripts |
| `jsonRpc(url, m, p)` | one-shot, throws; the per-call-url primitive | callers that pass a URL per call |
| `makeCrawlRpc(url, opts)` | aggressive backoff on 429/403/5xx + JSON error; **returns `null` on exhaustion** (`throwOnExhaust` for the throwing variant) | praeda archival crawlers |

Retry policy is preserved **per call site**, not homogenized: single-shot callers
use `{ tries: 1 }`; the Codex-locked `surfaces/redde/verify.mjs` and
`verify-marinade.mjs` keep their `-32016` ("minimum context slot") wait via
`{ tries: 8, retryOn: /-32016|Minimum context slot/ }`. base58 was proven
byte-for-byte identical to each inline copy (500 randomized buffers incl.
leading-zero / all-ones) before swapping.

### Intentionally still inline

Some copies are **not** collapsed onto `core`, because their contract genuinely
differs — folding them in would change behavior:

- `surfaces/ruptor/ruptor.mjs` — retries only on 429 and returns `undefined` on any
  other error; the measurement loop depends on that swallow-and-continue path.
- `surfaces/redde/verify-eth.mjs`, `verify-btc.mjs`, `reexec.mjs` and
  `surfaces/praeda/evm/*`, `backtest/*` — EVM, per-call-url, empty-response/network
  retry, different chain. A separate follow-up could fold these onto `jsonRpc`.

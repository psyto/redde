# Campana — on-chain market-status truth feed

The neutral rail from Vesper's thesis, **on-chain**. A venue is 🔴 RED when it liquidates a tokenized
equity against a live/stale price during a *closed* US market. Campana publishes the one bit that makes
that avoidable — **is the US regular session OPEN, CLOSED, or a HALF_DAY right now** — derived
*deterministically* from a versioned holiday calendar, so a venue can read it as a guard and anyone can
**re-execute** it to check the venue isn't trusting a wrong bit.

> *Don't trust — re-execute.* The status account is not an oracle you take on faith. The exact same
> function runs off-chain ([`../campana.mjs`](../campana.mjs)); `client.mjs` cranks the chain and re-derives
> the bit at the same timestamp — if they ever disagree, that's provable, not deniable.

## Live on devnet

- **Program:** [`67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i`](https://explorer.solana.com/address/67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i?cluster=devnet)
- **Cross-checked crank:** [`2RQKrj4s…`](https://explorer.solana.com/tx/2RQKrj4sa454qm22y9aoGMB1yXLye8SfZGCrqfa383gNxZM9xDEDFtz9WvZAAVWgQ2R7mTn6ZZbZeRzK9kttNJp?cluster=devnet)
  — wrote `CLOSED · 2026-08-04 · ET-4 · last close 2026-08-03 16:00 ET · cal v202601`; the off-chain reference
  re-executed at the same slot ts produced the identical tuple. **ON-CHAIN == OFF-CHAIN.**

## How it works

- **`Crank`** (instruction byte `0`) reads the on-chain `Clock` sysvar and writes a 32-byte status account
  it owns. No off-chain input, no admin price — the only trusted datum is the compiled-in calendar
  (`CALENDAR_VERSION`, `HOLIDAYS`, `HALF_DAYS` for NYSE 2026), exactly as in `campana.mjs`.
- **`market_status(ts) -> MarketStatus`** is a pure function: Howard Hinnant civil-date math
  (`days_from_civil` / `civil_from_days`), US Eastern DST (EDT −4 / EST −5, 2nd-Sunday-March →
  1st-Sunday-November), regular hours 09:30–16:00 ET (13:00 on half-days). It is `no_std` and allocation-free.
- **State layout (32 bytes):** `status:u8 · day_kind:u8 · et_offset:i8 · _pad · calendar_version:u32 ·
  updated_ts:i64 · last_close_ts:i64 · year:i32 · month:u8 · day:u8`.

## Reproduce it

```bash
# 1. the logic is identical to campana.mjs — proven by cross-check tests
cargo test

# 2. it compiles to a real deployable Solana program
cargo build-sbf --features bpf-entrypoint     # → target/deploy/campana_program.so

# 3. crank it on devnet and re-execute the off-chain reference against what it wrote
node client.mjs                               # needs a funded devnet key (~/.config/solana/id.json)
```

`cargo test` cross-checks `market_status` against the same nine verdicts `campana.mjs`'s self-test asserts
(mid-session OPEN, pre-open / weekend / holiday CLOSED, half-day HALF_DAY, winter-EST OPEN), plus the DST
offset flip and the last-close walk-back. Same calendar in, same status out — on either side of the chain.

## Why a venue would read this

Jupiter Lend is 🔴 in Vesper's league *because it has no market-status guard* — its price account ticks
straight through the weekend. Campana is the guard whose absence is the finding: a venue that gates
liquidations on `status == OPEN` stops being gap-exposed, and — because the bit is re-executable — it can
prove to depositors it did, rather than ask them to trust it.

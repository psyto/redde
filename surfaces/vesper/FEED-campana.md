# Campana — a neutral, verifiable closed-market truth feed

**Status:** LIVE on devnet (2026-08-04) — the design below is realized in [`campana-program/`](./campana-program/)
(Pinocchio, `no_std`). Program `67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i`; a
[cross-checked crank](https://explorer.solana.com/tx/2RQKrj4sa454qm22y9aoGMB1yXLye8SfZGCrqfa383gNxZM9xDEDFtz9WvZAAVWgQ2R7mTn6ZZbZeRzK9kttNJp?cluster=devnet)
wrote the status account, and the off-chain reference (`campana.mjs`) re-executed at the same slot ts
reproduced it exactly (**ON-CHAIN == OFF-CHAIN**). See §2 for the shipped state layout vs. the sketch, and
§9 for what remains. Originally drafted 2026-07-23.

*Campana* (“the bell”) is the shared on-chain signal that says **whether a regulated market's regular
session is open**, and when it last closed. It is the one piece of the closed-market fix that a lending
venue cannot cleanly supply for itself — so it is where "partner with us" becomes real, rather than
"here's a tip you implement alone."

Price-agnostic by design. Campana never publishes a price — that stays the venue's oracle. Campana
publishes only **market status + session timing**, which is exactly the input the price oracles refuse
to provide (“the consuming protocol must detect closed markets itself”).

---

## 1. Why the venue can't just build this itself

A band needs to know *is the regular session open right now?* Building that inside each protocol means:

- **Maintenance:** NYSE regular hours + the holiday calendar + half-days, forever, per venue.
- **Trust / marking your own homework:** a status flag the venue itself controls is a trust-sensitive
  input the venue's own liquidations depend on — exactly the thing that should be *independent*.
- **Waste:** every xStock / tokenized-RWA venue on the chain has the identical need; N private,
  slightly-different, individually-unaudited hours-checkers is worse than one neutral, verifiable feed.

Campana is that one neutral feed. The venue reads it; it does not maintain it.

## 2. What it is

Per market (`US_EQUITIES_REGULAR` first), an on-chain account publishing:

```
struct Campana {
    market_id:               u16,     // US_EQUITIES_REGULAR
    status:                  u8,      // OPEN | CLOSED | HALF_DAY
    current_session_open_ts: i64,
    current_session_close_ts:i64,
    last_close_ts:           i64,      // last regular-session close (the band's anchor point in time)
    calendar_version:        u32,      // which holiday calendar was used (see §4)
    updated_ts:              i64,
    updater:                 Pubkey,   // permissionless cranker (verifiable, not trusted — see §3)
    bump:                    u8,
}
```

Note there is **no price** here. The band's `last_regular_close` *price* is snapshotted by the venue
from **its own oracle** at the instant Campana flips OPEN→CLOSED. Campana provides the *when*; the
venue keeps the *what*. This keeps Campana off the oracles' turf and free of price-trust.

**Shipped layout (32 bytes, [`campana-program`](./campana-program/)).** The deployed program writes a
leaner account than the sketch above — the essential re-executable tuple, packed:
`status:u8 · day_kind:u8 · et_offset:i8 · _pad · calendar_version:u32 · updated_ts:i64 · last_close_ts:i64
· year:i32 · month:u8 · day:u8`. The `updater` / `bump` / explicit session-open/close fields from the
sketch are deferred (the state is a single program-owned account cranked permissionlessly; session bounds
are recomputable from `market_status(updated_ts)`). The one trusted input — the calendar — is currently
**compiled into the program** (`CALENDAR_VERSION` / `HOLIDAYS` / `HALF_DAYS`, NYSE 2026), not yet a
separate versioned account (§4 remains the roadmap target).

## 3. Trust model — verifiable, not authoritative

`status` is a **deterministic function** of `(regular-session schedule + holiday calendar + clock)`.
Anyone can re-derive it. So:

- The cranker that flips the status is **permissionless and non-trusted** — a wrong flip is provably
  wrong (re-execute the schedule against the calendar and the on-chain clock). This is the Redde /
  re-execution property applied to time instead of solvency.
- The **only trusted input is the holiday calendar** (§4) — small, public, published well ahead,
  auditable, versioned. Everything downstream is mechanical.

That is the whole pitch: Campana is not another discretionary oracle to trust; it is a
*re-executable statement of a public fact*, published where contracts can read it.

## 4. The holiday calendar

A separate versioned account (or Merkle root) listing NYSE full closures and half-days for the year,
published ahead of time. Auditable against the public NYSE calendar; ideally multi-attested so no
single party can move a closure. `calendar_version` in Campana pins which one was in force, so a
historical status can always be re-checked.

## 5. How a venue integrates (with the band)

```
// in the liquidation price path:
let c = read_campana(US_EQUITIES_REGULAR);
if c.status != OPEN {
    // band against the price the venue itself snapshotted at the last OPEN->CLOSED flip
    price = closed_market_band(live_price, venue.last_regular_close, pol);   // clamp / suspend
}
```

One read. The venue supplies its own price and its own band params; Campana supplies the trigger and
the timing. See `REMEDIATION-jupiter-band.md` for the band itself.

## 6. Neutral + shared → an infrastructure position

- **Multi-venue:** the same Campana serves Jupiter/Fluid, Kamino, NestUSD, and every future xStock /
  tokenized-RWA lender or perp on Solana. One public good, not N private checkers.
- **Multi-market:** add `US_EQUITIES_OVERNIGHT` (Blue Ocean 24/5), other exchanges, metals, energy.
- **Cross-VM later:** the same neutral status is readable wherever tokenized equities land.

## 7. Vesper tie-in — why it's "us," not a tip

Campana is the **rail**; Vesper is the **certifier**. A venue earns 🟢 GREEN iff it (a) reads Campana
for status and (b) implements the band/suspend. The flywheel that makes adoption *demanded* rather
than optional:

> **Issuers** (xStocks / Backed, Ondo) require Vesper-GREEN for their token to be used as collateral
> → venues need certification → certification runs through Campana → we are the standard.

So "partner with us" = plug into a neutral rail the issuers increasingly expect, and get certified —
not "go build an hours checker."

## 8. Moat & honest caveats

- The **code is simple** (a calendar and a clock). The moat is **not** the code — it is (i) neutrality,
  (ii) adoption as the Schelling-point standard, (iii) the Vesper-certification / issuer-demand tie-in.
  Treat Campana as an oracle-class asset: value is in trust and adoption, not lines of Rust.
- **Competitive threat:** Chainlink or Pyth could ship a market-status product (Chainlink already has
  market-status feeds for some assets). Our window is that no one has shipped it for xStocks on Solana,
  and neither of them also brings the independent soundness certification. Move as the neutral
  specialist + certifier, not as an oracle vendor.
- **Demand is forward / tail-gated.** As the weekend backtest showed, routine closed-market drift is
  ~1% and harmless; Campana + the band earn their keep in the tail and as issuer requirements harden.
  This is a bet on the convergence thesis scaling, stated honestly.

## 9. Roadmap

1. ✅ **`US_EQUITIES_REGULAR` Campana (devnet) + re-execution self-test** — done: [`campana-program`](./campana-program/),
   program `67cLXa…`, `cargo test` cross-checks `market_status` against `campana.mjs`, live crank
   verified ON-CHAIN == OFF-CHAIN. *Remaining within this step:* lift the calendar out of the binary into
   a separate versioned account / Merkle root (§4), and add a permissionless keeper that re-cranks on each
   OPEN↔CLOSED flip.
2. Reference band integration (the REMEDIATION module) reading it.
3. Vesper certifies a venue GREEN on that path.
4. Add overnight/other-market Campanas as demand appears.

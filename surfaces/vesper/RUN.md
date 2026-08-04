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

**On-chain (live, devnet).** The same function is a deployed Solana program in [`campana-program/`](./campana-program/):
```
cd campana-program
cargo test                                   # market_status == campana.mjs, cross-checked
cargo build-sbf --features bpf-entrypoint    # → a real deployable .so
node client.mjs                              # crank on devnet + re-execute the off-chain reference vs what it wrote
```
Program `67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i` · a cross-checked crank:
[tx `2RQKrj4s…`](https://explorer.solana.com/tx/2RQKrj4sa454qm22y9aoGMB1yXLye8SfZGCrqfa383gNxZM9xDEDFtz9WvZAAVWgQ2R7mTn6ZZbZeRzK9kttNJp?cluster=devnet)
(ON-CHAIN == OFF-CHAIN).

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

## 5. Re-execute the verdicts from chain (the two sides)

```
# RED side — does the price account a venue liquidates against tick THROUGH the closed market?
RPC=<url> node weekend-liveness.mjs A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff "Jupiter SPYx"

# GREEN side — decode Kamino's SPYx price + its on-chain guards from chain (name@5032=="SPYx" self-validates)
RPC=<url> node scope-price.mjs
```

## 6. Claims — emit, reproduce, anchor on Solana

```
RPC=<url> node claim.mjs cmls                          # emit the Jupiter CMLS 🔴 claim
RPC=<url> node emit-kamino.mjs                         # emit the Kamino price-guard 🟢 claim
node verify.mjs claims/kamino-spyx-guard.json          # anyone re-derives the verdict from pinned inputs
node verify.mjs claims/jupiter-spyx-cmls.json --fetch  # + re-pull the observations from chain

node broadcast.mjs claims/kamino-spyx-guard.json       # DRY-RUN the on-chain Memo anchor
node broadcast.mjs claims/kamino-spyx-guard.json --send --keypair <path>   # actually anchor it (funded key)

node registry.mjs consensus                            # agreement / dispute across nodes, content-addressed
```

## 7. The weekend readout — the standing public record (the demand engine)

```
node readout.mjs                                       # re-execute every tracked claim, append the week, rebuild the board
node readout.mjs --send --keypair <path>               # + anchor the week's money-shot on Solana (Memo)
RPC=<mainnet> KEYPAIR=<devnet-key> ./run-weekend.sh    # full weekly job: re-emit both sides from chain, then the above
```
Each run keeps only verdicts that **reproduce** (`verify.mjs` L1), appends an immutable
`soundness-log/<ISO-week>.json`, and regenerates [`soundness-log/README.md`](./soundness-log/README.md)
— the public, compounding board (same SPYx: 🔴 Jupiter vs 🟢 Kamino, every week). Wire it weekly with
`com.psyto.vesper-readout.plist`. The point: when a weekend gap finally burns a venue, the record shows
the finding was published — reproducibly — every week beforehand.

The money-shot, anchored on Solana devnet: SPYx is 🔴 RED on Jupiter Lend
([tx 5HDpMX…](https://explorer.solana.com/tx/5HDpMXqp5pTX17xFgXRQ8fhskAWgPa9YbuSns9SxgLk94NZF4aSgDufEFy5jmWUHhbnZzuLuZJ5bX82RdJP2cU49?cluster=devnet))
and 🟢 GREEN on Kamino
([tx 3B7An1…](https://explorer.solana.com/tx/3B7An1hSzyW18S3vn638zUGcKPZthJdZs7L5GkRsLFDCShNxYoGZXqKWGSi3fqS7dD3Hg3NtMzANnMWtWxSxYzpz?cluster=devnet)).

---

The deterministic engine, its two-sided proof, the claim substrate, and the **on-chain anchor** (Solana
Memo) are all live above. Still ahead: the on-chain **Campana** program venues can read directly (so a
venue gains the market-status guard whose absence makes Jupiter 🔴), and live position wiring for `gauge`.

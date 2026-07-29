# Case file — the 2025-02-14 $LIBRA boundary-flow case

**Status:** inputs partially pinned. The engine renders `UNRECONSTRUCTED` until the
on-chain items below are resolved against an unthrottled / archival endpoint.

This file is the *declared, auditable input set* for a Praeda reconstruction —
public facts and public accounts only. Wallet attributions are recorded as
**"accounts publicly identified as X"** by named analytics firms, never as
adjudicated guilt. The engine measures boundary flow (`E`) and commitment timing
(`L`); it asserts no intent, beneficiary, or coordination. Sources are cited per
line; disputed and price-sensitive figures are flagged.

Derived from a fan-out research pass (105 agents, 22 sources, 23/25 claims
confirmed under 3-vote adversarial verification, 2 refuted). See *Sources*.

---

## 1. Pinned — confirmed on-chain / high-confidence

| input | value | basis |
| --- | --- | --- |
| $LIBRA SPL mint | `Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU` | 3-0 verified (TRM, Solana Explorer, Solscan) |
| decimals | `6` | live `getTokenSupply` (this session) |
| supply (now) | 999,986,029.816241 LIBRA | live `getTokenSupply` (this session) |
| venue | Meteora DLMM (dynamic pools) | 3-0 verified (Bubblemaps, TRM, Reuters/Nansen) |
| quote assets | **USDC and SOL** (two pools) | 3-0 verified |

The mint resolves on standard public RPC, but `getTokenLargestAccounts` (the clean
route to the pool vaults) is rate-limited (HTTP 429) on the free endpoint — the
first concrete confirmation that this case needs the user's own RPC key.

## 2. Candidate — from DEX aggregators, must confirm on-chain against the mint

Pool base58s below come from aggregators (DexScreener / GeckoTerminal / Meteora
edge API), **not** a single canonical forensic source; multiple pools coexist.
Treat as candidates to verify on-chain (each pool's `tokenXMint`/`tokenYMint` must
match the pinned mint), then read each pool's **reserve/vault sub-accounts** — the
literal boundary.

| pool | candidate address | source |
| --- | --- | --- |
| LIBRA/USDC | `BzzMNvfm7T6zSGFeLXzERmRxfKaNLdo4fSzvsisxcSzz` | DexScreener |
| LIBRA/USDC | `CaNCcBnJ3ecwQEiU7Wexi7AuoV1NWehyxT781ch84nqT` | GeckoTerminal |
| LIBRA/USDC | `7H4Mrs9hLWTwRXQ9hMRXpjyqf8Kc5MVz3y2D6VkXNy5z` | Meteora edge API |
| LIBRA/SOL | `3mzgxnae9s1mwa5gq6ccze1prcgsagtztmbynkfjx5sk` | DexScreener |

### RESOLVED on-chain (this session, free public RPC — the boundary research could not recover)

The DexScreener candidate `BzzMNv…` is a **confirmed Meteora DLMM LbPair**
(owned by program `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`, account dataLen
1208). Reading the LIBRA-mint largest token accounts and their owners resolved the
literal boundary of the **LIBRA/USDC pool**:

| role | address | current balance |
| --- | --- | --- |
| pool (LbPair) | `BzzMNvfm7T6zSGFeLXzERmRxfKaNLdo4fSzvsisxcSzz` | — |
| pool program | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` (Meteora DLMM) | — |
| **USDC quote vault** (value leg) | `3nSdqiF5Cxd22r8h6Ti1TwzDmcVN6SgFfDcWbBtCFRdc` | 4,553,875 USDC |
| **LIBRA token vault** (UNPRICED) | `7ehgfSLXCjd6VqtpT2Q63Mcq8TeHv6h2ujj7XvwgyNPk` | 204,331,841 LIBRA |

**Boundary = the pool's value-leg vaults.** Value leaving the USDC vault inside the
window, to an LP-removal or swap counterparty, is boundary outflow `E > 0`; the
LIBRA vault is the token side and stays `UNPRICED`. Balances above are *current*
(≈17 months post-collapse) — DLMM reserve accounts are fixed at pool init, so these
same accounts held the Feb-2025 reserves; confirm against the archival snapshot at
`t0`.

**Still unresolved:** the **LIBRA/SOL** pool (the SOL legs — 148,343 + 69,275 SOL —
came from a SOL-quoted pool). The aggregator candidate `3mzgxn…` did not surface
among current LIBRA holders; its LbPair + SOL vault must be resolved on-chain
(likely needs an unthrottled endpoint or the archival snapshot when the SOL pool
still held reserves).

## 3. Publicly-identified accounts (attribution, not adjudication)

Reported by on-chain analytics; **addresses are truncated in secondary reporting**
and must be pulled full-length from the primary Bubblemaps / Nansen threads before
they are case-file-pinnable. Chainalysis explicitly "could not confirm the
identities of the owners." Praeda pins only the public addresses and labels each
as *publicly identified as X by <firm>*.

| label (as reported) | truncated addr | reporting firm |
| --- | --- | --- |
| "Libra Deployer" / team wallet | `DEfcyK…` | Nansen ("Defcy"), Solscan tag, The Block |
| deployer funding source (EVM) | `0xcEA…` | Bubblemaps, The Block |
| "Squad Vault Milei CATA" (full base58 recovered on-chain this session) | `61yKS9bjxWdqNgAHt439DfoNfwK3uKPAJGWAsFkC5M4C` | Nansen, Bubblemaps + on-chain |
| extraction/vault cluster | `B9KTwx…`, `FTjLYk…`, `DtkvLX…`, `8DgzQs…` | Bubblemaps |
| count of creator-linked withdrawing wallets | 8 wallets | Chainalysis (via Reuters) |

## 4. Window W — bounded by UTC; slots unresolved

2025-02-14 (UTC). **No source provided Solana slot numbers**; the UTC timeline must
be mapped to slots via the archival ledger.

| event | UTC | note |
| --- | --- | --- |
| token created | ~21:58 | 18:58 Argentina (UTC-3) |
| Milei's promotional post | ~22:01 | first buyer paid ~$0.216 |
| price peak | ~22:40–22:46 | ~$5.20 (some sources $5.54), ~40–45 min after launch |
| two wallets buy→sell | 22:01 → by 22:44 | +~$5.4M realized (one wallet `HyzGo2…` ~$5.1M) |
| collapse | ~22:44 onward | −70% to −96% depending on window/source |

**Candidate window:** `t0 ≈ 22:01 UTC` (last "solvent"/pre-drain block) → `t1`
within ~1–3 h (pool-drained / price-floor block). Refine both by re-deriving the
pool swap+LP-removal sequence on-chain; do not hard-code a % — read the curve.

## 5. Pricing rule (P0) — native primary, LIBRA UNPRICED

The headline dollar figures diverge **because of the reference price**, so:

- Report **native-asset quantities as primary** — they are the hardest, most
  auditable component. USDC amounts (~44.6M) are **price-invariant**.
- SOL amounts are **price-referenced**; pin **one** independent SOL/USD reference
  (recommend VWAP over W from a feed *not* the LIBRA pool) and tag every dollar
  figure with it. Publish the sensitivity table (SPEC "Reference manifest and
  sensitivity").
- **LIBRA itself stays `UNPRICED`** — it has no reference independent of the
  affected market. The USD sort runs on the SOL + USDC legs only.

### Extraction figures (context, not the engine's claim)

| figure | native decomposition | method / source | price-sensitivity |
| --- | --- | --- | --- |
| ~$87M (first hour) | 148,343 SOL + 69,275 SOL + 0.89M + 0.91M + 42.79M USDC | Bubblemaps, itemized (~$199/SOL implied) | SOL legs move with ref |
| ~$99M (8 wallets) | USDC + SOL, native | Chainalysis (via Reuters) | SOL legs move with ref |
| ~$107M (fees + LP) | ~57.6M USDC + 249,671 SOL | Bubblemaps / Nansen | SOL legs move with ref |
| ~$90M (consolidation) | SOL + USDC at consolidation addrs | TRM Labs (snapshot) | SOL legs move with ref |

Aggregate market figures (Nansen: ~$251M lost by 86% of 15,431 >$1K-PnL wallets;
~$180M to 2,101 winners) are **mark-to-market and cohort-defined** — context only,
never the engine's extraction number.

**Refuted (do not repeat):** "$107M = 8 wallets per Nansen" (conflates Bubblemaps'
fees+LP $107M with Chainalysis' 8-wallet $99M); "the figure originates from Davis's
Coffeezilla self-report" (it originates from independent on-chain analytics).

## 6. Archival strategy

- **Feb-2025 history is retrievable** via Triton "Old Faithful" (free
  genesis→present CAR archive) and Helius historical / `getTransactionsForAddress`
  (Developer plan). **Not** reliable via a default standard RPC (retention is
  provider-dependent; confirmed live this session — even `getTokenLargestAccounts`
  is throttled).
- Prefer Helius `getTransactionsForAddress` for wallet/vault history: it covers
  **all ATAs**, which native `getSignaturesForAddress` does not — material for
  catching every boundary-crossing transfer.

## 7. Open on-chain items (need an unthrottled / archival endpoint)

1. **Full base58** for the remaining publicly-identified wallets. NOTE: the
   primary Bubblemaps/TRM articles **truncate** every address, so these are not
   recoverable from the articles — resolve on-chain (as `61yKS9bjxWdqNgAHt439DfoNfwK3uKPAJGWAsFkC5M4C`
   already was) or from the Bubblemaps interactive map. Not required for the
   reconstruction — the boundary discovers counterparties from flows; the wallet
   list is cross-check context only.
2. ✅ **LIBRA/USDC boundary RESOLVED** (§2). Remaining: the **LIBRA/SOL** pool
   LbPair + SOL vault, and confirming the USDC vaults held the reserves at `t0`
   (archival snapshot).
3. **Slot numbers** for `t0`/`t1` and the drain sequence (map UTC → slot on the
   archival ledger).
4. **One SOL/USD reference** for W (VWAP vs spot-at-withdrawal) to anchor the USD
   sort, with the sensitivity table.

## Sources

- Bubblemaps — *The $LIBRA Playbook* (primary): https://blog.bubblemaps.io/the-libra-playbook-how-one-cluster-drained-87-million-in-a-single-hour/
- TRM Labs — *The $LIBRA Affair* (primary): https://www.trmlabs.com/resources/blog/the-libra-affair-tracking-the-memecoin-that-launched-a-scandal-in-argentina
- Nansen — *LIBRA: The Aftermath*: https://research.nansen.ai/articles/libra-the-aftermath
- The Block (Bubblemaps single-entity link): https://www.theblock.co/post/341238/bubblemaps-links-single-entity-to-libra-and-melania-memecoins
- Reuters/Investing (Chainalysis ~$99M / 8 wallets): https://www.investing.com/news/economy-news/crypto-worth-99-million-withdrawn-from-mileibacked-libra-token-researchers-say-3878944
- CoinDesk ($251M investor loss, Nansen): https://www.coindesk.com/markets/2025/02/20/libra-memecoin-fiasco-destroyed-usd251m-in-investor-wealth-research-shows
- Buenos Aires Herald (timeline / price band): https://buenosairesherald.com/politics/libra-the-timeline-of-a-crypto-scandal-thats-rocking-the-milei-government
- Triton Old Faithful (archival): https://docs.triton.one/project-yellowstone/old-faithful-historical-archive
- Helius historical / getTransactionsForAddress: https://www.helius.dev/historical-data · https://www.helius.dev/blog/introducing-gettransactionsforaddress
- Solana Explorer / Solscan (mint): https://explorer.solana.com/address/Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU

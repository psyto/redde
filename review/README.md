# Adversarial review log

Redde was built by one agent and red-teamed by an independent reviewer across
eight rounds before any verdict was published. Each file here is a raw hand-off:
the reviewer's job was to **break the checker** — to make it emit a *false GREEN*
(counting backing that isn't really redeemable) or a *false RED* (flagging a
healthy protocol) — and the build side had to close every finding before shipping.

That discipline is the product. A solvency verifier is only credible if it never
fires on a target it cannot hit cleanly, so the review was as important as the
code. Notable catches, all fixed before publishing:

- **INV-1 as an exact identity produced false REDs.** Three large, healthy pools
  had `header pool_token_supply > mint supply` by sub-token amounts (a holder's
  direct SPL Token burn lowers the mint without touching the pool header). Fixed →
  directional: `mint <= header`, only over-issuance is RED. (rounds 5)
- **An authority scan let a third party spoof backing.** Summing every account
  whose withdrawer pointed at the pool authority let anyone inflate backing with a
  parked stake account. Fixed → count only the canonical PDA set / the protocol's
  own registry, with per-account state verification. (rounds 2–3, 6)
- **A record-stride error mislabeled a solvent pool.** Reading Marinade's
  `stake_list` at a 50-byte stride instead of the on-chain 56 misaligned every
  record and produced a false RED on a 2.4M-SOL protocol. Caught by the scan
  before publishing. (round 7)

Also settled here: reserve-rent exclusion, single-slot snapshot + mutation
guards, freshness gates, `msol_price` being display-only (never used for the
liability), and the LP leg being excluded from mSOL backing.

Rounds 1–4 hardened the SPL stake-pool checker (class #1). Rounds 6–8 built and
hardened the Marinade checker (class #2). Round 5 fixed INV-1 and defined the
board's three-state model.

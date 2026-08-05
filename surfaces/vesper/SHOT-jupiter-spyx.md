# Jupiter Lend liquidates tokenized stocks against a price the U.S. market never printed.

**Don't trust us. Re-execute.**

Last weekend (Aug 1–2, 2026), while the U.S. equity market was closed, the SPYx price
account that Jupiter Lend liquidates against updated **3,180 times** — max gap **4 minutes**.
Its liquidation path has a 2-hour staleness gate and no market-status guard, so the gate
never fires: over the weekend, positions can be liquidated against a price the regulated
market never printed.

This is not our opinion. It is a claim you can reproduce in ten seconds:

```bash
git clone https://github.com/psyto/redde && cd redde/surfaces/vesper
node verify.mjs claims/jupiter-spyx-cmls.json          # re-execute the verdict, offline
node verify.mjs claims/jupiter-spyx-cmls.json --fetch  # re-pull every observation from Solana
```

Output: `🔴 RED — VERIFIED`. Change one number in the claim and it fails on both the
re-executed verdict and the content hash. **You cannot lie in a claim.**

Want a second opinion? Don't take ours — be the second node:

```bash
node node2.mjs claims/jupiter-spyx-cmls.json           # independently re-fetch & re-derive
```

### This is a standing record, not a one-off post

Two things exist behind the claim above, and both are checkable rather than asserted.

**A weekly public board.** Every weekend the same assets are re-graded by re-executing the
claims, and the result is appended to an immutable log —
[`soundness-log/`](./soundness-log/README.md), newest week first. Each row is a command, not a
verdict to trust. The first week (2026-W32) records 🔴 Jupiter Lend vs 🟢 Kamino on the *same*
SPYx, with the week's money-shot anchored on-chain
([`4uuiP1ti…`](https://explorer.solana.com/tx/4uuiP1tirPuYnyZm4gNrbVvK7kJwzSKsAEMK7bN5eq331N3vNtH1aaFoT5CTcLrBLjQmLwFik68RAYwkbyPZ1x3P?cluster=devnet)).
If a venue ships a fix, the board shows the flip — on the record, in the week it happens.

**A live status feed.** The closed-market signal these verdicts rest on is not a snapshot taken
once. [Campana](./FEED-campana.md) is a program-owned status account re-cranked at every
OPEN↔CLOSED flip, and every crank is followed by re-executing the off-chain reference at the same
timestamp and asserting **ON-CHAIN == OFF-CHAIN** — the keeper refuses its own write if they
disagree. Don't trust the keeper either.

*Scope:* the verdicts are computed from **mainnet** chain state. Campana and the weekly anchor run
on **devnet** today — they are the neutral rail, not the subject of the claim.

---

### What it means

- **If you borrow on Jupiter Lend against xStocks:** on a violent Monday-open gap, your
  position can be liquidated at a weekend price with no sanity-check against the last
  official close. Know your buffer before Friday's bell.
- **If you allocate or curate xStock lending:** here is a neutral, re-executable soundness
  signal you did not have. The same tool scores Kamino 🟢 on the *same* SPYx — its Chainlink
  price-band clamps to the last close. Same asset, opposite weekend behavior.
- **Jupiter:** the fix is a market-status band (clamp to last close ± %, or suspend on
  closure). We wrote the remediation. This claim flips to 🟢 the day it ships.

### Honest scope (because the rule cuts both ways)

- The **fact** is structural: liquidations *can* run against a weekend price with no guard.
  That is re-executable and airtight.
- The **loss** is conditional, not a prediction. A typical weekend moved SPYx ~1%: no
  liquidations fire. The exposure is **tail** — a violent weekend / earnings gap. At a 20%
  Monday gap, a position at the liquidation threshold is exposed to ~10% of collateral as
  unfair liquidation or bad debt. We are not claiming an imminent loss; we are claiming an
  unguarded surface, and pricing it.
- **This claim stands or falls on re-execution, not on who published it.** Disagree? Re-execute
  and publish a contradicting claim_id. The deterministic function is the judge, not us.

Manifesto: `MANIFESTO.md` · Claim: `claims/jupiter-spyx-cmls.json` · Remediation:
`REMEDIATION-jupiter-band.md`

**Don't trust. Re-execute.**

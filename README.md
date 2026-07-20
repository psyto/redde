# Redde

> *redde rationem* — "render the account."
>
> **Solvency, whether they like it or not.**

**Status:** Slice 1 signed off (Codex convergence review, rounds 1–4). INV-1 /
INV-2a / INV-2b sound for the "usable stake backing covers the header claim"
solvency scope. One documented limitation: `isOnCurve` does not enforce strict
Ed25519 point canonicality (negligible for sha256-derived PDAs; tighten before
treating derivation as adversarial).

Redde is a permissionless solvency verifier. It reconstructs a protocol's
*claimed* financial truth (peg = 1:1, collateral healthy, backing intact) from
mainnet state — **without the protocol's consent, cooperation, or self-report** —
and renders a verdict every epoch.

On-chain finance runs on self-attestation. A dashboard says "1:1." An audit says
"as of last quarter." Redde says: *I re-executed your claim against the chain,
now. Here is what the state actually implies.*

## What this is (and is not)

- **Is:** an outward-facing verification tool. The invariant is declared in the
  open, the method is reproducible, the checker runs against public RPC.
- **Is not:** an accusation engine. Redde publishes **only** what it can
  independently recompute from public claims + public state. It targets stated
  solvency/peg claims, not private internals. No embargoed findings, no
  unverifiable "gotchas."

## The stance (why an independent verifier)

A prime broker that also audits itself is not audited. A protocol that reports
its own solvency reports the solvency it wants you to see. The verifier must be
**independent of the verified** — that is the entire point. Redde does not ask
permission because permission is the corruption.

## Slice 1 (this repo)

A single target's solvency invariant, computed live from mainnet, rendered as a
one-line verdict: `GREEN` (state satisfies the claim) / `RED` (it does not) /
`STALE` (cannot be recomputed right now — which is itself a finding).

- `MANIFESTO.md` — the stance, long form.
- `INVARIANT_SPEC.md` — the exact invariant, the exact accounts, the formula.
- `verify.mjs` — the checker. Reads mainnet, computes, renders the verdict. Zero
  dependencies (Node 18+ built-in fetch).
- `probe.mjs` — offset/layout probe used to empirically confirm the byte layout.
- `site/index.html` — the public artifact. The weapon's face.

## Run

```
# any mainnet RPC; reads only, no debug/trace. Defaults to the public endpoint.
export SOLANA_RPC_URL=...
node verify.mjs                  # verdict for JitoSOL (default target)
node verify.mjs --json <pool>    # machine-readable, any stake-pool pubkey
```

### First verified verdict (JitoSOL, pool epoch 1004)

```
verdict: [ GREEN ]   (704 validators, single finalized slot)
INV-1  no excess minting        hold ✓   mint <= header pool_token_supply
INV-2a validator-list reconc.  hold ✓   reserve + list >= claimed total
INV-2b canonical backing proof hold ✓   redeemable 10,029,277.75 SOL >= claimed
                               10,029,213.19 SOL   (707 usable PDAs, 0 unusable,
                               1 non-canonical ignored, reserve rent excluded)
```

Reconstructed from mainnet with zero cooperation from Jito: authenticated against
the canonical stake-pool program; backing summed only from validator-derived
canonical PDAs whose staker, withdrawer, lockup and vote delegation prove the
pool can spend them; reserve rent excluded as non-redeemable; read at a single
finalized slot with a pool + validator-list mutation guard. The claim survives an
independent backing check. Reproduce it with the command above (needs an RPC that
serves `getProgramAccounts`).

## Roadmap (not built here)

1. ✅ One target, one invariant, live verdict.
2. Continuous run → public status page that turns RED in real time.
3. N targets, invariant registry. Protocols may *submit* their own invariant —
   declining to declare one is a signal.
4. Re-execution (not just reads): replay protocol logic against forked state to
   check invariants that static reads cannot reach.

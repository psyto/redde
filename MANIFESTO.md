# Render the account

Every number in on-chain finance that matters — the peg, the backing, the
solvency ratio, the "fully collateralized" — reaches you as a claim. Someone
computed it, chose how to present it, and published it. The chain holds the
truth; the dashboard holds the story. Most of the time the story is true. The
problem is that you have no way to know *which* time.

Audits are quarterly and consensual. The auditor is chosen and paid by the
audited. Attestations are snapshots, signed by the party with the most to lose
from an honest one. Self-reported dashboards are marketing with decimals. None
of these is a lie, exactly. They are all just *the solvency the protocol wanted
you to see*, and none of them is recomputed from the chain, right now, by
someone who does not care whether the answer is convenient.

**Redde is that someone.**

## Three claims

**1. Solvency is a property of state, not of a press release.**
If a protocol claims 1:1 backing, that claim is either satisfied by the accounts
on mainnet or it is not. The verdict does not require the protocol's
cooperation. It requires only the chain and the arithmetic. Consent is not an
input.

**2. The verifier must be independent of the verified.**
A prime broker that runs its own risk engine, a stablecoin that reports its own
reserves, an L1 that markets its own health — each collapses the distance
between the claim and the check. That distance *is* the assurance. When the same
party makes the claim and grades it, there is no assurance, only a brand. The
industry keeps trying to sell vertical integration — faster, cleaner, one
throat to choke — as if the throat were not also the one making the promise.
Independence is not inefficiency. It is the product.

**3. A claim that cannot be recomputed is already a finding.**
When Redde cannot reconstruct a solvency claim from public state — the accounts
are opaque, the backing is off-chain, the "proof" is a signed JPEG — the verdict
is not "pass." It is `STALE`, and STALE is a color. Unverifiability is a
property worth publishing.

## What Redde will not do

It will not publish what it cannot independently recompute. It will not
manufacture a RED for attention. It will not target private internals it has no
public claim to check against. The weapon is only credible if it never fires on
a target it cannot hit cleanly. Restraint is what makes the RED, when it comes,
undeniable.

## The ask it makes of the industry

Declare your invariant. State, publicly, the property your users are trusting —
"reserve ≥ minted supply," "active stake ≥ shares × exchange rate," "insurance
fund ≥ open interest × k" — in terms Redde can recompute from the chain. Then let
it be recomputed, continuously, by someone you did not hire.

Refusing to declare one is an answer too.

*redde rationem.*

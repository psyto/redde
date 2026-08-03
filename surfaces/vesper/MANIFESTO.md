# Don't trust — re-execute.

Every collapse rhymed. FTX. Celsius. Archegos. Every audited, attested, "fully-backed"
number that someone reported and everyone believed — until the day it wasn't true. You were
never shown the truth. You were shown a **claim about the truth**, and asked to trust it.

Bitcoin's answer was *don't trust, verify* — verify the money. This is the next line:
**verify the truth.** Every solvency number, every reserve, every liquidation price — don't
trust the reported value. Re-execute it yourself.

The enemy is **opacity**: the reported number, the trusted intermediary, the "trust me." It is
the one thing every failure had in common, and the one thing a public ledger makes unnecessary.

## Why re-execution, and not another oracle

An oracle *reports* a fact from outside the chain — you trust the reporter. Re-execution
*derives* a fact that is already inside the chain — a deterministic function of public state.
It has **one correct answer**, and anyone can compute it. So honest re-executors must agree;
disagreement isn't opinion, it's **provable fraud**. One honest challenger is enough.

Oracles carry the outside in. **This proves the inside.** You cannot have a movement around
trusting a feed — you can only trust it. You *can* have a movement around re-execution, because
every one of us can run it, see it, and prove it. The primitive is democratic. That is the point.

## This is not a claim. It is a command.

We do not ask you to believe that Jupiter Lend liquidates tokenized stocks against a weekend
price the regulated market never printed. We hand you the proof and the tool to reproduce it:

```
node verify.mjs claims/jupiter-spyx-cmls.json          # re-execute the verdict, offline, zero-dep
node verify.mjs claims/jupiter-spyx-cmls.json --fetch  # re-pull every observation from Solana
```

A claim pins its own evidence — the raw on-chain observations — and its verdict is derived from
them alone. No price oracle is trusted to decide it; the only trusted input is the holiday
calendar. Change one number in the verdict and `verify` fails on both the re-executed result and
the content hash. **You cannot lie in a claim.** That is honesty by construction, not by promise.

## The rule we hold ourselves to

> No assertion appears here that we cannot hand you a command to reproduce.

If we can't give you the `verify`, we don't get to say it. This manifesto is only as true as the
code that lets you check it. Re-run everything above. Trust none of it.

## What you do

Re-execute your bags. Take the venue holding your collateral, re-derive whether it will liquidate
you against a price from a market that was closed, and publish your verdict. Then re-run someone
else's. Every reproduced verdict recruits the next re-executor — and staffs the network that makes
this the norm: a world where capital will not touch a number it cannot re-execute.

**Don't trust. Re-execute.**

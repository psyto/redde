# Proof of Reserves — the asset side

**Status:** draft proposal (Vesper / Redde, 2026-08-07). Grounded in [`otter-sec/por_v2`](https://github.com/otter-sec/por_v2)
@ `3e1b89a` (2025-08-27), read from a clean clone. Every command below is reproducible by anyone.

> This is a constructive extension, not a critique and not a vulnerability report. The published
> proof does exactly what it says it does. What follows is about the half that no proof system
> can reach on its own — and about one artifact that would let a third party close it.

---

## 1. What is already proven — the hard half

Daily ZK Proof of Reserves since 2025-08-18, regenerated internally every ~10 minutes, PoRv2 on
Plonky2, verifier published as open source, continuously audited by OtterSec.

Proving the **liability** side in zero knowledge is the difficult half of this problem. It requires
committing every user balance into a Merkle tree, aggregating them recursively without revealing
any individual account, and producing a proof a stranger can check on a laptop. Most exchanges do
not attempt it. This one ships it daily and hands you the verifier.

That is the part worth saying first, because the rest of this document is only interesting *because*
that part exists.

---

## 2. What the published verifier takes as input

From the source at the pinned commit:

**2-1. `verify` reads exactly two files.**

```rust
// src/main.rs:292-302
Commands::Verify => {
    let final_proof_file = std::fs::read_to_string("final_proof.json")?;
    let merkle_tree_file = std::fs::read_to_string("merkle_tree.json")?;
    assert_config(&final_proof);
    verify_root(final_proof, merkle_tree);
```

`verify_root` then performs six checks: root-circuit digest match, proof verification, asset-price
match, decimals consistency, root-hash match, Merkle consistency. All six are **internal** to those
two files. No external state is consulted.

**2-2. The codebase has no concept of a chain, an address, or an ownership signature.**

```bash
grep -rniE "address|wallet|utxo|rpc|on-?chain|blockchain|ownership|signature|pubkey|custod" src/
# → exactly 1 hit: src/core/server.rs:100 — "Address already in use" (a UNIX socket error string)
```

**2-3. The value printed as "asset reserves" is the sum of user balances.**

The verifier prints it under that name:

```rust
// src/core/verifier.rs:80-81
let final_balances_offsets = RecursiveCircuit::get_final_balances_offset(asset_count);
let asset_reserves = final_proof.proof.public_inputs[final_balances_offsets].to_vec();
```

and the circuit says what that public input actually is:

```rust
// src/circuits/recursive_circuit.rs:127
builder.register_public_inputs(&final_balances); // sum of all assets of BATCH_SIZE accounts

// src/circuits/batch_circuit.rs:84-88 — how final_balances is formed
let mut sum = builder.zero();
for account in &accounts { sum = builder.add(account.asset_balances[i], sum); }
builder.connect(sum, *total_value);
```

The log line agrees, and is precise about it: *"the final **needed** asset reserves"* — the amount
that **should** be held, per asset. Not the amount that is held.

This is not a criticism of the naming. It is the correct output for a liability proof, and the code
is honest about it in the string. The point is only that the comparison against actual holdings is,
by construction, **outside** the system.

**2-4. The completeness residual is self-declared in the code.**

```rust
// src/core/verifier.rs:71
log_warning!("NOTE2: We cannot guarantee that all users were included in the proof, but you can
              check if you were included by verifying the inclusion proof");
```

Omission of users is not covered by the global proof; it is covered per-user, by each user checking
their own inclusion proof. Since inclusion proofs are distributed individually, a third party cannot
measure coverage. This is a known and unavoidable property of the design, noted here for completeness
— the proposal below does not change it.

**2-5.** `verify-inclusion` does not rebuild the circuit; it trusts the circuit data embedded in
`final_proof.json` (`verifier.rs:233`, also stated in the README). Full verification requires running
`verify` alongside it.

---

## 3. What is therefore still trusted

> The proof establishes, cryptographically, **what must be held**.
> Whether it **is** held remains a matter of trust.

Nothing in the published artifacts lets an outsider re-derive the asset side. That is not a gap in
the proof — a ZK proof over user balances cannot reach on-chain custody by itself. It is a gap in
the *artifact set*.

**A note on our own certainty.** We verified the code at `otter-sec/por_v2` @ `3e1b89a`. We have not
independently confirmed that the daily published proofs are produced by exactly this build. If a
newer or different build is in production, we would re-run this analysis against it and correct
anything that changed — please point us at it.

---

## 4. The one artifact that is missing

**A signed set of reserve addresses.**

That is the whole ask. Concretely, a periodically published document:

```json
{
  "timestamp_ms": 1754500000000,
  "assets": [
    { "asset": "SOL",  "chain": "solana",   "addresses": ["…", "…"] },
    { "asset": "USDC", "chain": "solana",   "addresses": ["…"] },
    { "asset": "BTC",  "chain": "bitcoin",  "addresses": ["…"] }
  ],
  "attestation_key": "<pubkey>",
  "signature": "<sig over the canonical serialization above>"
}
```

Two grades, either of which is enough to start:

| Grade | What is signed | What it proves |
|---|---|---|
| **A — list attestation** | One key signs the address list | These are the addresses you claim. Cheap, and enough to make the reserve side *publicly re-computable*. |
| **B — per-address control** | Each listed address signs a challenge containing the proof timestamp | You control each address at that instant. Removes the "list someone else's cold wallet" failure mode. |

Grade B is the stronger form and is what we would suggest converging on. Grade A is enough to make
the end-to-end re-execution exist at all.

---

## 5. What we would build against it

The asset-side verifier — open source, run publicly, no dependency on you beyond the address set.

For each asset, at a pinned slot/block:

1. Re-compute the balance held by every listed address, directly from public chain state.
2. Read the per-asset **needed reserves** from the ZK proof's public inputs (already published).
3. Assert `held ≥ needed`, per asset, and publish the result as a verifiable claim.

We are not proposing to build this from scratch. This is an existing claim type in our harness
(`reserve-solvency`), already running against a live protocol:

```bash
node verify.mjs claims/marinade-solvency.json
#   PASS  backing ≥ liability reproduces
#   PASS  claim_id (content hash) matches body
#   ✅ VERIFIED — the verdict reproduces from the claim
```

Same schema, same offline verifier, different subject. Adding an exchange's reserve addresses is a
new subject, not a new engine.

The output is a claim anyone can re-execute offline, whose id is the content hash of its own body —
so we cannot quietly restate it later either. Our own record works the same way: see
[`soundness-log/`](./soundness-log/), where every past week's evidence is frozen at its content
address.

---

## 6. Honest residuals of the combined system

If both halves shipped, this is what would *still* be unproven. We would rather say it here than be
told it later.

1. **Point-in-time.** Balances proven at a snapshot can be borrowed for the snapshot. Mitigated, not
   solved, by frequency and by unannounced timing — and the current daily/10-minute cadence is
   already a strong mitigation.
2. **User omission.** Unchanged by this proposal. Still `NOTE2`: covered per-user, not globally.
3. **Address-set exhaustiveness.** Per-address signatures prove *control*, never *completeness* —
   there is no way to prove no further addresses exist. Note the incentive direction, though:
   omitting an address only makes reserves look *smaller*. The dangerous direction is claiming an
   address you do not control, and Grade B closes exactly that.
4. **Off-chain backing is out of scope.** This matters specifically for tokenized equities: 1:1
   backing held at a US custodian is not on-chain state and cannot be re-executed from a chain.
   An on-chain reserve verifier covers crypto reserves. The equity backing needs a separate
   custodian attestation, and we are not claiming to solve that here.
5. **Liability correctness.** We verify the asset side against the proof's published outputs. If the
   proof itself were generated from wrong inputs, this does not catch it — that is what the ZK half
   and the audit are for.

---

## 7. Why this is worth doing, from your side

The standard industry criticism runs the other way: exchanges that publish *only* the asset side —
a list of addresses, no liabilities — where the missing half is the hard one.

This is the mirror image. The hard half is shipped and the easy half is missing. As far as we can
tell, nobody has said this publicly about anyone, in either direction.

Whoever publishes a signed address set alongside an existing ZK liability proof becomes the first
exchange whose reserves are re-executable end to end by a stranger. That is a claim with a date on
it, and right now it is unclaimed.

---

## 8. Reproduce everything above

```bash
git clone https://github.com/otter-sec/por_v2 && cd por_v2 && git checkout 3e1b89a

grep -rniE "address|wallet|utxo|rpc|on-?chain|blockchain|ownership|signature|pubkey|custod" src/
sed -n '292,302p' src/main.rs                 # verify takes two files
sed -n '67,93p'   src/core/verifier.rs        # "final needed asset reserves"
sed -n '125,128p' src/circuits/recursive_circuit.rs   # the public input is a sum of account balances
sed -n '84,88p'   src/circuits/batch_circuit.rs       # …formed by summing per-account balances
sed -n '71p'      src/core/verifier.rs        # the self-declared completeness residual
sed -n '228,240p' src/core/verifier.rs        # verify-inclusion trusts embedded circuit data
```

Don't trust this document — re-execute it.

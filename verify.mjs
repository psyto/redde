/**
 * Redde — Slice 1 checker.
 *
 *   redde rationem — "render the account."
 *   Solvency, whether they like it or not.
 *
 * Recomputes an LST's stated solvency from mainnet state and renders a verdict.
 * Zero dependencies (Node 18+ built-in fetch + node:crypto). Reads only; no
 * debug/trace RPC; no protocol cooperation. See INVARIANT_SPEC.md.
 *
 *   SOLANA_RPC_URL=... node verify.mjs [stakePoolPubkey]
 *   node verify.mjs --json [stakePoolPubkey]
 *
 * GREEN is earned only when authenticity + freshness + INV-1 + INV-2a + INV-2b
 * all hold. INV-2b sums ONLY the canonical PDAs derived from the validator list
 * (reserve + per-validator + per-transient), not every account that happens to
 * point its withdrawer at the pool authority — otherwise a third party could
 * inflate backing and forge a GREEN.
 */
import { createHash } from "node:crypto";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const STAKE_POOL_PROGRAM = "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy";
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";

const OFF = {
  withdrawBump: 97, validatorList: 98, reserveStake: 130, poolMint: 162,
  tokenProgram: 226, totalLamports: 258, poolTokenSupply: 266, lastUpdateEpoch: 274,
  lockup: 282, // StakePool.lockup (unix i64, epoch u64, custodian Pubkey) = 48 bytes
};
const LOCKUP_LEN = 48;
const VITEM = 73;       // ValidatorStakeInfo
const VLIST_CURSOR = 9; // AccountType(1) + max_validators(u32) + vec_len(u32)
// ValidatorStakeInfo field offsets: active@0 transient@8 lastUpdate@16
// transientSeed@24(u64) unused@32 validatorSeed@36(u32) status@40 vote@41(32)
const V = { active: 0, transient: 8, transientSeed: 24, validatorSeed: 36, vote: 41 };
// StakeStateV2: tag u32@0; Meta{ rent u64@4, staker@12, withdrawer@44,
// lockup@76..124 }; Stake.delegation.voter@124. Tags: 1=Initialized 2=Stake.
const STAKE = { rent: 4, staker: 12, withdrawer: 44, lockup: 76, voter: 124 };
const STAKE_WITHDRAWER_OFFSET = STAKE.withdrawer;
const MINT_SUPPLY_OFFSET = 36;

// ---- base58 (canonical division method; no leading-zero bug) ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(buf) {
  const bytes = [...buf];
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const enc = [];
  let start = zeros;
  while (start < bytes.length) {
    let rem = 0;
    for (let i = start; i < bytes.length; i++) {
      const acc = (rem << 8) + bytes[i];
      bytes[i] = (acc / 58) | 0; rem = acc % 58;
    }
    enc.push(B58[rem]);
    if (bytes[start] === 0) start++;
  }
  return "1".repeat(zeros) + enc.reverse().join("");
}
function b58decode(str) {
  const bytes = [];
  for (const ch of str) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("bad base58 char");
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0;
  for (const ch of str) { if (ch === "1") zeros++; else break; }
  const out = Buffer.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
  if (out.length !== 32) throw new Error(`pubkey not 32 bytes: ${str}`);
  return out;
}

// ---- ed25519 on-curve check (for findProgramAddress) ----
const P = (1n << 255n) - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const I = 19681161376707505956807079304988542015446066515923890162744021073123829784752n;
const fmod = (a) => ((a % P) + P) % P;
function fpow(b, e) { let r = 1n; b = fmod(b); while (e > 0n) { if (e & 1n) r = fmod(r * b); b = fmod(b * b); e >>= 1n; } return r; }
const finv = (a) => fpow(a, P - 2n);
// Slice-1 limitation (Codex round-4 P2): this does not reject non-canonical
// encodings (y >= P or the sign bit) the way curve25519's strict decompression
// does. The misclassification probability for a sha256 digest is ~2^-249 and
// does not affect verdicts; tighten before treating PDA derivation as adversarial.
function isOnCurve(buf) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(buf[i]);
  y &= (1n << 255n) - 1n; // clear sign bit
  const y2 = fmod(y * y);
  const num = fmod(y2 - 1n);
  const den = fmod(fmod(D * y2) + 1n);
  const x2 = fmod(num * finv(den));
  if (x2 === 0n) return true;
  let x = fpow(x2, (P + 3n) / 8n);
  if (fmod(x * x - x2) !== 0n) x = fmod(x * I);
  return fmod(x * x - x2) === 0n;
}
function findProgramAddress(seeds, programIdBytes) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump]));
    h.update(programIdBytes);
    h.update(Buffer.from("ProgramDerivedAddress"));
    const digest = h.digest();
    if (!isOnCurve(digest)) return b58encode(digest);
  }
  return null;
}
function createProgramAddress(seeds, programIdBytes) {
  const h = createHash("sha256");
  for (const s of seeds) h.update(s);
  h.update(programIdBytes);
  h.update(Buffer.from("ProgramDerivedAddress"));
  return b58encode(h.digest());
}
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

// ---- RPC ----
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Retry -32016 ("minimum context slot not reached") — load-balanced RPC replicas
// can momentarily lag the slot another call just observed.
async function rpcWait(method, params, tries = 8) {
  for (let i = 0; ; i++) {
    try { return await rpc(method, params); }
    catch (e) {
      if (i < tries - 1 && /-32016|Minimum context slot/.test(e.message)) { await sleep(400); continue; }
      throw e;
    }
  }
}
const dec = (v) => (v ? { owner: v.owner, lamports: BigInt(v.lamports), data: Buffer.from(v.data[0], "base64") } : null);
async function getMultiple(pubkeys, minContextSlot) {
  const cfg = { encoding: "base64", commitment: "finalized" };
  if (minContextSlot != null) cfg.minContextSlot = minContextSlot;
  const res = await rpcWait("getMultipleAccounts", [pubkeys, cfg]);
  return { slot: res.context.slot, values: res.value.map(dec) };
}
const u64 = (b, o) => b.readBigUInt64LE(o);
const pk = (b, o) => b58encode(b.subarray(o, o + 32));

// Canonical backing PDA set derived from the validator list — the ONLY accounts
// that legitimately back shares. reserve + per-validator + per-transient.
// Returns [{ address, kind, vote? }]; each must still pass usable-state checks.
function expectedBackingPdas(poolBytes, reserveAddr, vd, count, programIdBytes) {
  const out = [{ address: reserveAddr, kind: "reserve" }];
  for (let i = 0; i < count; i++) {
    const base = VLIST_CURSOR + i * VITEM;
    const active = u64(vd, base + V.active);
    const transient = u64(vd, base + V.transient);
    const vote = vd.subarray(base + V.vote, base + V.vote + 32);
    const voteStr = b58encode(vote);
    if (active > 0n) {
      const seed = vd.readUInt32LE(base + V.validatorSeed);
      const seeds = seed !== 0 ? [vote, poolBytes, u32le(seed)] : [vote, poolBytes];
      const pda = findProgramAddress(seeds, programIdBytes);
      if (pda) out.push({ address: pda, kind: "validator", vote: voteStr });
    }
    if (transient > 0n) {
      const tseed = vd.subarray(base + V.transientSeed, base + V.transientSeed + 8);
      const pda = findProgramAddress([Buffer.from("transient"), vote, poolBytes, tseed], programIdBytes);
      if (pda) out.push({ address: pda, kind: "transient", vote: voteStr });
    }
  }
  return out;
}

// A stake account is USABLE backing only if the pool controls it: staker and
// withdrawer are the pool authority and its lockup matches the pool's. An account
// at the right address with wrong authority/lockup/vote is not backing — the
// upstream updater ignores or repairs it — so we must not count its lamports.
function usableMeta(d, authority, lockup) {
  return d && d.length >= STAKE.lockup + LOCKUP_LEN
    && pk(d, STAKE.staker) === authority
    && pk(d, STAKE.withdrawer) === authority
    && d.subarray(STAKE.lockup, STAKE.lockup + LOCKUP_LEN).equals(lockup);
}
function usableStake(entry, d, authority, lockup) {
  if (!usableMeta(d, authority, lockup)) return false;
  const tag = d.readUInt32LE(0);
  if (entry.kind === "reserve") return tag === 1;
  if (entry.kind === "validator") return tag === 2 && d.length >= STAKE.voter + 32 && pk(d, STAKE.voter) === entry.vote;
  if (entry.kind === "transient") return tag === 1 || tag === 2;
  return false;
}

export async function check(pool, opts = {}) {
  const notes = [];
  const programBytes = b58decode(STAKE_POOL_PROGRAM);

  // (1) Authenticate + resolve references.
  const first = await getMultiple([pool]);
  const p0 = first.values[0];
  if (!p0) return stale(pool, "stake pool account not found");
  if (p0.owner !== STAKE_POOL_PROGRAM) return stale(pool, "not owned by canonical SPL stake-pool program");
  if (p0.data.length < 282 || p0.data[0] !== 1) return stale(pool, "bad stake-pool type/size");

  const mintAddr = pk(p0.data, OFF.poolMint);
  const reserveAddr = pk(p0.data, OFF.reserveStake);
  const vlistAddr = pk(p0.data, OFF.validatorList);
  const tokenProgram = pk(p0.data, OFF.tokenProgram);
  const bump = p0.data[OFF.withdrawBump];

  // (2) Freshness gate. Reuse a caller-supplied epoch when scanning many pools.
  const currentEpoch = opts.currentEpoch ??
    (await rpc("getEpochInfo", [{ commitment: "finalized" }]).catch(() => null))?.epoch;
  if (currentEpoch == null) return stale(pool, "current epoch unreadable");
  const poolEpoch = u64(p0.data, OFF.lastUpdateEpoch);
  if (poolEpoch < BigInt(currentEpoch)) {
    return stale(pool, `pool update epoch ${poolEpoch} < current epoch ${currentEpoch}`);
  }

  // (3) Consistent snapshot of pool + referenced accounts.
  const snap = await getMultiple([pool, mintAddr, reserveAddr, vlistAddr]);
  const [pool2, mint, reserve, vlist] = snap.values;
  if (!pool2 || !mint || !reserve || !vlist) return stale(pool, "referenced account unreadable in snapshot");
  if (pk(pool2.data, OFF.poolMint) !== mintAddr) return stale(pool, "pool mutated across snapshot");
  if (mint.owner !== tokenProgram || mint.data.length < 82 || mint.data[45] !== 1) {
    return stale(pool, "pool mint wrong token program / uninitialized");
  }
  if (reserve.owner !== STAKE_PROGRAM) return stale(pool, "reserve is not a stake-program account");
  if (vlist.owner !== STAKE_POOL_PROGRAM || vlist.data.length < VLIST_CURSOR || vlist.data[0] !== 2) {
    return stale(pool, "validator list wrong owner/type/size");
  }

  const claimedTotal = u64(pool2.data, OFF.totalLamports);
  const claimedSupply = u64(pool2.data, OFF.poolTokenSupply);

  // INV-1 — no excess minting (directional). mint > header means more shares
  // exist than the pool accounts for (over-issuance) → RED. mint <= header is
  // safe: outstanding liability is at most the header claim. header > mint drift
  // is normal — a holder's direct SPL Token burn lowers mint supply without
  // touching the pool header — and prices the pool conservatively for holders.
  const mintSupply = u64(mint.data, MINT_SUPPLY_OFFSET);
  const supplyDelta = claimedSupply - mintSupply; // positive: header exceeds mint
  const inv1 = mintSupply <= claimedSupply;
  const liability = claimedSupply === 0n
    ? (mintSupply === 0n ? 0n : null)
    : (mintSupply * claimedTotal + claimedSupply - 1n) / claimedSupply; // ceil
  const requiredBacking = liability == null || liability < claimedTotal ? claimedTotal : liability;
  if (!inv1) {
    notes.push(`INV-1: mint.supply ${mintSupply} > header ${claimedSupply} (excess minting)`);
  } else if (supplyDelta > 0n) {
    notes.push(`SUPPLY-DRIFT: header exceeds mint by ${supplyDelta} base units (direct token burns); header pricing is conservative vs outstanding shares`);
  }

  // INV-2a — validator-list reconciliation (self-report gate).
  const count = vlist.data.readUInt32LE(5);
  if (count > Math.floor((vlist.data.length - VLIST_CURSOR) / VITEM)) {
    return stale(pool, "validator list length exceeds capacity");
  }
  let recorded = 0n;
  for (let i = 0; i < count; i++) {
    const base = VLIST_CURSOR + i * VITEM;
    recorded += u64(vlist.data, base + V.active) + u64(vlist.data, base + V.transient);
  }
  const listControlled = reserve.lamports + recorded;
  const inv2a = listControlled >= claimedTotal;
  if (!inv2a) notes.push(`INV-2a: reserve+list ${listControlled} < claimed ${claimedTotal}`);

  // INV-2b — independent actual backing over the CANONICAL, USABLE PDA set only.
  const poolBytes = b58decode(pool);
  const lockup = pool2.data.subarray(OFF.lockup, OFF.lockup + LOCKUP_LEN);
  const authority = createProgramAddress([poolBytes, Buffer.from("withdraw"), Buffer.from([bump])], programBytes);
  const expected = expectedBackingPdas(poolBytes, reserveAddr, vlist.data, count, programBytes);

  let inv2b = null, redeemable = null, reserveRent = null, usable = null, unusable = null, excluded = null;
  try {
    const res = await rpcWait("getProgramAccounts", [STAKE_PROGRAM, {
      encoding: "base64", commitment: "finalized", minContextSlot: snap.slot, withContext: true,
      dataSlice: { offset: 0, length: STAKE.voter + 32 }, // through delegation.voter
      filters: [{ memcmp: { offset: STAKE_WITHDRAWER_OFFSET, bytes: authority } }],
    }]);
    const gpa = res.value;
    const accts = new Map(gpa.map((a) => [a.pubkey, { lamports: BigInt(a.account.lamports), data: Buffer.from(a.account.data[0], "base64") }]));

    // (4) Mutation guard: re-read pool + validator list at/after the scan slot;
    // the claim AND the derived PDA set must be stable across the whole window.
    const reread = await getMultiple([pool, vlistAddr], res.context.slot);
    const [p3, v3] = reread.values;
    if (!p3 || !v3 || !v3.data.equals(vlist.data) ||
        u64(p3.data, OFF.totalLamports) !== claimedTotal ||
        u64(p3.data, OFF.poolTokenSupply) !== claimedSupply ||
        u64(p3.data, OFF.lastUpdateEpoch) !== poolEpoch ||
        pk(p3.data, OFF.validatorList) !== vlistAddr || pk(p3.data, OFF.reserveStake) !== reserveAddr) {
      return stale(pool, "pool or validator list mutated during read window");
    }

    // Count ONLY usable canonical PDAs; unusable/absent contribute 0 (a real
    // shortfall then surfaces as INV-2b < claimed → RED). reserve rent is not
    // redeemable backing and is subtracted; validator/transient rent stays.
    let actualUsable = 0n; usable = 0; unusable = 0; let reserveData = null;
    for (const entry of expected) {
      const acc = accts.get(entry.address);
      if (acc && usableStake(entry, acc.data, authority, lockup)) {
        actualUsable += acc.lamports; usable++;
        if (entry.kind === "reserve") reserveData = acc.data;
      } else {
        unusable++;
      }
    }
    // Truly non-canonical = under the authority but not in the derived PDA set.
    // (Do not fold unusable-but-canonical PDAs into this count — they are already
    //  reported as `unusable`.)
    const canonicalSeen = expected.filter((entry) => accts.has(entry.address)).length;
    excluded = gpa.length - canonicalSeen;
    if (!reserveData) {
      inv2b = false;
      notes.push("INV-2b: reserve stake account absent or not usable by the pool");
    } else {
      reserveRent = u64(reserveData, STAKE.rent);
      redeemable = actualUsable - reserveRent;
      inv2b = redeemable >= requiredBacking;
      if (!inv2b) notes.push(`INV-2b: redeemable backing ${redeemable} < required ${requiredBacking}`);
    }
    if (unusable > 0) notes.push(`INV-2b: ${unusable} canonical PDA(s) absent/unusable — not counted as backing`);
    if (excluded > 0) notes.push(`INV-2b: ${excluded} non-canonical account(s) under the authority ignored`);
  } catch (e) {
    notes.push(`INV-2b unavailable (${e.message}) — cannot independently prove backing`);
  }

  let verdict;
  if (!inv1 || inv2a === false || inv2b === false) verdict = "RED";
  else if (inv2b === true) verdict = "GREEN";
  else verdict = "STALE";
  if (verdict === "STALE" && !notes.some((n) => n.startsWith("INV-2b unavailable"))) {
    notes.push("STALE: reconciliation held, but actual canonical stake accounts were not proven.");
  }

  return {
    verdict, target: pool, epoch: Number(poolEpoch), currentEpoch,
    validators: count, snapshotSlot: snap.slot, withdrawAuthority: authority,
    inv1: { claimedSupply: claimedSupply.toString(), mintSupply: mintSupply.toString(), ok: inv1,
      supplyDelta: supplyDelta.toString(), requiredBacking: requiredBacking.toString() },
    inv2a: { listControlled: listControlled.toString(), claimedTotal: claimedTotal.toString(), ok: inv2a },
    inv2b: inv2b === null ? { available: false }
      : {
          available: true, ok: inv2b,
          redeemableBacking: redeemable == null ? null : redeemable.toString(),
          reserveRent: reserveRent == null ? null : reserveRent.toString(),
          requiredBacking: requiredBacking.toString(), claimedTotal: claimedTotal.toString(),
          usablePdas: usable, unusablePdas: unusable, nonCanonicalIgnored: excluded,
        },
    notes,
  };
}
function stale(pool, why) {
  return { verdict: "STALE", target: pool, notes: [`STALE: ${why}. An unverifiable claim is a published property.`] };
}

import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
const args = process.argv.slice(2);
const json = args.includes("--json");
const pool = args.find((a) => !a.startsWith("--")) || "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb";

const rep = await check(pool).catch((err) => stale(pool, err instanceof Error ? err.message : String(err)));

if (json) {
  console.log(JSON.stringify(rep, null, 2));
} else {
  const seal = { GREEN: "[ GREEN ]", RED: "[  RED  ]", STALE: "[ STALE ]" }[rep.verdict];
  const sol = (s) => (Number(BigInt(s)) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });
  console.log(`\n  redde — render the account`);
  console.log(`  target : ${rep.target}`);
  const meta = rep.epoch != null ? `   (pool epoch ${rep.epoch}/${rep.currentEpoch}, ${rep.validators} validators, slot ${rep.snapshotSlot})` : "";
  console.log(`  verdict: ${seal}${meta}\n`);
  if (rep.inv1) {
    console.log(`  INV-1  no excess minting        ${rep.inv1.ok ? "hold ✓" : "FAIL ✗"}   mint=${rep.inv1.mintSupply}  header=${rep.inv1.claimedSupply}${BigInt(rep.inv1.supplyDelta) > 0n ? `  (drift +${rep.inv1.supplyDelta})` : ""}`);
    console.log(`  INV-2a validator-list reconc.  ${rep.inv2a.ok ? "hold ✓" : "FAIL ✗"}   reserve+list=${sol(rep.inv2a.listControlled)} SOL  claimed=${sol(rep.inv2a.claimedTotal)} SOL`);
    if (rep.inv2b.available) {
      const redeem = rep.inv2b.redeemableBacking == null ? "n/a" : `${sol(rep.inv2b.redeemableBacking)} SOL`;
      console.log(`  INV-2b canonical backing proof ${rep.inv2b.ok ? "hold ✓" : "FAIL ✗"}   redeemable=${redeem}  claimed=${sol(rep.inv2b.claimedTotal)} SOL`);
      console.log(`                                 ${rep.inv2b.usablePdas} usable PDAs, ${rep.inv2b.unusablePdas} unusable, ${rep.inv2b.nonCanonicalIgnored} non-canonical ignored, reserve-rent ${rep.inv2b.reserveRent == null ? "n/a" : sol(rep.inv2b.reserveRent) + " SOL"} excluded`);
    } else {
      console.log(`  INV-2b canonical backing proof n/a     — RPC did not serve getProgramAccounts`);
    }
  }
  for (const n of rep.notes) console.log(`\n  ${n}`);
  console.log("");
}
process.exit(rep.verdict === "RED" ? 1 : 0);
}

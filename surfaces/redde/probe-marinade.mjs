// Slice 3 scouting: locate Marinade State fields empirically (nested struct
// sizes aren't in the public layout, so we find offsets by matching known
// on-chain values), then sanity-check the solvency inputs.
//
//   node probe-marinade.mjs
import { createHash } from "node:crypto";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const MARINADE_PROGRAM = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
const STATE = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const PRICE_DENOM = 0x1_0000_0000n; // 2^32

import { solanaRpc } from "../../core/rpc.mjs";
import { b58encode as b58e, b58decode as b58d } from "../../core/solana.mjs";
function cpa(seeds, prog) { const h = createHash("sha256"); for (const s of seeds) h.update(s); h.update(b58d(prog)); h.update(Buffer.from("ProgramDerivedAddress")); return b58e(h.digest()); }
const rpc = solanaRpc(RPC, { tries: 1 });
async function acct(pk) { const r = await rpc("getAccountInfo", [pk, { encoding: "base64" }]); return r?.value ? { owner: r.value.owner, lamports: BigInt(r.value.lamports), data: Buffer.from(r.value.data[0], "base64") } : null; }
const u64 = (b, o) => b.readBigUInt64LE(o);
const sol = (l) => (Number(l) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 });

const a = await acct(STATE);
if (!a) { console.error("state not found"); process.exit(1); }
console.log("state owner       :", a.owner, a.owner === MARINADE_PROGRAM ? "✓ Marinade" : "✗");
console.log("data length       :", a.data.length);
console.log("msol_mint @8      :", b58e(a.data.subarray(8, 40)), b58e(a.data.subarray(8, 40)) === MSOL_MINT ? "✓" : "✗");
const reserveBump = a.data[136];
console.log("reserve_bump @136 :", reserveBump);

const supply = BigInt((await rpc("getTokenSupply", [MSOL_MINT])).value.amount);
console.log("mSOL mint supply  :", supply, `(${sol(supply)} mSOL)`);

// Scan all u64 offsets; flag the ones matching known values.
console.log("\n--- u64 scan (offset : value : SOL) — flagged matches ---");
const priceLo = PRICE_DENOM, priceHi = PRICE_DENOM * 2n; // price in [1.0, 2.0)
const bigLamports = 1_000_000_000_000n; // > 1000 SOL
for (let o = 137; o + 8 <= a.data.length; o++) {
  const v = u64(a.data, o);
  const near = (x) => v > x - 1_000_000_000n && v < x + 1_000_000_000n;
  if (near(supply)) console.log(`  @${o}: ${v}  << ~msol_supply`);
  else if (v >= priceLo && v < priceHi) console.log(`  @${o}: ${v}  price? = ${(Number(v) / Number(PRICE_DENOM)).toFixed(6)} SOL/mSOL`);
  else if (v > bigLamports && v < 100_000_000_000_000_000n) console.log(`  @${o}: ${v}  = ${sol(v)} SOL   (balance candidate)`);
}

// Derive + read the reserve PDA (independent SOL).
const reservePda = cpa([b58d(STATE), Buffer.from("reserve"), Buffer.from([reserveBump])], MARINADE_PROGRAM);
const reserve = await acct(reservePda);
console.log("\nreserve PDA       :", reservePda);
console.log("reserve lamports  :", reserve ? `${reserve.lamports} (${sol(reserve.lamports)} SOL, owner ${reserve.owner})` : "unreadable");

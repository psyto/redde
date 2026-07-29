// Zero-dep offset probe. Reads a real SPL stake pool from mainnet and prints
// the fields Redde's INV-1/INV-2 depend on, so we can confirm byte offsets
// against known values before trusting verify.ts.
//
//   node probe.mjs [stakePoolPubkey]
//
// Default target: JitoSOL (largest Solana LST).

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const POOL = process.argv[2] || "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb";
const KNOWN_JITO_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

// base58 (b58encode/pk) + rpc now come from ../../core (were inline here).
import { solanaRpc } from "../../core/rpc.mjs";
import { b58encode, pk } from "../../core/solana.mjs";
const rpc = solanaRpc(RPC, { tries: 1 });

async function getAccount(pubkey) {
  const res = await rpc("getAccountInfo", [pubkey, { encoding: "base64" }]);
  if (!res || !res.value) return null;
  return {
    lamports: BigInt(res.value.lamports),
    data: Buffer.from(res.value.data[0], "base64"),
  };
}

const u64 = (buf, off) => buf.readBigUInt64LE(off);

const OFF = {
  validatorList: 98,
  reserveStake: 130,
  poolMint: 162,
  totalLamports: 258,
  poolTokenSupply: 266,
  lastUpdateEpoch: 274,
};

const acct = await getAccount(POOL);
if (!acct) { console.error("pool account not found:", POOL); process.exit(1); }

const d = acct.data;
console.log("\n=== stake pool", POOL, "===");
console.log("data length        :", d.length, "bytes");
console.log("account type byte   :", d[0]);
const poolMint = pk(d, OFF.poolMint);
console.log("poolMint     @162   :", poolMint);
console.log("  matches JitoSOL?  :", poolMint === KNOWN_JITO_MINT ? "YES ✓" : "NO ✗");
console.log("validatorList @98   :", pk(d, OFF.validatorList));
console.log("reserveStake @130   :", pk(d, OFF.reserveStake));
const totalLamports = u64(d, OFF.totalLamports);
const poolTokenSupply = u64(d, OFF.poolTokenSupply);
console.log("totalLamports @258  :", totalLamports, `(${Number(totalLamports) / 1e9} SOL)`);
console.log("poolTokenSupply@266 :", poolTokenSupply, `(${Number(poolTokenSupply) / 1e9} JitoSOL)`);
console.log("lastUpdateEpoch@274 :", u64(d, OFF.lastUpdateEpoch));
console.log("implied rate        :", Number(totalLamports) / Number(poolTokenSupply), "SOL/share");

// INV-1: compare mint on-chain supply to header pool_token_supply.
const supply = await rpc("getTokenSupply", [poolMint]);
const mintSupply = BigInt(supply.value.amount);
console.log("\n--- INV-1 share accounting ---");
console.log("mint.supply         :", mintSupply);
console.log("header.poolTokenSupp:", poolTokenSupply);
console.log("INV-1 holds?        :", mintSupply === poolTokenSupply ? "YES ✓ (GREEN)" : "NO ✗ (RED)");

// reserve lamports for context (INV-2 partial)
const reserve = await getAccount(pk(d, OFF.reserveStake));
console.log("\n--- INV-2 context ---");
console.log("reserve.lamports    :", reserve ? reserve.lamports : "unreadable");
const vlist = await getAccount(pk(d, OFF.validatorList));
console.log("validatorList len   :", vlist ? vlist.data.length : "unreadable", "bytes");
if (vlist) {
  const vd = vlist.data;
  const maxV = vd.readUInt32LE(1);
  const count = vd.readUInt32LE(5);
  const ITEM = 73;
  console.log("  max_validators @1 :", maxV);
  console.log("  vec len @5        :", count);
  console.log("  item size (maxV)  :", (vd.length - 9) / maxV, "bytes (expect 73)");

  let active = 0n, transient = 0n;
  const cursor = 9; // account_type(1) + max_validators(4) + vec_len(4)
  for (let i = 0; i < count; i++) {
    const base = cursor + i * ITEM;
    active += u64(vd, base);
    transient += u64(vd, base + 8);
  }
  const RENT_EXEMPT_STAKE = 2_282_880n;
  const controlled = reserve.lamports + active + transient;
  const eps = BigInt(count + 1) * RENT_EXEMPT_STAKE;
  console.log("\n--- INV-2 backing floor ---");
  console.log("Σ active            :", active, `(${Number(active) / 1e9} SOL)`);
  console.log("Σ transient         :", transient, `(${Number(transient) / 1e9} SOL)`);
  console.log("controlled=res+a+t  :", controlled, `(${Number(controlled) / 1e9} SOL)`);
  console.log("header.totalLamports:", totalLamports, `(${Number(totalLamports) / 1e9} SOL)`);
  console.log("ε_rent              :", eps, `(${Number(eps) / 1e9} SOL)`);
  const shortfall = totalLamports - controlled;
  console.log("claimed − controlled:", shortfall, `(${Number(shortfall) / 1e9} SOL)`);
  console.log("INV-2 holds?        :", controlled + eps >= totalLamports ? "YES ✓ (GREEN)" : "NO ✗ (RED)");
}
console.log("");

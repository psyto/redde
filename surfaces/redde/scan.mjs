// Slice 2 — audit every SPL stake pool on mainnet and write the board data.
//
//   SOLANA_RPC_URL=... node scan.mjs   ->   scan-results.json
//
// Stale-by-epoch pools are settled from the enumeration (cheap, reliable); only
// fresh pools get the full INV-1/2a/2b check. A better RPC than the default
// public endpoint is strongly recommended for the fresh set (getProgramAccounts).
import { check } from "./verify.mjs";
import { writeFileSync } from "node:fs";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const STAKE_POOL_PROGRAM = "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy";
const OFF = { poolMint: 162, totalLamports: 258, poolTokenSupply: 266, lastUpdateEpoch: 274 };
const CONCURRENCY = 4;

// base58 (b58) + rpc now come from ../../core (were inline here).
import { solanaRpc } from "../../core/rpc.mjs";
import { b58encode as b58, pk } from "../../core/solana.mjs";
const rpc = solanaRpc(RPC, { tries: 1 });
const u64 = (b, o) => b.readBigUInt64LE(o);
const sol = (lamports) => Number(lamports) / 1e9;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { epoch } = await rpc("getEpochInfo", [{ commitment: "finalized" }]);
const raw = await rpc("getProgramAccounts", [STAKE_POOL_PROGRAM, {
  encoding: "base64", commitment: "finalized",
  filters: [{ memcmp: { offset: 0, bytes: "2" } }],
}]);

const pools = raw.map((a) => {
  const d = Buffer.from(a.account.data[0], "base64");
  if (d.length < 282) return null;
  return { pool: a.pubkey, mint: pk(d, OFF.poolMint), totalSol: sol(u64(d, OFF.totalLamports)),
    supply: sol(u64(d, OFF.poolTokenSupply)), epoch: Number(u64(d, OFF.lastUpdateEpoch)) };
}).filter(Boolean).sort((a, b) => b.totalSol - a.totalSol);

const staleByEpoch = pools.filter((p) => p.epoch < epoch);
const fresh = pools.filter((p) => p.epoch >= epoch);
console.error(`epoch ${epoch}: ${pools.length} pools, ${fresh.length} fresh → full check, ${staleByEpoch.length} stale-by-epoch`);

const results = new Map();
for (const p of staleByEpoch) {
  results.set(p.pool, { ...p, status: "STALE-EPOCH", reason: `header epoch ${p.epoch} < ${epoch}`, lag: epoch - p.epoch });
}

let done = 0;
async function run(p) {
  let rep;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { rep = await check(p.pool, { currentEpoch: epoch }); }
    catch (e) { rep = { verdict: "STALE", notes: [`error: ${e.message}`] }; }
    // Retry once if the only obstacle was an RPC-side failure (rate limit),
    // so a transient throttle is not misread as a genuine finding.
    if (rep.verdict !== "STALE" || !/unavailable|error:/.test(rep.notes?.[0] ?? "")) break;
    await sleep(600);
  }
  // A fresh pool we could not finish verifying is UNVERIFIED, not a finding.
  const status = rep.verdict === "STALE" ? "UNVERIFIED" : rep.verdict;
  const r = { ...p, status, reason: rep.notes?.[0] ?? "" };
  if (rep.inv1) { r.supplyDrift = rep.inv1.supplyDelta; if (!rep.inv1.ok) r.inv1Fail = true; }
  if (rep.inv2b?.available) {
    r.redeemableSol = rep.inv2b.redeemableBacking ? sol(BigInt(rep.inv2b.redeemableBacking)) : null;
    r.claimedSol = sol(BigInt(rep.inv2b.claimedTotal));
    r.usablePdas = rep.inv2b.usablePdas; r.unusablePdas = rep.inv2b.unusablePdas;
    r.marginSol = r.redeemableSol != null ? r.redeemableSol - r.claimedSol : null;
  }
  results.set(p.pool, r);
  console.error(`[${++done}/${fresh.length}] ${status.padEnd(11)} ${p.totalSol.toFixed(0).padStart(10)} SOL  ${p.pool}`);
}

// bounded concurrency
const queue = [...fresh];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) { await run(queue.shift()); await sleep(120); }
}));

const board = pools.map((p) => results.get(p.pool)).filter(Boolean);
const by = (s) => board.filter((r) => r.status === s);
const summary = {
  epoch, pools: board.length,
  green: by("GREEN").length, red: by("RED").length,
  staleEpoch: by("STALE-EPOCH").length, unverified: by("UNVERIFIED").length,
  totalSolObserved: board.reduce((s, r) => s + r.totalSol, 0),
  totalSolFullyVerified: board.filter((r) => r.status === "GREEN" || r.status === "RED").reduce((s, r) => s + r.totalSol, 0),
};
writeFileSync(new URL("./scan-results.json", import.meta.url), JSON.stringify({ summary, board }, null, 2));
console.error(`\nGREEN ${summary.green}  RED ${summary.red}  STALE-EPOCH ${summary.staleEpoch}  UNVERIFIED ${summary.unverified}  (of ${board.length})`);
console.error(`fully verified: ${summary.totalSolFullyVerified.toLocaleString("en-US",{maximumFractionDigits:0})} SOL of ${summary.totalSolObserved.toLocaleString("en-US",{maximumFractionDigits:0})} observed`);
console.error(`wrote scan-results.json`);

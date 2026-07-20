// Slice 2 scouting: enumerate every SPL stake pool on mainnet so we know the
// size of the board Redde will audit. Lists StakePool accounts (type byte 1),
// decodes each pool's claimed total / supply / last-update epoch, and flags any
// that are already STALE (header epoch behind the current epoch).
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const STAKE_POOL_PROGRAM = "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy";
const OFF = { poolMint: 162, totalLamports: 258, poolTokenSupply: 266, lastUpdateEpoch: 274 };

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) {
  const bytes = [...buf]; let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const enc = []; let start = zeros;
  while (start < bytes.length) {
    let rem = 0;
    for (let i = start; i < bytes.length; i++) { const acc = (rem << 8) + bytes[i]; bytes[i] = (acc / 58) | 0; rem = acc % 58; }
    enc.push(B58[rem]); if (bytes[start] === 0) start++;
  }
  return "1".repeat(zeros) + enc.reverse().join("");
}
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
}
const u64 = (b, o) => b.readBigUInt64LE(o);
const pk = (b, o) => b58(b.subarray(o, o + 32));

const { epoch } = await rpc("getEpochInfo", [{ commitment: "finalized" }]);
const accts = await rpc("getProgramAccounts", [STAKE_POOL_PROGRAM, {
  encoding: "base64", commitment: "finalized",
  filters: [{ memcmp: { offset: 0, bytes: "2" } }], // AccountType::StakePool == 1 (base58 "2")
}]);

const pools = accts.map((a) => {
  const d = Buffer.from(a.account.data[0], "base64");
  if (d.length < 282) return null;
  return {
    pool: a.pubkey, mint: pk(d, OFF.poolMint),
    totalSol: Number(u64(d, OFF.totalLamports)) / 1e9,
    supply: Number(u64(d, OFF.poolTokenSupply)) / 1e9,
    epoch: Number(u64(d, OFF.lastUpdateEpoch)),
  };
}).filter(Boolean).sort((a, b) => b.totalSol - a.totalSol);

const stale = pools.filter((p) => p.epoch < epoch);
console.log(`\ncurrent epoch: ${epoch}`);
console.log(`SPL stake pools found: ${pools.length}`);
console.log(`already STALE (header epoch < current): ${stale.length}\n`);
console.log("rank  total SOL        epoch  pool");
pools.slice(0, 25).forEach((p, i) => {
  const flag = p.epoch < epoch ? " STALE" : "";
  console.log(`${String(i + 1).padStart(3)}  ${p.totalSol.toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(14)}  ${String(p.epoch).padStart(5)}  ${p.pool}${flag}`);
});
if (stale.length) {
  console.log(`\n--- STALE pools (${stale.length}) ---`);
  stale.slice(0, 20).forEach((p) => console.log(`  epoch ${p.epoch}  ${p.totalSol.toFixed(1).padStart(12)} SOL  ${p.pool}`));
}

/**
 * Discover all Meteora DLMM LbPairs containing the LIBRA mint, to resolve the
 * LIBRA/SOL pool (the USDC pool is already pinned). getProgramAccounts is
 * compute-heavy and throttled on a free tier — this retries with long backoff and
 * writes the result. Background-friendly.
 *
 *   SOLANA_RPC_URL=... node find-sol-pool.mjs
 *   → data/libra-pools.json
 */
import { writeFileSync } from "node:fs";
const RPC = process.env.SOLANA_RPC_URL;
const DLMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const LIBRA = "Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (b) => { let n = 0n; for (const x of b) n = n * 256n + BigInt(x); let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } let z = 0; for (const x of b) { if (x === 0) z++; else break; } return "1".repeat(z) + s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params, tries = 20) {
  let d = 1500;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.status === 429 || r.status === 403 || r.status >= 500) { await sleep(d); d = Math.min(d * 1.6, 45000); continue; }
      const j = await r.json();
      if (j.error) { await sleep(d); d = Math.min(d * 1.6, 45000); continue; }
      return j.result;
    } catch { await sleep(d); d = Math.min(d * 1.6, 45000); }
  }
  return null;
}
const pools = [];
for (const off of [88, 120]) {
  const res = await rpc("getProgramAccounts", [DLMM, { encoding: "base64", dataSlice: { offset: 88, length: 64 }, filters: [{ memcmp: { offset: off, bytes: LIBRA } }] }]);
  if (!res) { console.log(`offset ${off}: FAILED`); continue; }
  for (const a of res) {
    const raw = Buffer.from(a.account.data[0], "base64");
    const x = b58(raw.subarray(0, 32)), y = b58(raw.subarray(32, 64));
    const other = off === 88 ? y : x;
    const kind = other === WSOL ? "SOL" : other === USDC ? "USDC" : "OTHER";
    pools.push({ pool: a.pubkey, tokenX: x, tokenY: y, other, kind });
    console.log(`  ${a.pubkey}  ${kind}  other=${other}`);
  }
  await sleep(2000);
}
writeFileSync(new URL("./data/libra-pools.json", import.meta.url), JSON.stringify(pools, null, 2));
console.log(`DONE — ${pools.length} LIBRA pools; SOL pool: ${pools.find((p) => p.kind === "SOL")?.pool || "not found"}`);

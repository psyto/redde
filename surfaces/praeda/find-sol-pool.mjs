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
import { makeCrawlRpc } from "../../core/rpc.mjs";
import { b58encode as b58 } from "../../core/solana.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// crawler rpc (aggressive backoff, null on exhaustion) now comes from ../../core.
const rpc = makeCrawlRpc(RPC, { tries: 20, baseDelayMs: 1500, factor: 1.6, maxDelayMs: 45000 });
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

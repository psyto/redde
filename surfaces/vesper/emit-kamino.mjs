// Vesper — emit the Kamino SPYx price-GUARD claim (#3, GREEN side) from chain.
// Decodes the reserve tokenInfo guards (self-validated by name@5032=="SPYx") + the Scope price/twap, and
// writes a re-executable claim. Pairs with the Jupiter CMLS RED claim for the on-chain money-shot.
//   RPC=<url> node emit-kamino.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { solanaRpc } from '../../core/rpc.mjs';
import { pk } from '../../core/solana.mjs';
import { buildPriceGuardClaim } from './claim.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const rpc = solanaRpc(RPC);
const RESERVE = 'UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d';
const O = { name: 5032, hLower: 5064, hUpper: 5072, hExp: 5080, twapBps: 5088, maxAgePx: 5096, maxAgeTwap: 5104, scopeFeed: 5112, priceIdx: 5144, twapIdx: 5152 };
const u64 = (b, o) => Number(b.readBigUInt64LE(o)), u16 = (b, o) => b.readUInt16LE(o);
async function data(a) { const r = await rpc('getAccountInfo', [a, { encoding: 'base64' }]); if (!r?.value) throw new Error(`account ${a} not found`); return Buffer.from(r.value.data[0], 'base64'); }
const entry = (sc, i) => { const o = 96 + 56 * i; return { i, price: u64(sc, o) / 10 ** u64(sc, o + 8), ts: u64(sc, o + 24) }; };

const reserve = await data(RESERVE);
const name = reserve.subarray(O.name, O.name + 32).toString('utf8').replace(/\0+$/, '');
if (name !== 'SPYx') { console.error(`self-validation FAILED: name@${O.name}=${JSON.stringify(name)} (expected "SPYx")`); process.exit(1); }

const hExp = u64(reserve, O.hExp);
const guards = {
  heuristicLo: +(u64(reserve, O.hLower) / 10 ** hExp).toFixed(2),
  heuristicHi: +(u64(reserve, O.hUpper) / 10 ** hExp).toFixed(2),
  maxTwapDivPct: u64(reserve, O.twapBps) / 100,
  maxAgePriceS: u64(reserve, O.maxAgePx),
  maxAgeTwapS: u64(reserve, O.maxAgeTwap),
};
const scopePk = pk(reserve, O.scopeFeed);
const priceIndex = u16(reserve, O.priceIdx), twapIndex = u16(reserve, O.twapIdx);
const scope = await data(scopePk);
const price = entry(scope, priceIndex), twap = entry(scope, twapIndex);
let close = null;
for (let i = 0; 96 + 56 * i + 32 <= scope.length; i++) { const e = entry(scope, i); if (Math.abs(e.price - price.price) / price.price > 0.04) continue; const d = new Date(e.ts * 1000); if (d.getUTCHours() === 20 && d.getUTCMinutes() < 5 && (Math.floor(Date.now() / 1000) - e.ts) > 3600 && (!close || e.ts > close.ts)) close = e; }

const values = {
  price: +price.price.toFixed(4), twap: +twap.price.toFixed(4),
  lastClose: close ? +close.price.toFixed(4) : null,
  priceVsClosePct: close ? +(((price.price - close.price) / close.price) * 100).toFixed(2) : null,
  priceVsTwapPct: +((Math.abs(price.price - twap.price) / twap.price) * 100).toFixed(2),
};
const subject = { venue: 'Kamino', asset: 'SPYx', chain: 'solana', role: 'collateral', reserve: RESERVE, scopeOracle: scopePk };
const accounts = { reserve: RESERVE, scopeOracle: scopePk, priceIndex, twapIndex };
const window = { observed_ts: price.ts };

const claim = buildPriceGuardClaim({ subject, accounts, guards, values, window });
mkdirSync(new URL('./claims/', import.meta.url), { recursive: true });
writeFileSync(new URL('./claims/kamino-spyx-guard.json', import.meta.url), JSON.stringify(claim, null, 2) + '\n');
const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴' };
console.log(`\nVesper — emitting price-GUARD claim · Kamino SPYx  (name@5032="SPYx" ✓)`);
console.log(`  ${emoji[claim.verdict.flag]} ${claim.verdict.flag}  bounded: heuristic $${guards.heuristicLo}-$${guards.heuristicHi} · ≤${guards.maxTwapDivPct}% twap-div · ≤${guards.maxAgePriceS}s`);
console.log(`  price $${values.price} · ${values.priceVsClosePct}% from last close · ${values.priceVsTwapPct}% from twap`);
console.log(`  claim_id: ${claim.claim_id}`);
console.log(`  written:  claims/kamino-spyx-guard.json`);
console.log(`\n  reproduce (anyone): node verify.mjs claims/kamino-spyx-guard.json   ·   re-decode: node scope-price.mjs\n`);

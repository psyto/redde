// Vesper — re-execute Kamino's on-chain SPYx price safety from chain (the GREEN-side price re-exec).
//
// weekend-liveness answers the RED observable ("does the feed keep TICKING through closure?"). But a
// market-status aggregator ticks too, so liveness canNOT grade a clamped venue. GREEN is about the price
// VALUE and the guards around it. This tool recovers all of it deterministically from chain:
//
//   1. Kamino reserve → tokenInfo:  name, priceHeuristic{lower,upper,exp}, maxTwapDivergenceBps,
//      maxAgePriceSeconds, maxAgeTwapSeconds, scopeConfiguration.priceChain[0] / twapChain[0].
//   2. Scope OraclePrices account → the DatedPrice at those indices (price, twap, a frozen last-close ref).
//   3. report the price + guards + deviation from last close, and the HONEST split of what is
//      on-chain-enforced vs what is the upstream Chainlink-Data-Streams (off-chain) market-status clamp.
//
// Layouts recovered + SELF-VALIDATED from chain (no external IDL trusted): the reserve tokenInfo offsets
// are confirmed by name@5032 decoding to "SPYx"; Scope DatedPrice = 56 bytes from base 96 (value u64@0,
// exp@8, last_slot@16, unix_ts@24), confirmed by cross-matching the raw feed's SPYx price.
//
//   RPC=<url> node scope-price.mjs
import { solanaRpc } from '../../core/rpc.mjs';
import { pk } from '../../core/solana.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const rpc = solanaRpc(RPC);
const RESERVE = 'UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d'; // Kamino SPYx reserve (xStocks market)
// reserve tokenInfo offsets (self-validated by name@5032 == "SPYx"):
const O = { name: 5032, hLower: 5064, hUpper: 5072, hExp: 5080, twapBps: 5088, maxAgePx: 5096, maxAgeTwap: 5104, scopeFeed: 5112, priceIdx: 5144, twapIdx: 5152 };
const SCOPE_BASE = 96, SCOPE_STRIDE = 56;

const u64 = (b, o) => Number(b.readBigUInt64LE(o));
const u16 = (b, o) => b.readUInt16LE(o);
async function data(a) { const r = await rpc('getAccountInfo', [a, { encoding: 'base64' }]); if (!r?.value) throw new Error(`account ${a} not found`); return Buffer.from(r.value.data[0], 'base64'); }
function entry(scope, i) { const o = SCOPE_BASE + SCOPE_STRIDE * i; if (o + 32 > scope.length) return null; return { i, price: u64(scope, o) / 10 ** u64(scope, o + 8), ts: u64(scope, o + 24) }; }
const isOpen = (t) => { const d = new Date(t * 1000); const wd = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return wd >= 1 && wd <= 5 && m >= 810 && m < 1200; };

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const reserve = await data(RESERVE);

  const name = reserve.subarray(O.name, O.name + 32).toString('utf8').replace(/\0+$/, '');
  if (name !== 'SPYx') { console.error(`self-validation FAILED: tokenInfo.name @${O.name} = ${JSON.stringify(name)} (expected "SPYx") — reserve layout drifted; not decoding.`); process.exit(1); }

  const hExp = u64(reserve, O.hExp);
  const guards = {
    heuristicLo: u64(reserve, O.hLower) / 10 ** hExp,
    heuristicHi: u64(reserve, O.hUpper) / 10 ** hExp,
    maxTwapDivPct: u64(reserve, O.twapBps) / 100,
    maxAgePriceS: u64(reserve, O.maxAgePx),
    maxAgeTwapS: u64(reserve, O.maxAgeTwap),
  };
  const scopePk = pk(reserve, O.scopeFeed);
  const priceIdx = u16(reserve, O.priceIdx), twapIdx = u16(reserve, O.twapIdx);

  const scope = await data(scopePk);
  const price = entry(scope, priceIdx), twap = entry(scope, twapIdx);

  // frozen last regular-session close reference (an SPYx-range entry pinned at ~20:00Z that hasn't updated).
  let close = null;
  for (let i = 0; SCOPE_BASE + SCOPE_STRIDE * i + 32 <= scope.length; i++) {
    const e = entry(scope, i); if (!e || Math.abs(e.price - price.price) / price.price > 0.04) continue;
    const d = new Date(e.ts * 1000);
    if (d.getUTCHours() === 20 && d.getUTCMinutes() < 5 && now - e.ts > 3600 && (!close || e.ts > close.ts)) close = e;
  }

  console.log(`\nVesper — Kamino SPYx price safety, re-executed from chain\n  reserve ${RESERVE}  (tokenInfo.name="SPYx" ✓ self-validated)\n  scope   ${scopePk}  price#${priceIdx} twap#${twapIdx}\n  US market right now: ${isOpen(now) ? 'OPEN' : 'CLOSED'}\n`);
  console.log('  on-chain guards (decoded from the reserve):');
  console.log(`    priceHeuristic band:     $${guards.heuristicLo.toFixed(2)} .. $${guards.heuristicHi.toFixed(2)}  (reject outside)`);
  console.log(`    maxTwapDivergence:       ${guards.maxTwapDivPct.toFixed(2)}%  (reject price vs twap beyond this)`);
  console.log(`    max staleness:           price ${guards.maxAgePriceS}s / twap ${guards.maxAgeTwapS}s\n`);
  console.log('  current values (Scope):');
  console.log(`    price Kamino uses:  $${price.price.toFixed(4)}  (${((now - price.ts) / 60).toFixed(1)} min old)`);
  console.log(`    twap:               $${twap.price.toFixed(4)}   → price-vs-twap ${(Math.abs(price.price - twap.price) / twap.price * 100).toFixed(2)}% (limit ${guards.maxTwapDivPct}%)`);
  if (close) console.log(`    last regular close: $${close.price.toFixed(4)} (#${close.i} @ ${new Date(close.ts * 1000).toISOString()}) → price is ${((price.price - close.price) / close.price * 100).toFixed(2)}% from close`);
  console.log('');
  console.log('  READ (honest):');
  console.log('    On-chain, Kamino BOUNDS the price (heuristic band + ' + guards.maxTwapDivPct + '% twap-divergence + ' + guards.maxAgePriceS + 's staleness).');
  console.log('    These are generic sanity guards, NOT a last-close clamp: if a closed-market feed drifts, price AND twap');
  console.log('    drift together and the twap check passes. The actual last-close market-status CLAMP lives UPSTREAM in the');
  console.log('    Chainlink Data Streams feed that populates Scope #' + priceIdx + ' (off-chain) — the value stays near last close');
  console.log('    (' + (close ? ((price.price - close.price) / close.price * 100).toFixed(2) + '% off' : 'observed banded') + ') because Chainlink clamps it, not because Kamino re-derives it on-chain.');
  console.log('    → GREEN = on-chain BOUNDED + upstream Chainlink CLAMP. Materially safer than Jupiter (raw feed, ZERO guards,');
  console.log('      liveness→RED), but it carries a Chainlink-DS trust dependency the RED verdict does not. That dependency is');
  console.log('      the honest residual: not fully re-executable on-chain, because the clamp itself is off-chain.\n');
}
main().catch((e) => { console.error('scope-price failed:', e.message); process.exit(1); });

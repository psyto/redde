// Vesper — read the EXACT price Kamino liquidates SPYx against, from chain (the GREEN-side price re-exec).
//
// weekend-liveness answers "does the feed keep TICKING through closure?" (the RED observable). But a
// market-status aggregator (Scope) ticks too, so liveness canNOT grade a clamped venue. The GREEN
// question is about the price VALUE: what price does the venue actually use, and does it stay banded to
// last close? This tool recovers that value deterministically:
//
//   1. Kamino reserve → scopeConfiguration.priceChain[0]  (the Scope index it reads for SPYx)
//   2. Scope OraclePrices account → the DatedPrice at that index  (value, exp, update time)
//   3. report the value + freshness + deviation from the last regular-session close reference
//
// Scope layout recovered empirically from chain (self-validated): OraclePrices entries are DatedPrice
// structs of 56 bytes from base 96 — value u64@+0, exp u64@+8, last_slot u64@+16, unix_ts u64@+24.
//
//   RPC=<url> node scope-price.mjs
import { solanaRpc } from '../../core/rpc.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const rpc = solanaRpc(RPC);
const RESERVE = 'UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d'; // Kamino SPYx reserve (xStocks market)
const SCOPE_AT = 5112;   // offset of the scope oracle pubkey in the reserve (recovered by kamino-reserve.mjs)
const SCOPE_BASE = 96, SCOPE_STRIDE = 56; // DatedPrice array layout, recovered + validated from chain

const u64 = (b, o) => Number(b.readBigUInt64LE(o));
const u16 = (b, o) => b.readUInt16LE(o);
async function data(pk) {
  const r = await rpc('getAccountInfo', [pk, { encoding: 'base64' }]);
  if (!r?.value) throw new Error(`account ${pk} not found`);
  return Buffer.from(r.value.data[0], 'base64');
}
function entry(scope, i) {
  const o = SCOPE_BASE + SCOPE_STRIDE * i;
  if (o + 32 > scope.length) return null;
  const value = u64(scope, o), exp = u64(scope, o + 8), ts = u64(scope, o + 24);
  return { i, price: value / 10 ** exp, exp, ts };
}
const isOpen = (t) => { const d = new Date(t * 1000); const wd = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return wd >= 1 && wd <= 5 && m >= 810 && m < 1200; };

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const reserve = await data(RESERVE);
  const scopePk = (await import('../../core/solana.mjs')).pk(reserve, SCOPE_AT);
  // scopeConfiguration = priceFeed Pubkey(32) then priceChain [u16;4]; index[0] is the SPYx price feed.
  const priceIndex = u16(reserve, SCOPE_AT + 32);
  const twapIndex = u16(reserve, SCOPE_AT + 40);

  const scope = await data(scopePk);
  const px = entry(scope, priceIndex);
  if (!px) throw new Error(`scope index ${priceIndex} out of range`);

  console.log(`\nVesper — Kamino SPYx liquidation price (re-executed from chain)\n  reserve ${RESERVE}\n  scope   ${scopePk}  (index ${priceIndex}${twapIndex !== 65535 ? `, twap ${twapIndex}` : ''})\n  RPC     ${RPC}\n`);
  console.log(`  price Kamino uses:  $${px.price.toFixed(4)}   (updated ${new Date(px.ts * 1000).toISOString()}, ${((now - px.ts) / 60).toFixed(1)} min ago)`);
  console.log(`  US market right now: ${isOpen(now) ? 'OPEN' : 'CLOSED'}\n`);

  // Find a frozen last-regular-close reference among the SPYx-range entries: an entry whose timestamp is a
  // recent market-close (≈20:00 UTC) and that has NOT updated since = the last official close.
  const band = 0.04; // scan window around Kamino's price to stay on SPYx-range entries
  let lastClose = null;
  for (let i = 0; SCOPE_BASE + SCOPE_STRIDE * i + 32 <= scope.length; i++) {
    const e = entry(scope, i); if (!e) continue;
    if (Math.abs(e.price - px.price) / px.price > band) continue; // same asset range
    const d = new Date(e.ts * 1000);
    const atClose = d.getUTCHours() === 20 && d.getUTCMinutes() < 5; // ~16:00 ET regular close
    const frozen = now - e.ts > 3600; // hasn't updated in >1h → a pinned snapshot
    if (atClose && frozen && (!lastClose || e.ts > lastClose.ts)) lastClose = e;
  }
  if (lastClose) {
    const dev = ((px.price - lastClose.price) / lastClose.price) * 100;
    console.log(`  last regular-session close (frozen ref #${lastClose.i}): $${lastClose.price.toFixed(4)} @ ${new Date(lastClose.ts * 1000).toISOString()}`);
    console.log(`  Kamino price deviates ${dev >= 0 ? '+' : ''}${dev.toFixed(2)}% from last close.\n`);
    console.log(`  Read: Kamino prices SPYx off a Scope market-status feed that ${isOpen(now) ? 'is in session' : 'stays within a %-band of the last close while the market is CLOSED'} — the`);
    console.log(`  opposite of Jupiter's raw 24/7 feed (weekend-liveness → RED). GREEN's final rigor = the reserve's`);
    console.log(`  exact band %-tolerance (whether this deviation is inside the accepted clamp).\n`);
  } else {
    console.log(`  (no frozen last-close reference found in range — re-run during/after a closed session, or widen the scan.)\n`);
  }
}
main().catch((e) => { console.error('scope-price failed:', e.message); process.exit(1); });

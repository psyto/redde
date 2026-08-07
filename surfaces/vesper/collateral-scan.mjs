// Vesper — closed-market collateral scan: which venues list a closed-market asset, and is the
// listing actually LIVE?
//
// Why this exists. `probe-issuer.mjs` asks the question from the asset's side (mint →
// getTokenLargestAccounts → whose program holds it). That call is blocked on public RPC, and it
// only sees an asset once someone already holds it in bulk. This asks the same question from the
// VENUE's side — enumerate the lender's own reserves and read what each one is configured to
// price — so a listing is visible from the moment it is created, before any capital arrives.
//
// That gap matters, because a new closed-market collateral passes through a state the GREEN /
// YELLOW / RED model has no name for:
//
//   ⚪ NOT-LIVE — the reserve exists and carries risk params, but the vault holds dust and the
//                price wiring is still a placeholder. Nothing can be liquidated because nothing
//                is deposited. Grading it 🔴 would be dishonest; ignoring it forfeits the only
//                position that cannot be bought later — standing on the record before the money
//                arrives.
//
// So this tool reports the listing, its guards, and the exact condition under which ⚪ becomes a
// verdict: *when deposits exceed dust, is the guard set that the live venues set?*
//
// Method (Kamino Lend; zero-dep, public-RPC-safe):
//   1. getProgramAccounts(KLend, dataSize 8624) with a dataSlice → (lendingMarket@32, mint@128)
//      for every reserve, cheaply. Group by market.
//   2. for a chosen market, re-fetch its reserves in full and decode tokenInfo — name@5032
//      SELF-VALIDATES the layout (a reserve whose name is not a plausible ticker is not decoded).
//   3. read each reserve's supplyVault balance → LIVE vs ⚪ NOT-LIVE.
//
// Honest residual: step 1's "is this a closed-market asset" pass is a mint-prefix heuristic
// (Backed xStocks are vanity-prefixed `Xs`; Backpack Securities issues `SPCX`/`MU`/`SKHY`…), and a
// heuristic can miss. It is only used to SUGGEST which market to open. The claim a verdict rests
// on is step 2's decoded `tokenInfo.name`, which is read from the reserve itself.
//
// Usage:
//   RPC=<url> node collateral-scan.mjs                 # enumerate every market, flag candidates
//   RPC=<url> node collateral-scan.mjs <lendingMarket> # decode one market's reserves in full

import { solanaRpc } from '../../core/rpc.mjs';
import { pk } from '../../core/solana.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const RESERVE_SIZE = 8624;

// Reserve layout (anchor), byte offsets — the ones already used by kamino-reserve.mjs and
// scope-price.mjs. tokenInfo offsets are self-validated below by name@5032 decoding to a ticker.
const O = {
  market: 32, mint: 128, supplyVault: 160,
  name: 5032, hLower: 5064, hUpper: 5072, hExp: 5080,
  twapBps: 5088, maxAgePx: 5096, maxAgeTwap: 5104, scopeFeed: 5112, priceIdx: 5144, twapIdx: 5152,
};

// A reserve seeded at creation holds a token or less. Declared, not derived — say so in output.
const DUST = 1;

// Mint-prefix heuristic for "this looks like a tokenized equity" (step 1 only, never a verdict).
const EQUITY_PREFIX = /^(Xs|SPCX|MU|SKHY)/;

const rpc = solanaRpc(RPC);
const u64 = (b, o) => Number(b.readBigUInt64LE(o));
const u16 = (b, o) => b.readUInt16LE(o);

async function enumerateReserves() {
  const res = await rpc('getProgramAccounts', [KLEND, {
    encoding: 'base64',
    filters: [{ dataSize: RESERVE_SIZE }],
    dataSlice: { offset: O.market, length: O.mint - O.market + 32 }, // market … mint
  }]);
  return res.map((r) => {
    const buf = Buffer.from(r.account.data[0], 'base64');
    return { reserve: r.pubkey, market: pk(buf, 0), mint: pk(buf, O.mint - O.market) };
  });
}

async function decodeMarket(market) {
  const accts = await rpc('getProgramAccounts', [KLEND, {
    encoding: 'base64',
    filters: [{ dataSize: RESERVE_SIZE }, { memcmp: { offset: O.market, bytes: market } }],
  }]);
  const out = [];
  for (const a of accts) {
    const buf = Buffer.from(a.account.data[0], 'base64');
    const name = buf.subarray(O.name, O.name + 32).toString('utf8').replace(/\0+$/, '');
    if (!/^[A-Za-z0-9.]{1,10}$/.test(name)) {
      out.push({ reserve: a.pubkey, name: null, note: 'layout drifted — not decoded' });
      continue;
    }
    const hExp = u64(buf, O.hExp);
    const supplyVault = pk(buf, O.supplyVault);
    let deposited = null;
    try { deposited = Number((await rpc('getTokenAccountBalance', [supplyVault])).value.uiAmountString); } catch {}
    out.push({
      reserve: a.pubkey, name, mint: pk(buf, O.mint), supplyVault, deposited,
      stale: buf.readUInt8(24),
      bandLo: u64(buf, O.hLower) / 10 ** hExp,
      bandHi: u64(buf, O.hUpper) / 10 ** hExp,
      twapDivPct: u64(buf, O.twapBps) / 100,
      maxAgePx: u64(buf, O.maxAgePx),
      maxAgeTwap: u64(buf, O.maxAgeTwap),
      scopeFeed: pk(buf, O.scopeFeed),
      priceIdx: u16(buf, O.priceIdx),
      twapIdx: u16(buf, O.twapIdx),
    });
  }
  return out.sort((x, y) => (x.name || '').localeCompare(y.name || ''));
}

function classify(r) {
  if (r.name === null) return { mark: '  ', label: 'UNDECODED' };
  if (r.deposited === null) return { mark: '  ', label: 'vault unreadable' };
  if (r.deposited <= DUST) return { mark: '⚪', label: `NOT-LIVE (deposited ${r.deposited} ≤ dust ${DUST})` };
  return { mark: '  ', label: `LIVE (deposited ${r.deposited})` };
}

// The guards that, together, are what makes a live tokenized-equity reserve gap-safe here.
function guardGaps(r) {
  const gaps = [];
  if (!(r.bandLo > 0 && r.bandHi > r.bandLo)) gaps.push('price band UNSET');
  if (!(r.twapDivPct > 0)) gaps.push('twap-divergence UNSET');
  if (!(r.maxAgePx > 0)) gaps.push('max price age UNSET');
  if (r.priceIdx === r.twapIdx) gaps.push(`price and twap read the SAME scope index (${r.priceIdx})`);
  return gaps;
}

async function main() {
  const market = process.argv[2];
  console.log(`\nVesper — closed-market collateral scan\n  KLend: ${KLEND}\n  RPC:   ${RPC}\n`);

  if (!market) {
    const all = await enumerateReserves();
    const byMarket = {};
    for (const r of all) (byMarket[r.market] ||= []).push(r);
    console.log(`  ${all.length} reserves across ${Object.keys(byMarket).length} lending markets\n`);
    console.log(`  markets holding a mint that looks like a tokenized equity`);
    console.log(`  (mint-prefix heuristic — a suggestion of where to look, never a verdict):\n`);
    let found = 0;
    for (const [m, list] of Object.entries(byMarket)) {
      const eq = list.filter((r) => EQUITY_PREFIX.test(r.mint));
      if (!eq.length) continue;
      found++;
      console.log(`   market ${m}  —  ${eq.length}/${list.length} candidate reserves`);
      for (const r of eq) console.log(`      ${r.mint}   reserve ${r.reserve}`);
      console.log(`      → decode it:  RPC=$RPC node collateral-scan.mjs ${m}\n`);
    }
    if (!found) console.log(`   (none)\n`);
    return;
  }

  const rows = await decodeMarket(market);
  console.log(`  market ${market} — ${rows.length} reserves\n`);
  for (const r of rows) {
    const c = classify(r);
    console.log(`  ${c.mark} ${(r.name || '??').padEnd(6)} ${c.label}`);
    if (r.name === null) { console.log(`         reserve ${r.reserve}\n`); continue; }
    console.log(`         reserve ${r.reserve}`);
    console.log(`         mint    ${r.mint}`);
    console.log(`         vault   ${r.supplyVault}`);
    console.log(`         guards  band $${r.bandLo}–$${r.bandHi} · twapDiv ${r.twapDivPct}% · maxAgePx ${r.maxAgePx}s · maxAgeTwap ${r.maxAgeTwap}s`);
    console.log(`         scope   ${r.scopeFeed}  priceChain[0]=${r.priceIdx} twapChain[0]=${r.twapIdx} · lastUpdate.stale=${r.stale}`);
    const gaps = guardGaps(r);
    if (gaps.length) console.log(`         ⚠️  ${gaps.join(' · ')}`);
    console.log('');
  }

  // The point of the ⚪ class: name the condition that turns it into a verdict.
  const notLive = rows.filter((r) => r.name && r.deposited !== null && r.deposited <= DUST && guardGaps(r).length);
  if (notLive.length) {
    console.log(`  ⚪ NOT-LIVE with missing guards: ${notLive.map((r) => r.name).join(', ')}`);
    console.log(`     No verdict is issued: nothing is deposited, so nothing can be liquidated.`);
    console.log(`     Falsifiable trigger — re-run this command. If a reserve above crosses dust`);
    console.log(`     while its guards are still missing, it is live one guard short of the`);
    console.log(`     configuration the graded venues run, and it becomes a CMLS verdict.\n`);
  }
}

main().catch((e) => { console.error('collateral-scan failed:', e.message); process.exit(1); });

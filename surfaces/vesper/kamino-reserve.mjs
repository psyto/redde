// Vesper — locate & read Kamino's SPYx reserve from chain (the GREEN-side re-exec).
// Goal: upgrade Kamino from primary-source 🟢 toward onchain-airtight by confirming, from
// reserve state, (a) the collateral listing is live, (b) which oracle it prices SPYx from
// (Chainlink Data Streams / Scope, market-status-aware — distinct from Jupiter's raw pushed
// feed), and (c) the risk params (LTV / liq threshold). The band clamp itself is program logic;
// this establishes the wiring around it.
//
//   RPC=<url> node kamino-reserve.mjs
//
// Kamino Reserve layout (anchor), byte offsets:
//   0   discriminator (8)
//   8   version u64 (8)
//   16  lastUpdate { slot u64, stale u8, priceStatus u8, _pad[6] } (16)
//   32  lendingMarket Pubkey (32)
//   64  farmCollateral Pubkey (32)
//   96  farmDebt Pubkey (32)
//   128 liquidity.mintPubkey Pubkey (32)   ← memcmp filter target
//   ... liquidity struct continues (supply vault, fee vault, decimals, oracle-derived px, ...)

import { solanaRpc } from '../../core/rpc.mjs';
import { b58encode, b58decode, pk } from '../../core/solana.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const SPYX_MINT = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W';
const MINT_OFFSET = 128;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// rpc + base58 (b58encode/b58decode/pk) now come from ../../core (were inline here).
const rpc = solanaRpc(RPC);

// Known on-chain accounts to flag inside the reserve config (oracle identity = the crux of GREEN).
const KNOWN = {
  '3NJYftD5sjVfxSnUdZ1wtV4nCkNKGyD5FCsCvGmidvj9': 'Kamino Scope prices (market-status-aware aggregator)',
  A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff: 'Jupiter SPYx source_type=7 pushed price (the RED feed)',
};

// scan for any 32-byte window equal to a known account
function findKnown(buf) {
  const hits = [];
  for (const [addr, label] of Object.entries(KNOWN)) {
    const needle = b58decode(addr);
    let idx = buf.indexOf(needle);
    while (idx !== -1) { hits.push({ addr, label, offset: idx }); idx = buf.indexOf(needle, idx + 1); }
  }
  return hits;
}

// enumerate distinct pubkey candidates in a region (non-zero 32-byte windows, 8-byte aligned)
function candidates(buf, start, end) {
  const seen = new Set(); const out = [];
  for (let o = start; o + 32 <= end; o += 8) {
    const w = buf.subarray(o, o + 32);
    let nz = 0; for (const b of w) if (b) nz++;
    if (nz < 20) continue; // skip mostly-zero (not a pubkey)
    const s = b58encode(w);
    if (s.length < 32 || s.length > 44 || seen.has(s)) continue;
    seen.add(s); out.push({ offset: o, addr: s });
  }
  return out;
}

async function main() {
  console.log(`\nVesper — Kamino SPYx reserve locate/read\n  KLend: ${KLEND}\n  SPYx mint: ${SPYX_MINT}\n  RPC: ${RPC}\n`);

  const accts = await rpc('getProgramAccounts', [KLEND, {
    encoding: 'base64',
    filters: [{ memcmp: { offset: MINT_OFFSET, bytes: SPYX_MINT } }],
  }]);
  if (!accts || !accts.length) {
    console.log(`  ⚪ no reserve found with SPYx mint at offset ${MINT_OFFSET}.`);
    console.log(`     Either the layout offset differs or Kamino's SPYx reserve is elsewhere.`);
    console.log(`     Next: dump a known reserve to re-locate the mint offset, or use Kamino API.`);
    return;
  }
  console.log(`  ✅ found ${accts.length} reserve account(s) holding SPYx as liquidity mint:\n`);
  for (const a of accts) {
    const buf = Buffer.from(a.account.data[0], 'base64');
    const version = buf.readBigUInt64LE(8);
    const lastSlot = buf.readBigUInt64LE(16);
    const stale = buf.readUInt8(24);
    const lendingMarket = pk(buf, 32);
    const mint = pk(buf, 128);
    console.log(`   reserve: ${a.pubkey}`);
    console.log(`     size: ${buf.length} bytes · version: ${version} · lastUpdate.slot: ${lastSlot} · stale: ${stale}`);
    console.log(`     lendingMarket: ${lendingMarket}`);
    console.log(`     liquidity.mint (offset 128): ${mint}  ${mint === SPYX_MINT ? '✓ SPYx' : '✗ MISMATCH — offset wrong'}`);

    const hits = findKnown(buf);
    console.log(`\n     oracle-identity scan (known accounts referenced by the reserve):`);
    if (hits.length) for (const h of hits) console.log(`       @${h.offset}: ${h.addr}\n          → ${h.label}`);
    else console.log(`       (no known oracle account matched — see config-tail candidates below)`);

    // resolve the OWNER program of each candidate → identify the oracle (owned by an oracle program)
    const ORACLE_OWNERS = {
      HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ: 'Scope (Kamino price aggregator — market-status/Chainlink-capable)',
      rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ: 'Pyth pull receiver',
      SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f: 'Switchboard',
      SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv: 'Switchboard On-Demand',
      cjg3oHmg9uuPsP8D6g29NWvhySJkdYdAo9D25PRbKXJ: 'Chainlink Store',
      TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token (vault/mint, not oracle)',
      TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022 (vault/mint, not oracle)',
      '11111111111111111111111111111111': 'System (unset/empty)',
      [KLEND]: 'Kamino Lend (internal)',
    };
    const cands = candidates(buf, 32, buf.length).filter((c) => !c.addr.startsWith('111111'));
    // dedup by addr, cap lookups
    const uniq = [...new Map(cands.map((c) => [c.addr, c])).values()].slice(0, 28);
    console.log(`\n     resolving owner program of ${uniq.length} candidates (oracle = the crux)…\n`);
    for (const c of uniq) {
      let owner = null;
      try { owner = (await rpc('getAccountInfo', [c.addr, { encoding: 'base64' }]))?.value?.owner || null; } catch {}
      const label = owner ? (ORACLE_OWNERS[owner] || `owner ${owner.slice(0, 8)}…`) : '(no account)';
      const star = ORACLE_OWNERS[owner]?.includes('Scope') || ORACLE_OWNERS[owner]?.includes('Pyth') || ORACLE_OWNERS[owner]?.includes('Chainlink') || ORACLE_OWNERS[owner]?.includes('Switchboard') ? '  ⬅ ORACLE' : '';
      console.log(`       @${String(c.offset).padStart(5)}: ${c.addr}  →  ${label}${star}`);
      await sleep(80);
    }
    console.log('');
  }
}

main().catch((e) => { console.error('kamino-reserve failed:', e.message); process.exit(1); });

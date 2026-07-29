// Vesper — auto-detect a wallet's Jupiter Lend xStock positions and their weekend safety.
// Pure re-execution: reads on-chain Position accounts, derives LTV from the tick
//   ( LTV = 1.0015^tick / price ), validated against 154 live TSLAx positions.
// Zero deps (Node 18+ global fetch). No wallet needed — pass any address, or run the demo.

import { marketStatus, statusNow, STATUS } from './campana.mjs';
import { weekendGauge } from './gauge.mjs';
import { solanaRpc } from '../../core/rpc.mjs';
import { b58encode } from '../../core/solana.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const VAULTS = 'jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// vault_id → xStock (77–80 borrow USDC, 81–84 borrow JupUSD — same collateral)
const VAULT = {
  77: 'TSLAx', 81: 'TSLAx', 78: 'SPYx', 82: 'SPYx',
  79: 'QQQx', 83: 'QQQx', 80: 'NVDAx', 84: 'NVDAx',
};
const XSTOCK = {
  TSLAx: { name: 'Tesla', lt: 0.75, src: 'BJWkdfRiH2Yroomx27VS1TxGxPWcfQoXHMmafBY7apZo' },
  SPYx: { name: 'S&P 500', lt: 0.85, src: 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff' },
  QQQx: { name: 'Nasdaq 100', lt: 0.85, src: 'DLuv79r7JPgdF2C266h1kuX8DPhg2amDtaTqz9Zm25w1' },
  NVDAx: { name: 'NVIDIA', lt: 0.75, src: 'A4RuZpjfbdzo1fQTqu1ng7kNya1knC2fHSSG5Sv4G4EH' },
};

// base58 (b58encode) + rpc now come from ../../core (were inline here).
const rpc = solanaRpc(RPC);

import { createHash } from 'node:crypto';
const POS_DISC = b58encode([...createHash('sha256').update('account:Position').digest().subarray(0, 8)]);

// ── price for an xStock (decode from its oracle's latest Chainlink DS update) ──
const priceCache = {};
async function priceFor(ticker) {
  if (priceCache[ticker]) return priceCache[ticker];
  const src = XSTOCK[ticker].src;
  const sigs = await rpc('getSignaturesForAddress', [src, { limit: 8 }]);
  for (const s of sigs) {
    const tx = await rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }]);
    const rd = tx?.meta?.returnData; if (!rd) continue;
    const raw = Buffer.from(rd.data[0], 'base64');
    for (let i = 0; i + 32 <= raw.length; i += 32) {
      const v = BigInt('0x' + raw.subarray(i, i + 32).toString('hex'));
      if (v > 5n * 10n ** 18n && v < 5000n * 10n ** 18n) { priceCache[ticker] = Number(v) / 1e18; return priceCache[ticker]; }
    }
  }
  return null;
}

// ── decode a Position account buffer ─────────────────────────────────────────
function decodePosition(b64) {
  const d = Buffer.from(b64, 'base64');
  if (d.length < 71) return null;
  return {
    vaultId: d.readUInt16LE(8),
    isSupplyOnly: d.readUInt8(46),
    tick: d.readInt32LE(47),
    supply: d.readBigUInt64LE(55),
  };
}

// ── wallet → its Jupiter Lend xStock borrow positions ────────────────────────
async function positionsForWallet(wallet) {
  const accs = await rpc('getTokenAccountsByOwner', [wallet, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]);
  const nftMints = (accs?.value || [])
    .map((a) => a.account.data.parsed.info)
    .filter((i) => i.tokenAmount.decimals === 0 && i.tokenAmount.amount === '1')
    .map((i) => i.mint);
  const out = [];
  for (const mint of nftMints) {
    const found = await rpc('getProgramAccounts', [VAULTS, { encoding: 'base64', filters: [
      { memcmp: { offset: 0, bytes: POS_DISC } },
      { memcmp: { offset: 14, bytes: mint } }, // position_mint
    ] }]);
    for (const a of found || []) {
      const p = decodePosition(a.account.data[0]);
      if (p && p.isSupplyOnly === 0 && p.supply > 0n && VAULT[p.vaultId]) out.push(p);
    }
  }
  return out;
}

// ── assemble the gauge for each position ─────────────────────────────────────
async function report(wallet) {
  const st = statusNow();
  const TAIL = 0.12;
  console.log(`\nVesper — your Jupiter Lend xStock positions\n`);
  console.log(`  wallet: ${wallet}`);
  console.log(`  market status (Campana): ${st.status}` + (st.status !== STATUS.OPEN ? '  ·  weekend guard ACTIVE' : '  ·  guard inactive (market open)'));
  console.log(`  weekend gap to survive: ${(TAIL * 100).toFixed(0)}%\n`);

  const positions = await positionsForWallet(wallet);
  if (!positions.length) { console.log('  No Jupiter Lend xStock borrow positions found for this wallet.\n'); return; }

  for (const p of positions) {
    const ticker = VAULT[p.vaultId], meta = XSTOCK[ticker];
    const price = await priceFor(ticker);
    const ltv = (1.0015 ** p.tick) / price;
    const g = weekendGauge({ ltv, lt: meta.lt, tailGap: TAIL, status: st.status });
    const emoji = { SAFE: '✅', 'DE-RISK': '⚠️ ', LIQUIDATABLE: '🔴', INACTIVE: '➖' }[g.verdict] || '';
    console.log(`  ${emoji} ${ticker} (${meta.name})  —  LTV ${(ltv * 100).toFixed(1)}%  ·  liq ${(meta.lt * 100).toFixed(0)}%  ·  price $${price.toFixed(2)}`);
    console.log(`      ${g.verdict}: ${g.action}\n`);
  }
}

// ── demo: read REAL live positions directly and gauge them ───────────────────
// (skips wallet→NFT resolution, which needs getTokenLargestAccounts — rate-limited
//  on the public RPC. The re-exec core below is identical to the --address path.)
async function demoReport() {
  const st = statusNow(); const TAIL = 0.12;
  console.log(`\nVesper — auto-detected weekend safety of REAL live Jupiter Lend positions`);
  console.log(`(no wallet needed — these are real borrowers on-chain, read + re-executed now)\n`);
  console.log(`  market status (Campana): ${st.status}` + (st.status !== STATUS.OPEN ? '  ·  weekend guard ACTIVE' : '  ·  guard inactive (market open)'));
  console.log(`  weekend gap to survive: ${(TAIL * 100).toFixed(0)}%`);

  const found = await rpc('getProgramAccounts', [VAULTS, { encoding: 'base64', filters: [
    { memcmp: { offset: 0, bytes: POS_DISC } },
    { memcmp: { offset: 8, bytes: b58encode([77, 0]) } }, // vault 77 (TSLAx)
  ] }]);
  const price = await priceFor('TSLAx'), meta = XSTOCK.TSLAx;
  const rows = [];
  for (const a of found) {
    const p = decodePosition(a.account.data[0]);
    if (!p || p.isSupplyOnly !== 0 || p.supply === 0n) continue;
    rows.push({ ltv: (1.0015 ** p.tick) / price, pk: a.pubkey });
  }
  rows.sort((x, y) => x.ltv - y.ltv);
  const safeMax = meta.lt * (1 - TAIL);
  const derisk = rows.find((r) => r.ltv > safeMax && r.ltv < meta.lt) || rows[Math.floor(rows.length * 0.9)];
  const pick = [rows[0], rows[Math.floor(rows.length * 0.5)], derisk, rows[rows.length - 1]];
  console.log(`\n  TSLAx (Tesla) · liq ${(meta.lt * 100).toFixed(0)}% · price $${price.toFixed(2)} · ${rows.length} live borrowers, showing 4:\n`);
  for (const r of pick) {
    const g = weekendGauge({ ltv: r.ltv, lt: meta.lt, tailGap: TAIL, status: st.status });
    const emoji = { SAFE: '✅', 'DE-RISK': '⚠️ ', LIQUIDATABLE: '🔴', INACTIVE: '➖' }[g.verdict] || '';
    console.log(`  ${emoji} LTV ${(r.ltv * 100).toFixed(1).padStart(5)}%  ${g.verdict.padEnd(12)} ${g.action}`);
    console.log(`       position ${r.pk}\n`);
  }
  console.log(`  → Each verdict is re-executed from chain state: LTV = 1.0015^tick / price.`);
  console.log(`  Point at your own wallet with:  node detect.mjs <address>  (needs a non-rate-limited RPC).\n`);
}

const arg = process.argv[2];
if (arg) await report(arg);
else await demoReport();

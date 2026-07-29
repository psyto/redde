// Ruptor — offensive re-execution: search the cheapest gap that breaks a live
// lending book, and price the trade that extracts it.
//
// Ruptor asks "over the ENTIRE live book, what is the smallest Monday-open gap g*
//   that first forces BAD DEBT, and what can a searcher EXTRACT at each gap?"
//   (offensive: search + aggregate + the executable trade + P&L). Lineage: the
//   Redde / Vesper / Praeda re-execution line. Zero deps (Node 18+).
//
// The live target (which venue, program id, mint, oracle, account layout) identifies
//   a specific protocol — that is a FINDING, not shipped. It loads from an optional,
//   gitignored ./venue.local.mjs. Without it, only --demo (a synthetic book) runs.
//
//   node ruptor.mjs --demo          # synthetic book, no RPC, no named venue
//   node ruptor.mjs                 # live (requires ./venue.local.mjs)
//   node ruptor.mjs --bonus 0.10    # override liquidation bonus (default 0.075)
//   RPC=<url> node ruptor.mjs       # use a non-rate-limited RPC

import { createHash } from 'node:crypto';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';

// Live venue config is a withheld finding — load it if present, else --demo only.
let VENUE = null;
try { ({ VENUE } = await import('./venue.local.mjs')); } catch { /* no live target */ }

const GENERIC = { vault: 0, ticker: 'EQXx', name: 'a tokenized equity', lt: 0.75 };
export const TARGET = VENUE?.target ?? GENERIC;
export const VENUE_LABEL = VENUE?.label ?? 'the venue';
const LAY = VENUE?.layout ?? { minLen: 71, vaultId: 8, isSupplyOnly: 46, tick: 47, supply: 55 };
const TICK_BASE = VENUE?.tickBase ?? 1.0015;
function requireVenue() {
  if (!VENUE) { console.error('live target not configured — create ./venue.local.mjs (a withheld finding) or run --demo.'); process.exit(1); }
}

// ── minimal RPC + base58 (self-contained, Redde lineage) ──────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error && (j.error.code === 429 || r.status === 429)) { await sleep(600 * (i + 1)); continue; }
    return j.result;
  }
  return undefined;                                     // exhausted retries (rate-limited)
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s || '1';
}
const POS_DISC = VENUE ? b58encode([...createHash('sha256').update(VENUE.posDiscSeed).digest().subarray(0, 8)]) : null;

function decodePosition(b64) {
  const d = Buffer.from(b64, 'base64');
  if (d.length < LAY.minLen) return null;
  return {
    vaultId: d.readUInt16LE(LAY.vaultId),
    isSupplyOnly: d.readUInt8(LAY.isSupplyOnly),
    tick: d.readInt32LE(LAY.tick),
    supply: d.readBigUInt64LE(LAY.supply),
  };
}

// ── fair price for the collateral asset (decode from its Chainlink DS update) ──
export async function fairPrice() {
  requireVenue();
  const sigs = await rpc('getSignaturesForAddress', [TARGET.oracle, { limit: 8 }]);
  for (const s of sigs) {
    const tx = await rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }]);
    const rd = tx?.meta?.returnData; if (!rd) continue;
    const raw = Buffer.from(rd.data[0], 'base64');
    for (let i = 0; i + 32 <= raw.length; i += 32) {
      const v = BigInt('0x' + raw.subarray(i, i + 32).toString('hex'));
      if (v > 5n * 10n ** 18n && v < 5000n * 10n ** 18n) return Number(v) / 1e18;
    }
  }
  return null;
}
export async function collateralDecimals() {
  requireVenue();
  const s = await rpc('getTokenSupply', [TARGET.mint]);
  return s?.value?.decimals ?? 8;
}

// ── read the full live book for the target vault ──────────────────────────────
export async function liveBook(price, dec) {
  requireVenue();
  const found = await rpc('getProgramAccounts', [VENUE.program, { encoding: 'base64', filters: [
    { memcmp: { offset: 0, bytes: POS_DISC } },
    { memcmp: { offset: LAY.vaultId, bytes: b58encode([TARGET.vault, 0]) } },
  ] }]);
  const book = [];
  for (const a of found || []) {
    const p = decodePosition(a.account.data[0]);
    if (!p || p.isSupplyOnly !== 0 || p.supply === 0n) continue;
    const qty = Number(p.supply) / 10 ** dec;             // whole tokens of collateral
    const debtPerTok = TICK_BASE ** p.tick;               // USD debt per whole token
    const coll = qty * price;                             // collateral value, USD
    const debt = debtPerTok * qty;                        // debt, USD
    if (coll <= 0) continue;
    book.push({ pk: a.pubkey, qty, coll, debt, ltv: debt / coll });
  }
  book.sort((x, y) => y.ltv - x.ltv);                     // worst first
  return book;
}

// ── the offensive core: what breaks, and what a searcher extracts, at gap g ───
// Model (all params labeled): the Monday underlying gaps down by g. A position is
//   liquidatable when post-gap LTV = ltv/(1-g) >= LT. A liquidator repays debt and
//   seizes collateral + `bonus`. Max profitably-repayable debt r = postColl/(1+bonus).
//   - healthy:   r >= cf*debt  → liquidator profit = cf*debt*bonus, protocol whole.
//   - underwater: r <  cf*debt → collateral can't cover debt+bonus; protocol eats
//     bad_debt = debt - r; searcher still profits postColl*bonus/(1+bonus).
export function stress(book, g, { bonus, cf, lt }) {
  let nLiq = 0, debtAtRisk = 0, badDebt = 0, extract = 0, firstBreaker = null;
  for (const p of book) {
    const postColl = p.coll * (1 - g);
    const postLtv = p.debt / postColl;
    if (postLtv < lt) continue;                            // survives this gap
    nLiq++; debtAtRisk += p.debt;
    const rMax = postColl / (1 + bonus);                   // max profitably-repayable
    const repaid = Math.min(cf * p.debt, rMax);
    extract += repaid * bonus;                             // searcher P&L on this position
    const bd = Math.max(0, p.debt - rMax);                 // protocol shortfall
    if (bd > 0) { badDebt += bd; if (!firstBreaker) firstBreaker = p; }
  }
  return { g, nLiq, debtAtRisk, badDebt, extract, firstBreaker };
}

function usd(x) { return '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function pct(x) { return (x * 100).toFixed(1) + '%'; }

// ── demo mode: a deterministic synthetic book that mirrors the real one's shape ─
// No RPC, no real venue, no real borrowers — safe to share. Same math downstream.
// Used to publish the ENGINE + METHOD publicly while the live named findings stay
// local (the solinv posture: tools public, findings withheld).
const ANON = { vault: 0, ticker: 'EQXx', name: 'a tokenized equity', lt: 0.75, mint: '(demo)', oracle: '(demo)' };
function demoBook(price) {
  let s = 0x9e3779b9;                                  // seeded LCG — deterministic, no Date/random
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const book = [];
  for (let i = 0; i < 160; i++) {
    const coll = 2000 + rnd() ** 2 * 78000;            // $2k–$80k, skewed small
    // LTV: mostly healthy, a right tail crossing LT (≈12 already liquidatable, like the real book)
    let ltv = 0.20 + rnd() * 0.45;
    if (i % 13 === 0) ltv = 0.76 + rnd() * 0.16;       // the tail
    const debt = ltv * coll;
    book.push({ pk: 'demo_' + String(i).padStart(3, '0'), qty: coll / price, coll, debt, ltv });
  }
  book.sort((x, y) => y.ltv - x.ltv);
  return book;
}

async function main() {
  const args = {}; const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    if (!av[i].startsWith('--')) continue;
    const k = av[i].slice(2), nxt = av[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) args[k] = true;   // boolean flag
    else { args[k] = nxt; i++; }                                     // valued flag
  }
  const demo = 'demo' in args;                          // synthetic book, no RPC, no named venue
  const anon = demo || 'anon' in args;                  // strip venue name, asset id, position ids
  const T = demo ? ANON : anon ? { ...TARGET, ticker: ANON.ticker, name: ANON.name } : TARGET;
  const P = { bonus: args.bonus != null ? +args.bonus : 0.075, cf: args.cf != null ? +args.cf : 1.0, lt: T.lt };
  const json = 'json' in args;

  if (!json) {
    console.log(`\nRuptor — offensive re-execution of a live lending book`);
    const venue = demo ? 'DEMO (synthetic book, no real venue)' : anon ? 'Venue A — a live Solana lending venue listing tokenized equities' : `${VENUE_LABEL} ${T.ticker} (${T.name}), vault ${T.vault}`;
    console.log(`target: ${venue} · liq threshold ${pct(P.lt)}`);
    console.log(`params: liquidation bonus ${pct(P.bonus)} · close factor ${pct(P.cf)}  (labeled assumptions, override with --bonus/--cf)\n`);
  }

  let price, dec, book;
  if (demo) {
    price = 100; dec = 8; book = demoBook(price);
  } else {
    [price, dec] = await Promise.all([fairPrice(), collateralDecimals()]);
    if (!price) { console.error('could not read fair price from chain — retry with a non-rate-limited RPC'); process.exit(1); }
    book = await liveBook(price, dec);
    if (!book.length) { console.error('no live borrow positions found'); process.exit(1); }
    if (anon) book = book.map((p, i) => ({ ...p, pk: 'pos_' + String(i).padStart(3, '0') }));
  }

  const venueName = demo ? 'DEMO — synthetic book' : anon ? 'Venue A' : VENUE_LABEL;
  const snapTarget = anon
    ? { ticker: T.ticker, name: T.name, lt: T.lt, venue: venueName, anon: true, demo }
    : TARGET;

  if (json) {
    const snap = {
      target: snapTarget, price, decimals: dec, params: P,
      capturedAt: new Date().toISOString(),
      book: book.map((p) => ({ pk: p.pk, qty: p.qty, coll: p.coll, debt: p.debt, ltv: p.ltv })),
    };
    process.stdout.write(JSON.stringify(snap));
    return;
  }

  const totColl = book.reduce((s, p) => s + p.coll, 0);
  const totDebt = book.reduce((s, p) => s + p.debt, 0);
  const who = demo ? 'synthetic borrowers' : 'real borrowers';
  console.log(`live book (re-executed now): ${book.length} ${who} · fair price $${price.toFixed(2)} · collateral ${usd(totColl)} · debt ${usd(totDebt)}`);
  console.log(`worst position: LTV ${pct(book[0].ltv)}  (${book[0].pk})\n`);

  // 1-D search for the critical gap g* — the cheapest Monday gap that first forces bad debt.
  let gStar = null;
  for (let g = 0; g <= 0.5 + 1e-9; g += 0.0025) {
    if (stress(book, g, P).badDebt > 0) { gStar = g; break; }
  }

  console.log(`gap sweep — what the book does as the Monday underlying gaps down:\n`);
  console.log(`   gap    liquidatable   debt-at-risk     BAD DEBT (protocol)   searcher extract`);
  for (const g of [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]) {
    const r = stress(book, g, P);
    console.log(`   ${pct(g).padStart(5)}   ${String(r.nLiq).padStart(4)}/${book.length}      ${usd(r.debtAtRisk).padStart(12)}     ${usd(r.badDebt).padStart(14)}       ${usd(r.extract).padStart(12)}`);
  }

  console.log(`\n── the break ──────────────────────────────────────────────────────────────`);
  if (gStar == null) {
    console.log(`  No gap ≤ 50% forces bad debt on this book — over-collateralized. (Kill: nothing to extract here.)`);
  } else {
    const r = stress(book, gStar, P);
    console.log(`  critical gap g* = ${pct(gStar)} — the cheapest Monday gap that first makes the book insolvent.`);
    console.log(`  at g*: ${r.nLiq} positions liquidatable, first bad debt appears (${usd(r.badDebt)} protocol shortfall).`);
    const b = stress(book, 0.20, P);
    console.log(`  at a 20% gap: ${venueName} eats ${usd(b.badDebt)} bad debt across ${b.nLiq} positions; a searcher extracts ${usd(b.extract)}.`);
    const fb = r.firstBreaker;
    if (fb) {
      const postColl = fb.coll * (1 - gStar);
      console.log(`\n  the trade (first breaker ${fb.pk}):`);
      console.log(`    now: collateral ${usd(fb.coll)} · debt ${usd(fb.debt)} · LTV ${pct(fb.ltv)}`);
      console.log(`    at g*=${pct(gStar)}: collateral ${usd(postColl)} < debt ${usd(fb.debt)} → underwater.`);
      console.log(`    searcher repays ${usd(Math.min(P.cf * fb.debt, postColl / (1 + P.bonus)))}, seizes all ${usd(postColl)} collateral;`);
      console.log(`    protocol eats ${usd(Math.max(0, fb.debt - postColl / (1 + P.bonus)))}.`);
    }
  }

  console.log(`\n  Why this only exists on a RED venue: this cascade requires liquidating against the`);
  console.log(`  gapped/stale price during the closed window. A CLAMP+SUSPEND venue (Vesper GREEN,`);
  console.log(`  e.g. Kamino) bounds liq price to last close and pauses — removing this attack surface.`);
  console.log(`  Gauntlet stops at "this position is risky." Ruptor prints the executable trade + P&L.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

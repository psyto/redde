// Vesper — weekend price-liveness probe (the on-chain half of probeOnChain).
//
// The CMLS-deciding observable (the one that made the Jupiter RED airtight): during the
// closed-market window, does the price account a venue liquidates against KEEP UPDATING
// (→ no market-status guard → liquidations run vs a price the regulated market never printed
//  → RED), or does it FREEZE at the last regular close (→ GREEN/YELLOW)?
//
// This re-executes that check from chain state: page getSignaturesForAddress over a price
// account and measure its update cadence, split by whether each update lands inside the
// US-equity CLOSED window (Fri 20:00 ET → Sun 20:00 ET, and overnight). Zero-dep.
//
// Usage:  node weekend-liveness.mjs <priceAccount> [label]
//   node weekend-liveness.mjs A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff "Jupiter SPYx"

import { marketStatus, STATUS } from './campana.mjs';
import { makeRpc } from '../../core/rpc.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// rpc now comes from ../../core; per-call rpcUrl preserved (bind per call).
const rpc = (rpcUrl, method, params) => makeRpc(rpcUrl)(method, params);

// Page back through signatures, collecting blockTimes. Window is [lo, hi]: an explicit {from,to}
// pins a REPRODUCIBLE window (what a claim embeds so a stranger re-pulls the same set); otherwise
// the trailing `hoursBack`. Returning the raw times is what lets a claim be re-executed offline.
export async function fetchUpdateTimes(acct, { rpcUrl = 'https://api.mainnet-beta.solana.com', hoursBack = 72, from, to } = {}) {
  const lo = from != null ? from : Math.floor(Date.now() / 1000) - hoursBack * 3600;
  const hi = to != null ? to : Infinity;
  const times = [];
  let before;
  for (let page = 0; page < 20; page++) {
    const opts = { limit: 1000 }; if (before) opts.before = before;
    const sigs = await rpc(rpcUrl, 'getSignaturesForAddress', [acct, opts]);
    if (!sigs || !sigs.length) break;
    for (const s of sigs) if (s.blockTime) times.push(s.blockTime);
    before = sigs[sigs.length - 1].signature;
    if (sigs[sigs.length - 1].blockTime && sigs[sigs.length - 1].blockTime < lo) break;
    await sleep(120);
  }
  return times.filter((t) => t >= lo && t <= hi).sort((a, b) => a - b);
}

// PURE classifier: sorted update-times (+ holiday calendar) → market-status split + liveness signal.
// This is the deterministic core a claim re-executes OFFLINE — no RPC, no clock read. Same times →
// same verdict, for anyone, forever. The whole "don't trust, re-execute" property lives right here.
export function classifyUpdateTimes(times, cal) {
  if (!times.length) return { updates: 0, signal: 'NO_DATA' };
  let openN = 0, closedN = 0, firstClosed = null, lastClosed = null;
  const gaps = [];
  const dailyClosed = {}; // ET-date → count of updates while US market CLOSED
  for (let i = 0; i < times.length; i++) {
    const st = marketStatus(times[i], cal);
    if (st.status === STATUS.OPEN) openN++;
    else {
      closedN++; if (!firstClosed) firstClosed = times[i]; lastClosed = times[i];
      dailyClosed[st.dateET] = (dailyClosed[st.dateET] || 0) + 1;
    }
    if (i > 0) gaps.push(times[i] - times[i - 1]);
  }
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  const signal = closedN > 0 && maxGap < 30 * 60 ? 'LIVE_THROUGH_CLOSURE' // → RED (no market-status guard)
    : closedN === 0 ? 'FROZEN_THROUGH_CLOSURE' // → feed halts when market shut (GREEN/YELLOW candidate)
      : 'SPARSE'; // staleness-gated; needs band decode
  return {
    first: times[0], last: times[times.length - 1], updates: times.length,
    openUpdates: openN, closedUpdates: closedN, firstClosed, lastClosed, maxGapMin: +(maxGap / 60).toFixed(1),
    dailyClosed, signal,
  };
}

// The reusable on-chain observable = fetch + classify. Establishes RED (feed live through closure,
// no guard); it CANNOT by itself establish GREEN — a GREEN venue's feed may still tick while the
// venue's PROGRAM bands it to last close. GREEN needs the reserve band/market-status config decode.
export async function weekendLiveness(acct, opts = {}) {
  const times = await fetchUpdateTimes(acct, opts);
  return { acct, ...classifyUpdateTimes(times, opts.cal) };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function fmt(ts) { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z'; }
if (import.meta.url === `file://${process.argv[1]}`) {
  const ACCT = process.argv[2];
  const LABEL = process.argv[3] || ACCT;
  if (!ACCT) { console.error('usage: node weekend-liveness.mjs <priceAccount> [label]'); process.exit(1); }
  const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';
  console.log(`\nVesper — weekend price-liveness · ${LABEL}\n  account: ${ACCT}\n  RPC: ${rpcUrl}\n`);
  const r = await weekendLiveness(ACCT, { rpcUrl, hoursBack: 72 });
  if (r.signal === 'NO_DATA') { console.log('  no updates in the last 72h (or RPC blocked).\n'); process.exit(0); }
  console.log(`  window: ${fmt(r.first)} → ${fmt(r.last)}  (${((r.last - r.first) / 3600).toFixed(1)}h)`);
  console.log(`  total updates: ${r.updates}`);
  console.log(`  during US-market OPEN:   ${r.openUpdates}`);
  console.log(`  during US-market CLOSED: ${r.closedUpdates}   ${r.closedUpdates ? `(first ${fmt(r.firstClosed)} → last ${fmt(r.lastClosed)})` : ''}`);
  console.log(`  max gap between updates: ${r.maxGapMin} min\n`);
  if (r.signal === 'LIVE_THROUGH_CLOSURE') {
    console.log(`  🔴 LIVE-THROUGH-CLOSURE — kept updating (${r.closedUpdates}×) while the US market was CLOSED,`);
    console.log(`     max gap ${r.maxGapMin}min. A venue liquidating on this price has NO market-status halt → RED.`);
  } else if (r.signal === 'FROZEN_THROUGH_CLOSURE') {
    console.log(`  🟢/🟡 FROZEN-THROUGH-CLOSURE — zero closed-window updates: the feed stops when the market is shut.`);
  } else {
    console.log(`  🟡 SPARSE — closed-window updates with large gaps (${r.maxGapMin}min); needs the band/clamp decode.`);
  }
  console.log('');
}

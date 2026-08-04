// Vesper — claim registry. The shared, append-only ledger where nodes post claims and where
// agreement/dispute becomes visible. Content-addressed: two nodes that re-execute the same subject
// over the same window post the SAME claim_id → an AGREE row; a different id under the same
// (subject, window) is a DISPUTE the network can resolve by re-execution.
//
// This registry is append-only JSONL today (registry/log.jsonl); each row also carries its exact
// ON-CHAIN MEMO PAYLOAD — the ≤566-byte string that anchors the claim to Solana's Memo program.
// Posting that memo on devnet is a thin adapter (needs a funded key; blocked only by the faucet),
// so the registry is already on-chain-shaped: the memo log IS the registry.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';

const LOG = new URL('./registry/log.jsonl', import.meta.url);
const SHORT = { 'closed-market-liquidation-soundness': 'cmls', 'reserve-solvency': 'solv', 'closed-market-price-guard': 'cmpg' };

// Canonical subject key: stable across nodes so agreement groups line up.
export function subjectKey(claim) {
  const s = claim.subject;
  const who = s.venue || s.protocol || '?';
  return `${who}:${s.asset}`.toLowerCase().replace(/\s+/g, '-');
}
// The on-chain memo payload — compact, self-describing, fits a Solana Memo instruction.
export function memoPayload(claim) {
  const w = claim.inputs.window;
  const win = w.from_ts != null ? `${w.from_ts}-${w.to_ts}` : w.observed_ts != null ? `at${w.observed_ts}` : `epoch${w.epoch}`;
  return `vesper/v0 ${SHORT[claim.claim_type] || claim.claim_type} ${claim.claim_id} ${claim.verdict.flag} ${subjectKey(claim)} ${win}`;
}

export function readLog() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Append a posted claim (a node's verdict) to the registry.
export function post(claim, node = 'anon') {
  mkdirSync(new URL('./registry/', import.meta.url), { recursive: true });
  const row = {
    ts: Math.floor(Date.now() / 1000), node,
    claim_id: claim.claim_id, claim_type: claim.claim_type,
    subject: subjectKey(claim), window: claim.inputs.window, verdict: claim.verdict.flag,
    memo: memoPayload(claim), onchain_sig: null, // filled when broadcast to Solana Memo
  };
  appendFileSync(LOG, JSON.stringify(row) + '\n');
  return row;
}

// Group by (subject, window) and report AGREE (all ids equal) / DISPUTE (ids differ) / SINGLE.
export function consensus(rows = readLog()) {
  const groups = {};
  for (const r of rows) {
    const k = `${r.subject}@${r.window.from_ts ?? 'e' + r.window.epoch}`;
    (groups[k] ||= []).push(r);
  }
  return Object.entries(groups).map(([k, rs]) => {
    const ids = [...new Set(rs.map((r) => r.claim_id))];
    const state = rs.length < 2 ? 'SINGLE' : ids.length === 1 ? 'AGREE' : 'DISPUTE';
    return { group: k, nodes: rs.map((r) => r.node), verdict: rs[0].verdict, distinctClaimIds: ids.length, state };
  });
}

// ── CLI: post <claim.json> [--node NAME] | list | consensus ───────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  const nodeIdx = process.argv.indexOf('--node');
  const nodeName = nodeIdx > -1 ? process.argv[nodeIdx + 1] : 'anon';

  if (cmd === 'post') {
    const claim = JSON.parse(readFileSync(arg, 'utf8'));
    const row = post(claim, nodeName);
    console.log(`\n  posted to registry by node "${row.node}":`);
    console.log(`    ${row.verdict}  ${row.claim_id}  (${row.subject})`);
    console.log(`    on-chain memo payload (${row.memo.length} bytes, ≤566 for Solana Memo):`);
    console.log(`      ${row.memo}`);
    console.log(`    ↳ broadcast: post this memo via the Solana Memo program (needs a funded devnet key).\n`);
  } else if (cmd === 'consensus') {
    console.log('\n  Vesper registry — consensus by content-address:\n');
    for (const c of consensus()) {
      const mark = { AGREE: '🤝', DISPUTE: '⚔️ ', SINGLE: '·' }[c.state];
      console.log(`    ${mark} ${c.state.padEnd(8)} ${c.group}  [${c.nodes.join(', ')}]  verdict=${c.verdict}  distinct_ids=${c.distinctClaimIds}`);
    }
    console.log('');
  } else {
    for (const r of readLog()) console.log(`  ${r.node.padEnd(10)} ${r.verdict.padEnd(6)} ${r.claim_id}  ${r.subject}`);
    if (!readLog().length) console.log('  (registry empty — post a claim first)');
  }
}

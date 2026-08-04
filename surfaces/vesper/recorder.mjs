// Vesper — recorder. The honest way around Solana's "can't re-execute history" wall.
//
// You cannot prove the PAST trustlessly on Solana today (no verifiable state root — the Accounts
// Lattice Hash is homomorphic, no inclusion proofs; no in-program light client; no BLS precompile;
// the stake-weighted accumulator is an idea, not a syscall). But you CAN commit the PRESENT: a
// permissionless watcher records a feed's closed-market updates, as they happen, into an append-only
// merkle log whose ROOT lives on-chain (Solana's account-compression / concurrent merkle tree, the
// same primitive cNFTs use — cheap appends, ~few-thousand-CU on-chain inclusion verify).
//
// Why this matters for the network: a fraud proof (fraudproof.mjs) anchored to a challenger-supplied
// canonical_root has a data-availability residual — you must trust that root is the true set. Anchor
// it instead to the RECORDER'S ON-CHAIN ROOT and that residual disappears: a Solana program verifies
// witness inclusion against a root it already holds. Trust moves from "reconstruct history" to "who
// may append" (the watcher) — a surface hardenable by N-of-M watchers / staking, and a public,
// tamper-evident log anyone can audit. Honest limit: the root attests "we recorded this, unaltered",
// never "this was true on Solana" — so the watcher must observe live, and its honesty is the residual.
//
// This is the off-chain reference the on-chain program mirrors (append via CPI from a PDA authority
// that exposes a permissionless entrypoint). Zero-dep; append-ordered merkle matches merkle.mjs hashing.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { leafHash, verifyInclusion } from './merkle.mjs';
import { fetchObservations } from './weekend-liveness.mjs';
import { marketStatus, STATUS } from './campana.mjs';

const parent = (a, b) => createHash('sha256').update(a + '|' + b).digest('hex'); // matches merkle.mjs

// Append-ORDERED merkle (leaves in insertion order — a concurrent merkle tree, not the sorted
// commitment merkle.mjs builds for a finished claim). Leaf i = the i-th recorded observation.
export function rootOfLeaves(leaves) {
  if (!leaves.length) return createHash('sha256').update('').digest('hex');
  let lvl = leaves.slice();
  while (lvl.length > 1) {
    const nx = [];
    for (let i = 0; i < lvl.length; i += 2) nx.push(parent(lvl[i], i + 1 < lvl.length ? lvl[i + 1] : lvl[i]));
    lvl = nx;
  }
  return lvl[0];
}
export function proofForLeaves(leaves, index) {
  let lvl = leaves.slice(), idx = index;
  const proof = [];
  while (lvl.length > 1) {
    const isRight = idx % 2 === 1;
    const sibIdx = isRight ? idx - 1 : (idx + 1 < lvl.length ? idx + 1 : idx);
    proof.push({ sib: lvl[sibIdx], onRight: !isRight });
    const nx = [];
    for (let i = 0; i < lvl.length; i += 2) nx.push(parent(lvl[i], i + 1 < lvl.length ? lvl[i + 1] : lvl[i]));
    lvl = nx; idx = Math.floor(idx / 2);
  }
  return proof;
}

const LOG = new URL('./recorder/log.json', import.meta.url);
function loadLog() { return existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : { account: null, observations: [] }; }
function saveLog(s) { mkdirSync(new URL('./recorder/', import.meta.url), { recursive: true }); writeFileSync(LOG, JSON.stringify(s, null, 2) + '\n'); }

// Append newly-observed closed-market updates for `account` (dedup by signature). Returns the new root.
export async function record(account, { rpcUrl, hoursBack = 6, closedOnly = true } = {}) {
  const log = loadLog();
  if (log.account && log.account !== account) throw new Error('recorder log is bound to a different account');
  log.account = account;
  const seen = new Set(log.observations.map((o) => o.sig));
  const fresh = (await fetchObservations(account, { rpcUrl, hoursBack }))
    .filter((o) => !seen.has(o.sig))
    .filter((o) => !closedOnly || marketStatus(o.blockTime).status === STATUS.CLOSED); // the CMLS-relevant events
  fresh.sort((a, b) => a.slot - b.slot || (a.sig < b.sig ? -1 : 1)); // stable append order
  for (const o of fresh) log.observations.push(o);
  log.root = rootOfLeaves(log.observations.map(leafHash));
  log.count = log.observations.length;
  saveLog(log);
  return { appended: fresh.length, total: log.count, root: log.root };
}

// ── CLI: record <account> | root | prove <index> ─────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';

  if (cmd === 'record') {
    const acct = arg || 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff'; // Jupiter SPYx feed
    console.log(`\nVesper recorder — appending live closed-market updates for ${acct.slice(0, 8)}…\n`);
    const r = await record(acct, { rpcUrl });
    console.log(`  appended ${r.appended} new closed-market observation(s) · log now ${r.total}`);
    console.log(`  on-chain-shaped root: ${r.root}`);
    console.log(`\n  This root is what a Solana program (account-compression tree) would hold. A fraud`);
    console.log(`  proof anchored here is verifiable on-chain — no challenger-supplied canonical root.\n`);
  } else if (cmd === 'prove') {
    const log = loadLog();
    const i = Number(arg ?? 0);
    if (!log.observations.length) { console.log('  recorder log empty — run `record` first.\n'); process.exit(0); }
    const leaves = log.observations.map(leafHash);
    const proof = proofForLeaves(leaves, i);
    const ok = verifyInclusion(log.root, leaves[i], proof);
    const o = log.observations[i];
    console.log(`\nVesper recorder — inclusion proof for observation #${i}`);
    console.log(`  sig ${o.sig.slice(0, 12)}… slot ${o.slot} (${new Date(o.blockTime * 1000).toISOString().slice(0, 16)}Z)`);
    console.log(`  proof: ${proof.length} sibling hashes against root ${log.root.slice(0, 16)}…`);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  verifies against the on-chain root (a program checks this in ~${proof.length} SHA-256 syscalls)\n`);
  } else {
    const log = loadLog();
    console.log(`\n  recorder log: account ${log.account || '—'} · ${log.observations?.length || 0} observations · root ${(log.root || '—').slice(0, 16)}…\n`);
  }
}

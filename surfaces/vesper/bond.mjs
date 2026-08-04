// Vesper — bond & slash. Closes the economic loop: the judge's SLASHABLE verdict becomes a real
// consequence. A node posts a claim WITH A BOND. A challenge window opens. A challenger who thinks
// the claim is false posts their own bond and triggers adjudication by the judge (deterministic
// re-execution against chain). The judge's ruling settles the bonds:
//
//   claim INVALID  → SLASHED:           the claimer's bond goes to the challenger (minus a treasury cut).
//   claim VALID    → CHALLENGE_FAILED:  the challenger's bond goes to the claimer (frivolous challenge).
//   no challenge by window close → FINALIZED: the claimer's bond is returned; the claim stands.
//
// Symmetric skin-in-the-game: lying AND frivolous challenging are both punished, and the referee is
// re-execution — not an authority. This is the reference state machine the on-chain program enforces;
// lamport custody is the thin adapter (a Solana program holding bonds in a PDA, resolved by a posted
// fraud proof / resolver — deploy is gated on a funded key, exactly like broadcast.mjs).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { adjudicate } from './judge.mjs';

const LEDGER = new URL('./bonds/ledger.json', import.meta.url);
const TREASURY_CUT = 0.10; // slashed bonds pay a 10% cut to the treasury; the rest to the winner

function load() {
  if (!existsSync(LEDGER)) return { bonds: {}, balances: {}, treasury: 0 };
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}
function save(s) { mkdirSync(new URL('./bonds/', import.meta.url), { recursive: true }); writeFileSync(LEDGER, JSON.stringify(s, null, 2) + '\n'); }
const credit = (s, who, amt) => { s.balances[who] = +( (s.balances[who] || 0) + amt ).toFixed(6); };

// Post a claim with a bond. The bond is locked; balance goes negative until settled.
export function postClaim(state, claim, { bond, node, windowSecs = 86400, nowTs }) {
  if (state.bonds[claim.claim_id]) throw new Error(`claim ${claim.claim_id} already bonded`);
  credit(state, node, -bond); // lock
  state.bonds[claim.claim_id] = {
    claim_id: claim.claim_id, claim_type: claim.claim_type, subject: claim.subject.venue || claim.subject.protocol,
    verdict: claim.verdict.flag, node, bond, posted_ts: nowTs, window_secs: windowSecs, state: 'POSTED', challenge: null,
  };
  return state.bonds[claim.claim_id];
}

// Challenge a bonded claim: the challenger stakes `bond`, the judge adjudicates, bonds settle.
export async function challenge(state, claim, { bond, challenger, nowTs, rpcUrl }) {
  const b = state.bonds[claim.claim_id];
  if (!b) throw new Error(`no bonded claim ${claim.claim_id}`);
  if (b.state !== 'POSTED') throw new Error(`claim ${claim.claim_id} already ${b.state}`);
  credit(state, challenger, -bond); // challenger locks their stake

  const ruling = await adjudicate(claim, { rpcUrl });

  if (!ruling.valid) {
    // claim is provably false → claimer SLASHED. Challenger recovers their stake + wins the claimer's bond (minus cut).
    const cut = +(b.bond * TREASURY_CUT).toFixed(6);
    credit(state, challenger, bond + (b.bond - cut)); // unlock own + winnings
    state.treasury = +(state.treasury + cut).toFixed(6);
    b.state = 'SLASHED';
  } else {
    // claim stands → challenger SLASHED (frivolous). Claimer unlocks bond + wins the challenge stake (minus cut).
    const cut = +(bond * TREASURY_CUT).toFixed(6);
    credit(state, b.node, b.bond + (bond - cut)); // unlock own + winnings
    state.treasury = +(state.treasury + cut).toFixed(6);
    b.state = 'CHALLENGE_FAILED';
  }
  b.challenge = { challenger, bond, ruling: { valid: ruling.valid, truthVerdict: ruling.truthVerdict, reason: ruling.reason }, settled_ts: nowTs };
  return b;
}

// Finalize an unchallenged claim past its window: bond returned, claim stands.
export function finalize(state, claimId, nowTs) {
  const b = state.bonds[claimId];
  if (!b) throw new Error(`no bonded claim ${claimId}`);
  if (b.state !== 'POSTED') return b;
  if (nowTs < b.posted_ts + b.window_secs) throw new Error(`window still open for ${claimId}`);
  credit(state, b.node, b.bond); // unlock
  b.state = 'FINALIZED';
  return b;
}

// ── CLI: `node bond.mjs demo <honest.json> <gamed.json>` ──────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, aPath, bPath] = process.argv.slice(2);
  const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';
  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', STALE: '🟡', UNKNOWN: '❓' };

  if (cmd !== 'demo' || !aPath || !bPath) {
    console.error('usage: node bond.mjs demo <honest-claim.json> <gamed-claim.json>');
    process.exit(2);
  }
  const honest = JSON.parse(readFileSync(aPath, 'utf8'));
  const gamed = JSON.parse(readFileSync(bPath, 'utf8'));
  const s = { bonds: {}, balances: {}, treasury: 0 }; // fresh ledger for the demo
  const T = 1_000_000; // fixed pseudo-time (scripts must not read the clock)

  console.log(`\nVesper bond & slash — economic loop demo (bond = 1.0, treasury cut = ${TREASURY_CUT * 100}%)\n`);

  console.log(`  1) alice posts the HONEST claim ${emoji[honest.verdict.flag]}${honest.verdict.flag} with a 1.0 bond`);
  postClaim(s, honest, { bond: 1.0, node: 'alice', nowTs: T });
  console.log(`     bob challenges it (stakes 1.0) → judge adjudicates...`);
  await challenge(s, honest, { bond: 1.0, challenger: 'bob', nowTs: T, rpcUrl });
  console.log(`     → ${s.bonds[honest.claim_id].state}: claim is VALID, bob's frivolous challenge is slashed.\n`);

  console.log(`  2) mallory posts the GAMED claim ${emoji[gamed.verdict.flag]}${gamed.verdict.flag} (omits weekend obs) with a 1.0 bond`);
  postClaim(s, gamed, { bond: 1.0, node: 'mallory', nowTs: T });
  console.log(`     carol challenges it (stakes 1.0) → judge adjudicates...`);
  await challenge(s, gamed, { bond: 1.0, challenger: 'carol', nowTs: T, rpcUrl });
  console.log(`     → ${s.bonds[gamed.claim_id].state}: claim is INVALID, mallory's bond is slashed to carol.\n`);

  save(s);
  console.log(`  final balances (net, from 0):`);
  for (const [who, bal] of Object.entries(s.balances).sort()) console.log(`     ${who.padEnd(9)} ${bal >= 0 ? '+' : ''}${bal}`);
  console.log(`     treasury  +${s.treasury}`);
  console.log(`\n  Lying cost mallory 1.0; the honest challenger carol earned +${(1.0 * (1 - TREASURY_CUT)).toFixed(2)}. Frivolous`);
  console.log(`  challenging cost bob 1.0; the honest claimer alice earned +${(1.0 * (1 - TREASURY_CUT)).toFixed(2)}. The referee was re-execution.\n`);
}

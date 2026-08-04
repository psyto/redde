// Vesper — resolution. The standard: re-execution as the neutral RESOLVER for money-at-risk-on-a-
// verdict markets — prediction markets on on-chain state, and agent-payment escrow. Both are the same
// shape: a market poses a boolean ON-CHAIN-STATE condition; a VerifiableClaim re-executes it to a
// deterministic outcome; bond.mjs settles so the CORRECT side captures the stake. Anyone re-runs
// verify.mjs and reproduces the resolution — no token vote, no committee, no trusted oracle.
//
// Why now (the bet): agent-payments and prediction markets are both coming, both money-at-risk-on-a-
// verdict. The compounding moat capital can't buy later is the STANDARD + a public, reproducible corpus
// of correct resolutions + mindshare as the neutral re-execution resolver. This file mints that corpus.
//
// Where UMA token-voting is corruptible ($95M cap < single-market stakes ⇒ bribery rational) and
// Chainlink answers only PRICES, re-execution answers ON-CHAIN-STATE conditions (solvency, soundness,
// depeg, exploit) deterministically. That is the open lane. This is a reference resolution, not yet a
// live-capital bond on a live market (that step needs capital + a venue) — it accrues the standard.

import { writeFileSync, mkdirSync } from 'node:fs';
import { verifyLevel1 } from './verify.mjs';

// Resolve a market's boolean condition from a claim's re-executed verdict.
export function resolve(claim, { market, yesWhen }) {
  const v = verifyLevel1(claim); // re-execute the claim; the resolution is only valid if it reproduces
  const outcome = yesWhen.includes(claim.verdict.flag) ? 'YES' : 'NO';
  return {
    schema: 'vesper.resolution/v0',
    market,                        // the human market question
    resolved: outcome,             // YES | NO — the payout-controlling answer
    reproduces: v.ok,              // did the claim's verdict re-execute cleanly?
    basis: { claim_id: claim.claim_id, claim_type: claim.claim_type, verdict: claim.verdict.flag },
    settlement: 'bond.mjs: the side matching this re-executed outcome captures the stake; a disputer who re-executes to the SAME outcome wins, a false resolver is slashed. The resolver puts no faith in a vote — only in re-execution.',
    reproduce: 'node verify.mjs <claim.json>   # anyone reproduces this resolution offline',
    residual_trust: 'the claim\'s inputs (recorder on-chain root / N-of-M attestation); the RESOLUTION logic itself is trustless re-execution',
  };
}

// ── CLI: mint the founding reference-resolution corpus from live claims ────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  mkdirSync(new URL('./resolutions/', import.meta.url), { recursive: true });

  const CASES = [
    {
      file: 'jupiter-spyx-cmls',
      claim: load('./claims/jupiter-spyx-cmls.json'),
      market: 'Does Jupiter Lend liquidate SPYx soundly across the closed-market weekend window (a market-status guard prevents liquidation against a price the regulated market never printed)?',
      yesWhen: ['GREEN'], // sound only if guarded
    },
    {
      file: 'marinade-solvency',
      claim: load('./claims/marinade-solvency.json'),
      market: 'Is Marinade (mSOL) solvent — is its claimed backing, recomputed from chain state, ≥ its liability with no stale records?',
      yesWhen: ['GREEN'],
    },
  ];

  console.log(`\nVesper — reference resolutions (re-execution as the neutral resolver)\n`);
  for (const c of CASES) {
    const r = resolve(c.claim, { market: c.market, yesWhen: c.yesWhen });
    writeFileSync(new URL(`./resolutions/${c.file}.json`, import.meta.url), JSON.stringify(r, null, 2) + '\n');
    const mark = r.resolved === 'YES' ? '✅ YES' : '❌ NO';
    console.log(`  ${mark}  ${r.market.slice(0, 68)}…`);
    console.log(`        basis: ${r.basis.verdict} (${r.basis.claim_type}) · reproduces: ${r.reproduces} · ${r.basis.claim_id}`);
    console.log(`        → resolutions/${c.file}.json\n`);
  }
  console.log(`  These are reproducible reference resolutions: re-run verify.mjs and get the same answer.`);
  console.log(`  Live-capital bonding on a live market is the next step (needs capital + venue).\n`);
}

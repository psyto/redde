// Vesper — verify (M1). The "Don't trust, re-execute" tool.
//
// Hand anyone a claim.json + this file. They reproduce the verdict themselves. No trust in Vesper,
// in an oracle, or in a reported number. Two independent levels:
//
//   Level 1 (offline, zero-dep):  re-execute the deterministic verdict from the observations the
//       claim embeds, and confirm the content hash. Proves "given these observations, the verdict
//       is FORCED." Runs in milliseconds with no network.
//   Level 2 (--fetch, needs RPC): re-pull the observations from Solana over the pinned window and
//       confirm they match what the claim embedded. Proves "these observations are AUTHENTIC."
//
// L1 covers the computation; L2 covers the input authenticity. Together = airtight.

import { readFileSync } from 'node:fs';
import { fetchUpdateTimes } from './weekend-liveness.mjs';
import { claimId, reexecCmls, reexecSolvency } from './claim.mjs';

// Re-execute the verdict from the claim's embedded inputs (pure, offline). Dispatches on claim_type,
// running the SAME re-derivation core the emitter used — one harness, N invariants.
export function verifyLevel1(claim) {
  let flag, checks;
  if (claim.claim_type === 'closed-market-liquidation-soundness') {
    const r = reexecCmls(claim.inputs.observed.update_times); flag = r.flag;
    checks = [
      ['liveness signal reproduces', r.computation.signal === claim.computation.signal, `${r.computation.signal} vs ${claim.computation.signal}`],
      ['closed-window updates reproduce', r.computation.closedUpdates === claim.computation.closedUpdates, `${r.computation.closedUpdates} vs ${claim.computation.closedUpdates}`],
      ['max gap reproduces', r.computation.maxGapMin === claim.computation.maxGapMin, `${r.computation.maxGapMin} vs ${claim.computation.maxGapMin}`],
    ];
  } else if (claim.claim_type === 'reserve-solvency') {
    const r = reexecSolvency(claim.inputs.observed.quantities); flag = r.flag;
    checks = [
      ['backing ≥ liability reproduces', r.computation.inv1_ok === claim.computation.inv1_ok, `${r.computation.inv1_ok} vs ${claim.computation.inv1_ok}`],
      ['redeemable-backing check reproduces', r.computation.inv2b_ok === claim.computation.inv2b_ok, `${r.computation.inv2b_ok} vs ${claim.computation.inv2b_ok}`],
      ['no-stale-records reproduces', r.computation.stale_ok === claim.computation.stale_ok, `${r.computation.stale_ok} vs ${claim.computation.stale_ok}`],
    ];
  } else {
    return { flag: 'UNKNOWN', checks: [['unknown claim_type', false, claim.claim_type]], ok: false };
  }
  checks.push(['verdict flag reproduces', flag === claim.verdict.flag, `${flag} vs ${claim.verdict.flag}`]);
  checks.push(['claim_id (content hash) matches body', claimId(claim) === claim.claim_id, claim.claim_id]);
  return { flag, checks, ok: checks.every((c) => c[1]) };
}

// Re-pull the observations from chain over the claim's pinned window and compare (needs RPC).
export async function verifyLevel2(claim, rpcUrl) {
  const w = claim.inputs.window;
  const fetched = await fetchUpdateTimes(claim.inputs.observed.account, { rpcUrl, from: w.from_ts, to: w.to_ts });
  const embedded = claim.inputs.observed.update_times;
  const match = fetched.length === embedded.length && fetched.every((t, i) => t === embedded[i]);
  return { fetched: fetched.length, embedded: embedded.length, match };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  const doFetch = process.argv.includes('--fetch');
  if (!path) { console.error('usage: node verify.mjs <claim.json> [--fetch]'); process.exit(2); }
  const claim = JSON.parse(readFileSync(path, 'utf8'));
  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', STALE: '🟡', UNKNOWN: '❓' };
  const subj = claim.subject.venue || claim.subject.protocol || '';
  const w = claim.inputs.window;
  const wStr = w.from_iso ? `${w.from_iso} → ${w.to_iso}` : `epoch ${w.epoch}${w.snapshotSlot ? ` @ slot ${w.snapshotSlot}` : ''}`;

  console.log(`\nVesper verify · ${subj} ${claim.subject.asset} · ${claim.claim_type}`);
  console.log(`  invariant: ${claim.invariant.id} — ${claim.invariant.statement}`);
  console.log(`  window:    ${wStr}`);
  console.log(`  claimed:   ${emoji[claim.verdict.flag]} ${claim.verdict.flag}\n`);

  console.log('  Level 1 — re-execute the verdict from embedded inputs (offline):');
  const l1 = verifyLevel1(claim);
  for (const [label, ok, detail] of l1.checks) console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (${detail})`}`);
  console.log(`    → reproduced verdict: ${emoji[l1.flag]} ${l1.flag}\n`);

  let l2ok = true;
  const canFetch = claim.claim_type === 'closed-market-liquidation-soundness' && claim.inputs.observed.account;
  if (doFetch && canFetch) {
    const rpcUrl = process.env.RPC || 'https://api.mainnet-beta.solana.com';
    console.log(`  Level 2 — re-pull observations from chain (${rpcUrl}):`);
    try {
      const l2 = await verifyLevel2(claim, rpcUrl);
      l2ok = l2.match;
      console.log(`    ${l2ok ? 'PASS' : 'FAIL'}  observations authentic  (fetched ${l2.fetched} vs embedded ${l2.embedded})\n`);
    } catch (e) { l2ok = false; console.log(`    FAIL  fetch error: ${e.message}\n`); }
  } else if (doFetch) {
    console.log(`  Level 2 — re-compute inputs on-chain:  ${claim.reproduce.level2_onchain.split('#')[0].trim()}\n`);
  } else {
    console.log('  Level 2 — skipped (pass --fetch to re-pull inputs from chain).\n');
  }

  const ok = l1.ok && l2ok;
  console.log(`  ${ok ? '✅ VERIFIED' : '❌ NOT VERIFIED'} — ${ok ? 'the verdict reproduces from the claim.' : 'a check failed above.'}\n`);
  process.exit(ok ? 0 : 1);
}

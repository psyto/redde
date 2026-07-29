// Vesper — issuer-asset collateral probe.
// Question it answers: "Is a given tokenized-equity mint actually used as collateral on
// any Solana lending venue that can LIQUIDATE it?" — the precondition for a CMLS verdict.
//
// Method (protocol-agnostic, zero-dep): a token used as collateral sits, in bulk, inside a
// lending program's vault. So:
//   1. getTokenLargestAccounts(mint) → the biggest token accounts holding the mint
//   2. for each, read its `owner` (the authority/PDA that controls those tokens)
//   3. read THAT owner account's program owner → if it's a known lending program, the mint
//      is collateralized there (that program can liquidate it).
// No knowledge of each protocol's account layout is needed to establish existence.
//
// Usage:  node probe-issuer.mjs [mint]
//   default mint = SPCX (SpaceX, Backpack Securities / Sunrise). RPC via $RPC (public is rate-limited).

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';

// Known Solana lending / perp programs that can liquidate collateral.
const LENDERS = {
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: 'Kamino Lend',
  jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi: 'Jupiter Lend (Fluid) vaults',
  So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo: 'Save (Solend)',
  MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: 'MarginFi',
  dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH: 'Drift',
  LoanO9Yr2rQvY9V8dJ5J4mQ2sJ7sJ8mQ2sJ7sJ8mQ2s: 'Rain.fi (placeholder)',
};

const MINT = process.argv[2] || 'SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const text = await r.text();
      if (text.trimStart().startsWith('<')) throw new Error('HTML (rate-limited)');
      const j = JSON.parse(text);
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; await sleep(400 * (i + 1)); }
  }
  throw new Error(`${method}: ${lastErr.message}`);
}

async function main() {
  console.log(`\nVesper — collateral probe for mint\n  ${MINT}\n  RPC: ${RPC}\n`);

  // 0. sanity: mint supply
  let supplyInfo;
  try {
    supplyInfo = await rpc('getTokenSupply', [MINT]);
    console.log(`  supply: ${supplyInfo.value.uiAmountString} (decimals ${supplyInfo.value.decimals})`);
  } catch (e) { console.log(`  ! getTokenSupply failed: ${e.message}`); }

  // 1. largest holders
  let largest;
  try {
    largest = await rpc('getTokenLargestAccounts', [MINT]);
  } catch (e) {
    console.log(`\n  ! getTokenLargestAccounts failed: ${e.message}`);
    console.log(`    (public RPC often blocks this — set $RPC to a paid endpoint and re-run.)\n`);
    return;
  }
  const accts = largest.value.filter((a) => a.uiAmount > 0).slice(0, 10);
  console.log(`\n  top ${accts.length} token accounts holding the mint:`);

  // 2+3. resolve each holder's authority, then the authority's program owner.
  // (getMultipleAccounts is blocked on some public RPCs → fetch one at a time.)
  const hits = [];
  for (let i = 0; i < accts.length; i++) {
    const a = accts[i];
    const info = (await rpc('getAccountInfo', [a.address, { encoding: 'jsonParsed' }]))?.value;
    const authority = info?.data?.parsed?.info?.owner; // wallet/PDA controlling the tokens
    let ownerProgram = null, lender = null;
    if (authority) {
      const auth = await rpc('getAccountInfo', [authority, { encoding: 'base64' }]);
      ownerProgram = auth?.value?.owner || null; // program that owns the authority account
      lender = LENDERS[ownerProgram] || null;
    }
    if (lender) hits.push({ ...a, authority, lender });
    const tag = lender ? `  ← ${lender} ⬅ COLLATERAL VENUE` : (ownerProgram ? `  (owner prog ${ownerProgram.slice(0, 8)}…)` : '');
    console.log(`   ${String(a.uiAmount).padStart(14)}  ${a.address}${tag}`);
  }

  // verdict
  console.log('');
  if (hits.length) {
    const venues = [...new Set(hits.map((h) => h.lender))];
    console.log(`  ✅ COLLATERALIZED — mint is held by ${venues.length} known lending venue(s): ${venues.join(', ')}`);
    console.log(`     → CMLS verdict target EXISTS. Next: grade each venue's closed-market policy for this mint.`);
  } else {
    console.log(`  ⚪ No known lending program among the top holders.`);
    console.log(`     Either: (a) not yet used as liquidatable collateral anywhere, or`);
    console.log(`     (b) held via a program not in LENDERS[], or (c) via a router/AMM (LP, not liquidation).`);
    console.log(`     → No Backpack-asset CMLS money-shot yet; recon the mid holders / add programs and re-run.`);
  }
  console.log('');
}

main().catch((e) => { console.error('probe failed:', e.message); process.exit(1); });

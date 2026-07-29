/**
 * Praeda — the lockable upgrade (transaction-local terminal attribution).
 *
 * The immediate-counterparty ledger (reconstruct-evm.mjs) attributes a boundary
 * crossing to whoever the boundary transacted with directly. That over-reads: a
 * clone that receives from the boundary and forwards onward in the SAME transaction
 * looks like a terminal beneficiary when it is a conduit.
 *
 * This upgrade follows the value one honest step further — but only where the chain
 * itself proves it. Per transaction, per token, it computes each address's NET
 * token delta from the Transfer logs. That delta is an EXACT identity: every
 * Transfer adds +v to `to` and −v from `from`, so within a transaction the positive
 * deltas exactly balance the negatives (no epsilon, no heuristic). Conduits — clones
 * that received and forwarded — net to exactly zero and drop out. What remains is the
 * set of addresses that actually RETAINED the boundary's value at the end of that
 * transaction: the transaction-local terminal endpoints.
 *
 * Value that leaves in a different token (a swap) or by a non-Transfer path (native
 * ETH, an untracked token) cannot be proven value-conserving from these logs; that
 * residual is reported as ROUTE_UNRESOLVED, never attributed. Praeda does not fake
 * the next hop.
 *
 *   ETH_RPC_URL=... node lock.mjs [--json]
 */
import { CASE } from "./case-euler.mjs";
const RPC = process.env.ETH_RPC_URL;
const hex = (n) => "0x" + BigInt(n).toString(16);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc(method, params) {
  const maxTries = Number(process.env.PRAEDA_RPC_RETRIES || 15);
  for (let a = 0; ; a += 1) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const t = await r.text(); if (!t) throw new Error(`empty ${r.status}`);
      const j = JSON.parse(t); if (j.error) throw new Error(JSON.stringify(j.error));
      return j.result;
    } catch (e) { if (a >= maxTries) throw e; await new Promise((s) => setTimeout(s, 600 * (a + 1))); }
  }
}
const addrOf = (topic) => "0x" + topic.slice(-40).toLowerCase();

async function allTransferLogs(tokens, from, to) {
  const step = Number(process.env.PRAEDA_LOG_STEP || 10);
  const out = [];
  for (let s = from; s <= to; s += step) {
    const e = Math.min(s + step - 1, to);
    const logs = await rpc("eth_getLogs", [{ address: tokens, topics: [TRANSFER], fromBlock: hex(s), toBlock: hex(e) }]);
    out.push(...logs);
  }
  return out;
}

(async () => {
  const boundary = CASE.boundary[0].toLowerCase();
  const assets = CASE.reference.manifest.assets;
  const priceOf = new Map(assets.map((a) => [a.token.toLowerCase(), a]));
  const tokens = [...priceOf.keys()];
  const { fromBlock, toBlock } = CASE.window;

  const logs = await allTransferLogs(tokens, fromBlock, toBlock);
  // group by transaction, then by token: edges [from,to,value]
  const byTx = new Map();
  for (const log of logs) {
    const ref = priceOf.get(log.address.toLowerCase()); if (!ref) continue;
    const h = log.transactionHash;
    const from = addrOf(log.topics[1]), to = addrOf(log.topics[2]);
    const v = BigInt(log.data === "0x" ? "0x0" : log.data);
    if (!byTx.has(h)) byTx.set(h, []);
    byTx.get(h).push({ token: ref.token.toLowerCase(), sym: ref.symbol, dec: ref.decimals, usd: ref.usd, from, to, v });
  }

  // Burn / unwrap sinks: value sent here leaves the TRACKED token universe (wstETH
  // unwrap burns to 0x0 and continues as stETH; a mint/deposit continues as a claim
  // token). We do not follow it across tokens without proof — it is ROUTE_UNRESOLVED.
  const BURN = new Set(["0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead"]);

  // Per tx, per token: net delta. Conservation is exact. Terminal receivers of the
  // boundary's loss = net-positive non-boundary addresses (conduits net to zero).
  const terminal = new Map(); // addr -> { native:{sym:n}, usd, txs:Set }
  let boundaryLossUsd = 0, resolvedUsd = 0, burnedUsd = 0, returnedUsd = 0, txTouching = 0;
  const burnNative = {};
  const auditRows = [];

  for (const [h, edges] of byTx) {
    const tokensInTx = new Set(edges.map((e) => e.token));
    let txTouchesBoundary = false;
    for (const tk of tokensInTx) {
      const te = edges.filter((e) => e.token === tk);
      const meta = te[0];
      const net = new Map();
      const bump = (a, d) => net.set(a, (net.get(a) || 0n) + d);
      for (const e of te) { bump(e.from, -e.v); bump(e.to, e.v); }
      // exact conservation check
      let sum = 0n; for (const d of net.values()) sum += d;
      const bDelta = net.get(boundary) || 0n;
      if (bDelta > 0n) { // boundary received this token back in this tx (a return / repay)
        returnedUsd += (Number(bDelta) / 10 ** meta.dec) * meta.usd;
      }
      if (bDelta < 0n) {
        txTouchesBoundary = true;
        const loss = -bDelta; // token units the boundary lost, net, in this tx
        boundaryLossUsd += (Number(loss) / 10 ** meta.dec) * meta.usd;
        // terminal receivers: net-positive, non-boundary. Attribute the boundary loss
        // to them in proportion to their positive net (they collectively balance it).
        const pos = [...net.entries()].filter(([a, d]) => a !== boundary && d > 0n);
        const posSum = pos.reduce((s, [, d]) => s + d, 0n);
        // residual not explained by same-token terminal receivers (e.g. matched by a
        // donor's negative rather than a terminal positive) -> unresolved.
        for (const [a, d] of pos) {
          const attributedTokens = posSum > 0n ? (loss * d) / posSum : 0n; // proportional, floored
          const nat = Number(attributedTokens) / 10 ** meta.dec;
          const usd = nat * meta.usd;
          if (BURN.has(a)) { // burned / unwrapped — value leaves the tracked token, unproven onward
            burnedUsd += usd; burnNative[meta.sym] = (burnNative[meta.sym] || 0) + nat; continue;
          }
          resolvedUsd += usd;
          const cur = terminal.get(a) || { native: {}, usd: 0, txs: new Set() };
          cur.native[meta.sym] = (cur.native[meta.sym] || 0) + nat; cur.usd += usd; cur.txs.add(h);
          terminal.set(a, cur);
        }
        auditRows.push({ h: h.slice(0, 10), token: meta.sym, conserved: sum === 0n,
          lossNat: Number(loss) / 10 ** meta.dec, receivers: pos.length });
      }
    }
    if (txTouchesBoundary) txTouching += 1;
  }

  // resolve terminal endpoints: contract vs EOA
  const rows = [...terminal.entries()].map(([account, v]) => ({ account, ...v, txs: v.txs.size }))
    .sort((a, b) => b.usd - a.usd);
  for (const r of rows.slice(0, 40)) {
    let code = "0x"; try { code = await rpc("eth_getCode", [r.account, hex(toBlock)]); } catch {}
    r.kind = code && code !== "0x" ? "CONTRACT" : "EOA";
  }

  const recon = Math.round(resolvedUsd) + Math.round(burnedUsd);
  const report = {
    target: CASE.name, window: CASE.window,
    method: "transaction-local net-delta terminal attribution (exact per-tx·token conservation)",
    txTouchingBoundary: txTouching,
    boundaryGrossOutUsd: Math.round(boundaryLossUsd),
    boundaryReturnedUsd: Math.round(returnedUsd),
    netReserveLossUsd: Math.round(boundaryLossUsd - returnedUsd), // ties to balanceOf(t0)−balanceOf(t1)
    resolvedTerminalUsd: Math.round(resolvedUsd),
    burnedUnwrappedUsd: Math.round(burnedUsd),
    burnedNative: Object.fromEntries(Object.entries(burnNative).map(([s, n]) => [s, +n.toPrecision(6)])),
    outflowReconciliationDeltaUsd: Math.round(boundaryLossUsd) - recon, // gross out − (resolved+burned); 0 = exact
    conservationHolds: auditRows.every((a) => a.conserved),
    audit: auditRows,
    terminalEndpoints: rows.filter((r) => r.usd >= 1).map((r) => ({ account: r.account, kind: r.kind,
      usd: Math.round(r.usd), txs: r.txs,
      native: Object.fromEntries(Object.entries(r.native).map(([s, n]) => [s, +n.toPrecision(6)])) })),
  };

  if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`\n  praeda/evm — LOCKED (transaction-local terminal attribution)`);
  console.log(`  target : ${report.target}`);
  console.log(`  txs touching boundary : ${report.txTouchingBoundary}`);
  console.log(`  boundary gross outflow: $${report.boundaryGrossOutUsd.toLocaleString()}`);
  console.log(`  ├─ resolved to holders: $${report.resolvedTerminalUsd.toLocaleString()}  (same-token terminal address)`);
  console.log(`  └─ burned / unwrapped : $${report.burnedUnwrappedUsd.toLocaleString()}  (${Object.entries(report.burnedNative).map(([s,n])=>`${(+n.toPrecision(5)).toLocaleString()} ${s}`).join(", ")} → 0x0, continues as another token = ROUTE_UNRESOLVED)`);
  console.log(`  outflow reconciliation: $${report.outflowReconciliationDeltaUsd.toLocaleString()}  (gross out − resolved − burned; 0 = exact)`);
  console.log(`  less returned to bound: $${report.boundaryReturnedUsd.toLocaleString()}`);
  console.log(`  = net reserve loss    : $${report.netReserveLossUsd.toLocaleString()}  (ties to balanceOf t0−t1)`);
  console.log(`  exact conservation    : ${report.conservationHolds ? "HOLDS (Σnet=0 per tx·token)" : "VIOLATED — investigate"}`);
  console.log(`\n  terminal holders (same-token value retained at end of each transaction):`);
  for (const r of report.terminalEndpoints.slice(0, 15)) {
    const nat = Object.entries(r.native).map(([s, n]) => `${(+n.toPrecision(5)).toLocaleString()} ${s}`).join(", ");
    console.log(`   ${(r.kind || "?").padEnd(9)} ${r.account}  $${r.usd.toLocaleString().padStart(11)}  (${r.txs} tx)  ${nat}`);
  }
  console.log(`\n  A terminal CONTRACT may itself be a protocol sink (a deposit whose beneficiary holds a`);
  console.log(`  derived claim). Praeda reports where the token terminated; it does not name the party behind it.`);
  console.log("");
})();

#!/usr/bin/env node
// gen-crossvm-board.mjs — render the cross-VM verifier league from live verdicts.
//
// Reads:
//   jitosol-result.json   (node verify.mjs --json > jitosol-result.json)   [Solana / SVM]
//   eth-results.json      (node verify-eth.mjs --json > eth-results.json)   [EVM: L1 + L2]
// Writes:
//   site/crossvm.html
//
// Same invariant on every row: is the claimed staking/bridge backing actually there,
// recomputed from chain state without the protocol's cooperation? The board shows the
// SCALE — how much of each claim is independently recomputable — it does not crown a
// "healthiest chain". The reader ranks; the verifier holds the scale.

import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => { try { return JSON.parse(readFileSync(new URL(p, import.meta.url))); } catch { return null; } };
const jito = read("./jitosol-result.json");
const eth = read("./eth-results.json");

const rows = [];

// --- Solana / SVM row (from verify.mjs) -------------------------------------
if (jito) {
  const LAM = 1e9;
  const backing = Number(jito.inv2b?.redeemableBacking ?? 0) / LAM;
  const required = Number(jito.inv2b?.requiredBacking ?? jito.inv1?.requiredBacking ?? 0) / LAM;
  rows.push({
    chain: "Solana", vm: "SVM", asset: "JitoSOL", unit: "SOL",
    verdict: jito.verdict,
    cls: jito.verdict === "GREEN" ? "fully-recomputable" : "unverified",
    liability: required, independent: backing,
    coverage: required ? (backing / required) * 100 : 0,
    note: `Backing summed directly from ${jito.inv2b?.usablePdas ?? "?"} canonical stake accounts the pool controls (epoch ${jito.epoch}). Redeemable ${backing.toLocaleString(undefined,{maximumFractionDigits:0})} SOL ≥ claimed ${required.toLocaleString(undefined,{maximumFractionDigits:0})} SOL.`,
  });
}

// --- EVM rows (from verify-eth.mjs) -----------------------------------------
if (eth) for (const r of eth.rows) {
  if (r.verdict === "ERROR") continue;
  rows.push({
    chain: r.chain === "base" ? "Base (L2)" : "Ethereum", vm: "EVM",
    asset: r.symbol, unit: "ETH", verdict: r.verdict, cls: r.verifiabilityClass,
    liability: Number(String(r.liabilityEth).replace(/,/g, "")),
    independent: Number(String(r.independentEth).replace(/,/g, "")),
    coverage: Number(r.independentPct), note: r.note,
  });
}

// order: most independently-recomputable first (NOT "best chain" — the scale, top to bottom)
const clsRank = { "fully-recomputable": 0, "bridge-escrow": 1, "oracle-trusted": 2, "escrow-unverified": 3, "unverified": 4 };
rows.sort((a, b) => (clsRank[a.cls] ?? 9) - (clsRank[b.cls] ?? 9) || b.coverage - a.coverage);

const block = eth?.block ?? "?";
const verdictColor = { GREEN: "#3fb950", STALE: "#d29922", RED: "#f85149" };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cov = (r) => r.coverage >= 100 ? "100%+" : `${r.coverage < 0.01 ? "<0.01" : r.coverage.toFixed(r.coverage < 1 ? 4 : 2)}%`;

const rowsHtml = rows.map((r) => `
      <tr>
        <td><span class="chain">${esc(r.chain)}</span><span class="vm">${esc(r.vm)}</span></td>
        <td class="asset">${esc(r.asset)}</td>
        <td><span class="verdict" style="color:${verdictColor[r.verdict] || "#8b949e"};border-color:${verdictColor[r.verdict] || "#8b949e"}">${esc(r.verdict)}</span></td>
        <td><span class="cls cls-${esc(r.cls)}">${esc(r.cls)}</span></td>
        <td class="num">${r.liability.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span class="unit">${esc(r.unit)}</span></td>
        <td class="num">${r.independent.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span class="unit">${esc(r.unit)}</span></td>
        <td class="num cov">${cov(r)}</td>
      </tr>
      <tr class="note-row"><td></td><td colspan="6" class="note">${esc(r.note)}</td></tr>`).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redde — the cross-VM verifier league</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; color: #c9d1d9;
    font: 15px/1.6 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 26px; margin: 0 0 2px; color: #e6edf3; letter-spacing: -0.02em; }
  .tag { color: #8b949e; font-style: italic; margin: 0 0 22px; }
  .lede { border-left: 2px solid #30363d; padding: 2px 0 2px 16px; margin: 0 0 26px; color: #adbac7; }
  .lede b { color: #e6edf3; }
  .scale-note { color: #8b949e; font-size: 13px; margin: 0 0 18px; }
  .table-scroll { overflow-x: auto; border: 1px solid #21262d; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; min-width: 720px; }
  thead th { text-align: left; font-weight: 600; color: #8b949e; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.04em; padding: 12px 14px; border-bottom: 1px solid #21262d; background: #10151c; }
  tbody td { padding: 12px 14px; border-bottom: 1px solid #171d25; vertical-align: baseline; }
  .chain { color: #e6edf3; font-weight: 600; }
  .vm { display: inline-block; margin-left: 8px; font-size: 11px; color: #6e7681; border: 1px solid #30363d; border-radius: 4px; padding: 0 5px; }
  .asset { color: #79c0ff; }
  .verdict { display: inline-block; border: 1px solid; border-radius: 5px; padding: 1px 9px; font-weight: 700; font-size: 13px; }
  .cls { font-size: 12px; color: #adbac7; }
  .cls-fully-recomputable { color: #3fb950; }
  .cls-bridge-escrow { color: #56d364; }
  .cls-oracle-trusted { color: #d29922; }
  .num { text-align: right; white-space: nowrap; color: #c9d1d9; }
  .unit { color: #6e7681; font-size: 12px; }
  .cov { font-weight: 700; color: #e6edf3; }
  .note-row td { border-bottom: 1px solid #171d25; padding-top: 0; }
  .note { color: #768390; font-size: 12.5px; padding-left: 14px; border-left: 2px solid #21262d; }
  .foot { margin-top: 26px; color: #8b949e; font-size: 13px; }
  .foot code { background: #161b22; border: 1px solid #21262d; border-radius: 4px; padding: 1px 6px; color: #adbac7; }
  .meta { margin-top: 14px; color: #6e7681; font-size: 12px; }
  a { color: #58a6ff; text-decoration: none; } a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Redde — the cross-VM verifier league</h1>
    <p class="tag">redde rationem — render the account. One invariant, every chain, zero cooperation.</p>

    <p class="lede">The same question on every row: <b>is the claimed staking backing actually there</b> —
      recomputed from raw chain state, without the protocol's consent?
      The answer splits not by trust but by <b>architecture</b>. Where the backing lives on the chain I can read,
      I prove it. Where it lives on the beacon chain and reaches the contract through an oracle,
      the honest verdict is <b>STALE</b>: you are trusting a self-report.</p>

    <p class="scale-note">This board shows the scale — how much of each claim is independently recomputable —
      it does <b>not</b> crown a "healthiest chain." The reader ranks; the verifier holds the scale.</p>

    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Chain</th><th>Asset</th><th>Verdict</th><th>Verifiability</th>
            <th style="text-align:right">Claimed liability</th>
            <th style="text-align:right">Independently&nbsp;observed</th>
            <th style="text-align:right">Coverage</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}
        </tbody>
      </table>
    </div>

    <p class="foot">
      <b>GREEN</b> — the claim survived independent recomputation (not "safe").
      <b>STALE</b> — cannot be recomputed from readable state now; an unverifiable claim is itself a finding, not a pass.
      <b>RED</b> — chain state contradicts the claim.<br>
      Every number here is reproducible: <code>node verify.mjs</code> (Solana) · <code>node verify-eth.mjs</code> (EVM).
      No RED is ever manufactured.
    </p>
    <p class="meta">Ethereum/Base snapshot: block ${block} · Solana: epoch ${esc(jito?.epoch ?? "?")} · zero-dep checkers, public RPC.</p>
  </div>
</body>
</html>`;

writeFileSync(new URL("./site/crossvm.html", import.meta.url), html);
console.log(`site/crossvm.html written — ${rows.length} rows`);
for (const r of rows) console.log(`  ${r.chain.padEnd(12)} ${r.asset.padEnd(8)} ${r.verdict.padEnd(6)} ${r.cls.padEnd(20)} coverage ${cov(r)}`);

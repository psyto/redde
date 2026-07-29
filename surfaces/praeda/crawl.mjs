/**
 * Praeda — Slice 1 crawler (Phase 1: window signatures).
 *
 * Alchemy (and any plain Solana RPC) has no slot-bounded history query, so we
 * reach the 2025-02-14 window by paging getSignaturesForAddress backward from now
 * to the vault's genesis, storing only the signatures inside the window. Resumable
 * (cursor persisted) and rate-limit-resilient (exponential backoff on 403/429).
 *
 *   SOLANA_RPC_URL=... node crawl.mjs
 *
 * Output: data/window-usdc-sigs.jsonl  (one {signature,slot,blockTime} per line,
 *         window only) and data/crawl-state.json (resume cursor + counters).
 *
 * This only collects signatures — no interpretation, no attribution. Phase 2
 * (reconstruct.mjs) reads these to compute the USDC-vault drawdown curve and, per
 * counterparty, net boundary flow E and commitment timing L. See SPEC.md.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";

const RPC = process.env.SOLANA_RPC_URL;
if (!RPC) { console.error("set SOLANA_RPC_URL"); process.exit(1); }

// Case-parameterized boundary (defaults to LIBRA/USDC so legacy runs are unchanged).
// A gallery case sets PRAEDA_CASE + PRAEDA_VAULT + the window bounds via env.
const CASE = process.env.PRAEDA_CASE || "";
const pfx = CASE ? `${CASE}-` : "";
const VAULT = process.env.PRAEDA_VAULT || "3nSdqiF5Cxd22r8h6Ti1TwzDmcVN6SgFfDcWbBtCFRdc";

// Window (UTC, generous — refine t0/t1 later from the drawdown curve). Store sigs
// at/older than STORE_BEFORE, stop once older than STOP_BEFORE (= vault genesis).
const STORE_BEFORE = Number(process.env.PRAEDA_STORE_BEFORE || 1739664000); // dflt 2025-02-16
const STOP_BEFORE  = Number(process.env.PRAEDA_STOP_BEFORE  || 1739491200); // dflt 2025-02-14
const MAX_PAGES = 20000;         // safety backstop (20M sigs)

const DIR = new URL("./data/", import.meta.url);
if (!existsSync(DIR)) mkdirSync(DIR);
const STATE = new URL(`./data/${pfx}crawl-state.json`, import.meta.url);
const OUT = new URL(`./data/${pfx}window-usdc-sigs.jsonl`, import.meta.url);

import { makeCrawlRpc } from "../../core/rpc.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// crawler rpc (aggressive backoff; crawl throws on exhaustion) now from ../../core.
const rpc = makeCrawlRpc(RPC, { baseDelayMs: 800, throwOnExhaust: true });

let state = { cursor: null, pages: 0, stored: 0, oldestSeen: null, reachedGenesis: false };
if (existsSync(STATE)) { state = JSON.parse(readFileSync(STATE, "utf8")); console.log("resume", state); }

const iso = (bt) => (bt ? new Date(bt * 1000).toISOString() : "?");

while (state.pages < MAX_PAGES && !state.reachedGenesis) {
  const opts = { limit: 1000, ...(state.cursor ? { before: state.cursor } : {}) };
  const res = await rpc("getSignaturesForAddress", [VAULT, opts]);
  if (!Array.isArray(res) || res.length === 0) {
    state.reachedGenesis = true;
    console.log(`page ${state.pages}: empty — reached vault genesis`);
    break;
  }
  let stored = 0;
  for (const s of res) {
    const bt = s.blockTime ?? 0;
    if (bt <= STORE_BEFORE && bt >= STOP_BEFORE) {
      appendFileSync(OUT, JSON.stringify({ signature: s.signature, slot: s.slot, blockTime: bt }) + "\n");
      stored++;
    }
  }
  const oldest = res[res.length - 1];
  state.cursor = oldest.signature;
  state.oldestSeen = oldest.blockTime ?? state.oldestSeen;
  state.stored += stored;
  state.pages++;
  if (state.pages % 10 === 0 || stored > 0) {
    console.log(`page ${state.pages}: oldest=${iso(oldest.blockTime)} stored+=${stored} total=${state.stored}`);
    writeFileSync(STATE, JSON.stringify(state));
  }
  // Stop once we've paged past the window's old edge (vault genesis).
  if ((oldest.blockTime ?? 0) < STOP_BEFORE) {
    state.reachedGenesis = true;
    console.log(`page ${state.pages}: oldest ${iso(oldest.blockTime)} < window start — done`);
    break;
  }
}

writeFileSync(STATE, JSON.stringify(state));
console.log(`\nDONE  pages=${state.pages}  window sigs stored=${state.stored}  reachedGenesis=${state.reachedGenesis}`);

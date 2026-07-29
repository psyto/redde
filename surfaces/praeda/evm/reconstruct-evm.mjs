/**
 * Praeda — EVM boundary-flow reconstructor (Slice 1, EVM leg).
 *
 *   Collapse leaves a transfer record. Praeda reconstructs it.
 *
 * The EVM sibling of ../reconstruct.mjs. Same SPEC (../SPEC.md), same two measures
 * (net boundary outflow E, drawdown timing L), same node classes, same honesty
 * boundary. Only the substrate changes: on EVM a boundary is a *contract address*,
 * a boundary crossing is an ERC-20 `Transfer(address,address,uint256)` log, the
 * window W is a block range, and the drawdown curve D(t) is the boundary's reserve
 * balance read via `balanceOf` at a historical block. One engine; a second VM.
 *
 * Chain-parameterized: nothing here hardcodes Ethereum. A case pins { chainId, RPC,
 * boundary contracts, token manifest, window blocks, reference }. Point ETH_RPC_URL
 * at any EVM chain's archival endpoint and the same engine runs — the compounding
 * surface (Redde §verifier-league): one EVM leg, every EVM chain by configuration.
 *
 * Zero dependencies (Node 18+ built-in fetch). Reads only; no protocol cooperation.
 *
 *   ETH_RPC_URL=... node reconstruct-evm.mjs [--json] [--case ./CASE_EULER.mjs]
 *
 * HONESTY BOUNDARY (see ../SPEC.md / ../MANIFESTO.md): publishes ONLY E and L, both
 * reproducible arithmetic over recorded Transfer logs. NEVER asserts intent,
 * knowledge, identity, beneficial ownership, or guilt. When W's history is not
 * served, the verdict is UNRECONSTRUCTED — never a guess.
 */

const RPC = process.env.ETH_RPC_URL || "";

// The one canonical constant shared by every ERC-20 on every EVM chain:
//   keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// balanceOf(address) selector.
const BALANCEOF_SELECTOR = "0x70a08231";

// ---- case loading ------------------------------------------------------------
// Default case pins the Euler Finance 2023-03-13 boundary-flow reconstruction —
// chosen as the "safe first firing" exactly as Solana's leg chose an adjudicated
// case: the framing is externally settled (single well-documented exploit; the
// principal returned the funds), so Praeda's result is a small, separate,
// reproducible claim next to a settled public record. See CASE_EULER.md.
const caseArg = argValue("--case");
const CASE = caseArg
  ? (await import(new URL(caseArg, import.meta.url))).CASE
  : (await import(new URL("./case-euler.mjs", import.meta.url))).CASE;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

// ---- rpc ---------------------------------------------------------------------
async function rpc(method, params) {
  if (!RPC) throw new Error("ETH_RPC_URL not set");
  const maxTries = Number(process.env.PRAEDA_RPC_RETRIES || 8);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const txt = await r.text();
      if (!txt) throw new Error(`empty body (http ${r.status})`); // e.g. throttled 429
      const j = JSON.parse(txt);
      if (j.error) {
        // Provider-side rate limits are transient; genuine RPC errors are not.
        const msg = JSON.stringify(j.error);
        if (/rate|limit|throttl|-32005|capacity|exceeded/i.test(msg) && attempt < maxTries) {
          throw new Error(`throttled: ${msg}`);
        }
        throw new Error(`${method}: ${msg}`);
      }
      return j.result;
    } catch (e) {
      const transient = /empty body|throttled|fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message);
      if (!transient || attempt >= maxTries) throw e;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
}

const hex = (n) => "0x" + BigInt(n).toString(16);
const topicOfAddress = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const addressOfTopic = (t) => "0x" + t.slice(-40).toLowerCase();

// ---- archival gate -----------------------------------------------------------
// Can this endpoint even serve W's history? A pruned/non-archival node cannot read
// balanceOf or logs at a 2022-23 block. We do NOT guess: no service → UNRECONSTRUCTED.
async function servesWindow(c) {
  if (!c.boundary?.length) return { ok: false, why: "boundary contract set not pinned" };
  if (!Number.isInteger(c.window?.fromBlock) || !Number.isInteger(c.window?.toBlock)) {
    return { ok: false, why: "window blocks not pinned with state witnesses" };
  }
  if (!validReference(c.reference)) return { ok: false, why: "reference manifest not pinned" };
  try {
    const blk = await rpc("eth_getBlockByNumber", [hex(c.window.fromBlock), false]);
    if (!blk) return { ok: false, why: "endpoint does not serve the window's block" };
    // Archival witness: a historical balanceOf must resolve, not revert as "missing trie node".
    const token = c.reference.manifest.assets[0].token;
    await callBalanceOf(token, c.boundary[0], c.window.fromBlock);
    return { ok: true };
  } catch (e) {
    return { ok: false, why: `history not served (${e.message})` };
  }
}

function validReference(reference) {
  return typeof reference?.manifest?.hash === "string"
    && Array.isArray(reference.manifest.assets)
    && reference.manifest.assets.length > 0
    && reference.manifest.assets.every((a) => a.token && Number.isInteger(a.decimals));
}

// ---- Measure 1 — net boundary outflow E --------------------------------------
// Every ERC-20 Transfer whose `from` OR `to` is a boundary contract, inside W, is a
// signed boundary crossing — no CPI attribution needed, the log *is* the record.
//   from=boundary → to=a   : value left the system to a   → E(a) += price(value)
//   from=a → to=boundary   : value entered the system      → E(a) -= price(value)
// Priced at the pinned pre-collapse reference (SPEC Measure 1), so extraction is
// measured in real value, not in the fiction the collapse briefly printed.
async function extractionByAccount(c) {
  const priceByToken = new Map(
    c.reference.manifest.assets.map((a) => [a.token.toLowerCase(), a]),
  );
  const tokens = [...priceByToken.keys()];
  const boundaryTopics = c.boundary.map(topicOfAddress);
  const intermediaries = new Set((c.intermediaries || []).map((a) => a.toLowerCase()));

  const acc = new Map(); // account -> { E:Number(usd), native:{sym:n}, events:[{block, dv}] }
  const bump = (account, usd, block, native, symbol) => {
    if (c.boundary.some((b) => b.toLowerCase() === account)) return; // ignore boundary self
    const cls = intermediaries.has(account) ? "ROUTE_UNRESOLVED" : null;
    const cur = acc.get(account) || { E: 0, native: {}, events: [], cls };
    cur.E += usd;
    cur.native[symbol] = (cur.native[symbol] || 0) + native; // per-mint vector (SPEC Measure 1)
    cur.events.push({ block, dv: usd, native });
    acc.set(account, cur);
  };

  // Outflows: boundary is `from` (topics[1]); inflows: boundary is `to` (topics[2]).
  for (const [dir, topics] of [
    ["out", [TRANSFER_TOPIC, boundaryTopics, null]],
    ["in", [TRANSFER_TOPIC, null, boundaryTopics]],
  ]) {
    const logs = await getLogsChunked(tokens, topics, c.window.fromBlock, c.window.toBlock);
    for (const log of logs) {
      const ref = priceByToken.get(log.address.toLowerCase());
      if (!ref) continue; // only priced (referenced) assets enter the USD sort
      const raw = BigInt(log.data === "0x" ? "0x0" : log.data);
      const native = Number(raw) / 10 ** ref.decimals;
      const usd = native * (ref.usd ?? 0);
      const from = addressOfTopic(log.topics[1]);
      const to = addressOfTopic(log.topics[2]);
      const block = Number(log.blockNumber);
      if (dir === "out") bump(to, +usd, block, +native, ref.symbol); // a received value out of boundary
      else bump(from, -usd, block, -native, ref.symbol); // a sent value into boundary
    }
  }

  const out = {};
  for (const [account, v] of acc) {
    const commitmentBlock = decisiveBlock(v.events, v.E);
    out[account] = { E: v.E, native: v.native, commitmentBlock, cls: v.cls };
  }
  return out;
}

// commitment block (SPEC Measure 2): first block after which cumulative net flow
// stays on the terminal side of, and at least half of, terminal E. Not the largest
// transfer — a two-sided maker's one big fill must not become its "decisive" act.
function decisiveBlock(events, terminalE) {
  const ordered = [...events].sort((a, b) => a.block - b.block);
  const sameSide = (x) => (terminalE >= 0 ? x >= terminalE / 2 : x <= terminalE / 2);
  let cum = 0;
  let candidate = ordered.at(-1)?.block ?? null;
  for (let i = 0; i < ordered.length; i += 1) {
    cum += ordered[i].dv;
    if (sameSide(cum)) {
      // confirm it never leaves the terminal half afterward
      let stays = true;
      let c2 = cum;
      for (let j = i + 1; j < ordered.length; j += 1) {
        c2 += ordered[j].dv;
        if (!sameSide(c2)) { stays = false; break; }
      }
      if (stays) { candidate = ordered[i].block; break; }
    }
  }
  return candidate;
}

async function getLogsChunked(address, topics, fromBlock, toBlock) {
  const step = Number(process.env.PRAEDA_LOG_STEP || 2000);
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = Math.min(start + step - 1, toBlock);
    const logs = await rpc("eth_getLogs", [{
      address, topics, fromBlock: hex(start), toBlock: hex(end),
    }]);
    out.push(...logs);
  }
  return out;
}

// ---- Measure 2 — drawdown curve D(t) -----------------------------------------
// Sample the boundary's headline reserve (aggregate USD balanceOf across boundary
// contracts) at S blocks across W. Normalize D(fromBlock)=0, D(toBlock)=1.
async function drawdownCurve(c) {
  const samples = Number(process.env.PRAEDA_CURVE_SAMPLES || 24);
  const { fromBlock, toBlock } = c.window;
  const blocks = Array.from({ length: samples + 1 }, (_, i) =>
    Math.round(fromBlock + ((toBlock - fromBlock) * i) / samples));
  const assets = c.reference.manifest.assets;
  const points = [];
  for (const block of blocks) {
    let usd = 0;
    for (const a of assets) {
      for (const b of c.boundary) {
        const bal = await callBalanceOf(a.token, b, block);
        usd += (Number(bal) / 10 ** a.decimals) * (a.usd ?? 0);
      }
    }
    points.push({ block, usd });
  }
  const v0 = points[0].usd;
  const v1 = points.at(-1).usd;
  const span = v0 - v1 || 1;
  const D = (block) => {
    // piecewise-linear interpolation of normalized drawdown at an arbitrary block
    let lo = points[0];
    let hiP = points.at(-1);
    for (let i = 0; i < points.length - 1; i += 1) {
      if (block >= points[i].block && block <= points[i + 1].block) {
        lo = points[i]; hiP = points[i + 1]; break;
      }
    }
    const w = hiP.block === lo.block ? 0 : (block - lo.block) / (hiP.block - lo.block);
    const usd = lo.usd + (hiP.usd - lo.usd) * w;
    return Math.min(1, Math.max(0, (v0 - usd) / span));
  };
  return { D, points };
}

async function callBalanceOf(token, holder, block) {
  const data = BALANCEOF_SELECTOR + holder.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const res = await rpc("eth_call", [{ to: token, data }, hex(block)]);
  return BigInt(res === "0x" ? "0x0" : res);
}

// ---- endpoint resolution — contract vs EOA, and bytecode clustering ----------
// A data-driven attribution aid (SPEC attribution boundary): identical bytecode is
// an on-chain fact — the same deployed template, i.e. one actor's machinery — not a
// hand-applied label. Clone-pair exploits (a "violator" and a "donor" cloned N times,
// as at Euler) collapse into a few bytecode clusters. We cluster by the raw code
// string (identical code → identical string), so no keccak dependency is needed. We
// never assert who deployed a cluster, only that its members share one bytecode.
// FNV-1a over the full code string — a zero-dep bytecode fingerprint. Identical
// bytecode ⇒ identical fp; distinct bytecode ⇒ (near-certainly) distinct fp. This
// clusters by EXACT code identity, not merely by byte length (the Solidity dispatcher
// prologue 0x60806040… is shared by nearly all contracts and must not merge them).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

async function resolveEndpoints(accounts, block) {
  const out = new Map();
  for (const a of accounts) {
    let code = "0x";
    try { code = await rpc("eth_getCode", [a, hex(block)]); } catch { /* leave as EOA-unknown */ }
    const isContract = code && code !== "0x";
    const bytes = isContract ? (code.length - 2) / 2 : 0;
    const fp = isContract ? `${bytes}b#${fnv1a(code)}` : "eoa";
    out.set(a, { kind: isContract ? "CONTRACT" : "EOA", bytes, fp });
  }
  return out;
}

// Roll the ledger up by bytecode cluster: net USD/native per cluster of identical
// contracts. This foregrounds the true net position of an exploit's clone machinery
// without following the graph past the boundary (which SPEC declines to do unproven).
function clustersOf(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = r.code?.fp ?? "unresolved";
    const c = by.get(key) || { fp: key, members: 0, E: 0, native: {}, classes: new Set() };
    c.members += 1;
    c.E += r.E;
    for (const [s, n] of Object.entries(r.native || {})) c.native[s] = (c.native[s] || 0) + n;
    c.classes.add(r.cls);
    by.set(key, c);
  }
  return [...by.values()]
    .map((c) => ({ ...c, classes: [...c.classes] }))
    .sort((a, b) => Math.abs(b.E) - Math.abs(a.E));
}

// ---- classes (the sort, not a charge) — identical to the Solana leg -----------
function classify(rows) {
  const outflows = rows.filter((r) => r.E > 0 && r.cls == null).sort((a, b) => b.E - a.E);
  const medianL = median(rows.filter((r) => r.cls == null).map((r) => r.L));
  const K = Math.max(1, Math.ceil(outflows.length * 0.05));
  return rows.map((r) => {
    if (r.cls) return r; // ROUTE_UNRESOLVED / intermediary — excluded from ranks
    if (r.E < 0) return { ...r, cls: "NET_INFLOW" };
    if (r.E === 0) return { ...r, cls: "NET_ZERO" };
    const rank = outflows.indexOf(r);
    const early = rank < K && r.L >= medianL;
    return { ...r, cls: early ? "EARLY_TOP_OUTFLOW" : "NET_OUTFLOW" };
  });
}
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- reconstruct -------------------------------------------------------------
async function reconstruct(c) {
  const gate = await servesWindow(c);
  if (!gate.ok) {
    return unreconstructed(c, gate.why);
  }
  // Serialized (not Promise.all) to avoid doubling burst against throttled endpoints.
  const ext = await extractionByAccount(c);
  const curve = await drawdownCurve(c);
  if (!ext || !curve) return unreconstructed(c, "flows across W not computable");
  let rows = classify(
    Object.entries(ext).map(([account, v]) => ({
      account, E: v.E, native: v.native, L: 1 - curve.D(v.commitmentBlock), cls: v.cls,
    })),
  );
  // Resolve each endpoint (contract vs EOA) and cluster by bytecode — unless disabled.
  if (process.env.PRAEDA_NO_CODE !== "1") {
    const codes = await resolveEndpoints(rows.map((r) => r.account), c.window.toBlock);
    rows = rows.map((r) => ({ ...r, code: codes.get(r.account) }));
  }
  rows.sort((a, b) => b.E - a.E);
  return {
    verdict: "RECONSTRUCTED",
    target: c.name,
    chainId: c.chainId,
    window: c.window,
    ledger: rows,
    clusters: clustersOf(rows),
    notes: [],
  };
}

function unreconstructed(c, why) {
  return {
    verdict: "UNRECONSTRUCTED",
    target: c.name,
    notes: [
      `UNRECONSTRUCTED: ${why}.`,
      "The specified reconstruction could not be produced from the available record — not a guess.",
    ],
  };
}

// ---- render ------------------------------------------------------------------
const json = process.argv.includes("--json");
const rep = await reconstruct(CASE).catch((err) => unreconstructed(CASE, err?.message ?? String(err)));

if (json) {
  console.log(JSON.stringify(rep, null, 2));
} else {
  console.log(`\n  praeda/evm — boundary-flow reconstruction`);
  console.log(`  target : ${rep.target}${CASE.adjudicated ? "  (framing settled)" : ""}`);
  console.log(`  chain  : ${CASE.chainId ?? "?"}`);
  console.log(`  verdict: [ ${rep.verdict} ]\n`);
  if (rep.ledger) {
    console.log("  boundary-flow ledger (E = net boundary outflow USD, reference-priced; L = timing):");
    for (const r of rep.ledger.slice(0, 20)) {
      const sign = r.E >= 0 ? "+" : "";
      const e = sign + Math.round(r.E).toLocaleString();
      const nat = Object.entries(r.native || {})
        .filter(([, n]) => Math.abs(n) > 1e-9)
        .map(([s, n]) => `${n >= 0 ? "+" : ""}${(+n.toPrecision(6)).toLocaleString()} ${s}`)
        .join(", ");
      const tag = r.code ? ` [${r.code.kind === "CONTRACT" ? r.code.fp : "EOA"}]` : "";
      console.log(`   ${(r.cls ?? "?").padEnd(18)} ${r.account}${tag}  E=$${e}  L=${r.L.toFixed(2)}`);
      if (nat) console.log(`   ${" ".repeat(18)}   ↳ ${nat}`);
    }
    if (rep.clusters && rep.clusters.length) {
      console.log("\n  bytecode clusters (identical code = one deployed template; net position):");
      for (const c of rep.clusters) {
        const sign = c.E >= 0 ? "+" : "";
        const nat = Object.entries(c.native)
          .filter(([, n]) => Math.abs(n) > 1e-9)
          .map(([s, n]) => `${n >= 0 ? "+" : ""}${(+n.toPrecision(6)).toLocaleString()} ${s}`)
          .join(", ");
        console.log(`   ${String(c.fp).padEnd(16)} x${c.members}  net E=$${sign}${Math.round(c.E).toLocaleString()}  ${nat}`);
      }
      console.log("   (cluster membership is a shared-bytecode fact; it asserts no deployer, owner, or intent.)");
    }
  }
  for (const n of rep.notes) console.log(`\n  ${n}`);
  console.log("");
}
process.exit(rep.verdict === "UNRECONSTRUCTED" ? 2 : 0);

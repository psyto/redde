/**
 * Praeda — Slice 1 reconstructor.
 *
 *   Collapse leaves a transfer record. Praeda reconstructs it.
 *
 * Reconstructs the boundary-flow ledger of an on-chain collapse: net boundary
 * outflow (E) and drawdown timing (L) for each resolved account that crossed the
 * system's boundary inside the collapse window W.
 * Zero dependencies (Node 18+ built-in fetch). Reads only; no protocol
 * cooperation. Anyone with this file, SPEC.md, and an RPC that serves W's
 * history reproduces the ledger. See SPEC.md.
 *
 *   SOLANA_RPC_URL=... node reconstruct.mjs [--json]
 *
 * HONESTY BOUNDARY (see SPEC.md / MANIFESTO.md): this engine publishes ONLY E and
 * L, both reproducible arithmetic over recorded transfers. It NEVER asserts intent,
 * knowledge, identity, beneficial ownership, or guilt. When W's history is not
 * served, the verdict is `UNRECONSTRUCTED` — never a guess.
 */

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

/**
 * CASE FILE — the declared inputs of a reconstruction. Everything here is a
 * public fact or a public account; nothing here is an inference. Wallet
 * attributions, when added, are recorded as "publicly identified as X by <firm>",
 * never as adjudicated guilt. See CASE_LIBRA.md for the full sourced dossier.
 *
 * Active target: the 2025-02-14 $LIBRA boundary-flow case. Named for its boundary
 * (the Meteora DLMM pool quote/token vaults), not for a verdict. Priceable on the
 * SOL/USDC legs; LIBRA itself stays UNPRICED (no reference independent of the
 * affected market). Reference case (kept UNRECONSTRUCTED on standard RPC): Mango
 * Markets 2022-10-11 — history pruned, MNGO UNPRICED.
 *
 * Confirmed inputs are pinned below. The vault set, window slots, and reference
 * manifest are unresolved on the free endpoint and MUST be pinned against an
 * unthrottled / archival endpoint (Helius getTransactionsForAddress covers ATAs;
 * Triton Old Faithful serves the Feb-2025 window). Until then the engine renders
 * UNRECONSTRUCTED — by design, not by omission.
 */
const CASE = {
  name: "$LIBRA boundary-flow case",
  when: "2025-02-14",
  adjudicated: false, // public analytics attributions only; frame as "identified as"
  // Confirmed on-chain (live getTokenSupply this session): mint + decimals.
  mint: "Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU",
  mintDecimals: 6,
  // Venue: Meteora DLMM (program LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo).
  poolProgram: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  // LIBRA/USDC pool CONFIRMED on-chain this session: candidate BzzMNv… is a real
  // Meteora LbPair (dataLen 1208) whose LIBRA vault holds 204.3M LIBRA. Its reserve
  // token accounts (DLMM reserveX/reserveY, fixed at pool init) are the boundary.
  pools: {
    "LIBRA/USDC": {
      pool: "BzzMNvfm7T6zSGFeLXzERmRxfKaNLdo4fSzvsisxcSzz",
      usdcVault: "3nSdqiF5Cxd22r8h6Ti1TwzDmcVN6SgFfDcWbBtCFRdc",  // quote (value leg)
      libraVault: "7ehgfSLXCjd6VqtpT2Q63Mcq8TeHv6h2ujj7XvwgyNPk", // token (UNPRICED)
    },
    // LIBRA/SOL pool: reported to exist (SOL legs 148,343 + 69,275 SOL extracted),
    // but its LbPair/SOL-vault is NOT yet resolved — the aggregator candidate
    // 3mzgxn… did not surface among current LIBRA holders. TODO: resolve on-chain.
    "LIBRA/SOL": { pool: null, solVault: null, libraVault: null },
  },
  // The boundary = the pools' value-leg vaults (USDC now confirmed; SOL pending).
  // Value-E is measured on the quote legs; the LIBRA vault is the token side and
  // stays UNPRICED. NOTE: DLMM reserves are init-time accounts, so these held the
  // Feb-2025 reserves too — confirm against the archival snapshot at t0.
  boundaryVaults: [
    "3nSdqiF5Cxd22r8h6Ti1TwzDmcVN6SgFfDcWbBtCFRdc", // LIBRA/USDC pool USDC vault
    "7ehgfSLXCjd6VqtpT2Q63Mcq8TeHv6h2ujj7XvwgyNPk", // LIBRA/USDC pool LIBRA vault
    // TODO(archival): + LIBRA/SOL pool SOL vault once resolved.
  ],
  // W bounded by UTC (t0 ≈ 22:01, t1 within ~1-3h on 2025-02-14); NO slots in any
  // source. TODO(archival): map UTC -> slot and refine from the drain sequence.
  window: { solventSlot: null, insolventSlot: null },
  // USD sort runs on SOL + USDC only; LIBRA stays UNPRICED. USDC is price-invariant;
  // pin ONE independent SOL/USD reference (VWAP over W, not the LIBRA pool) + publish
  // the sensitivity table. TODO(archival). See SPEC.md "Reference manifest".
  reference: { referenceSlot: null, manifest: null }, // { hash, assets: [...] }
};

import { solanaRpc } from "../../core/rpc.mjs";
const rpc = solanaRpc(RPC, { tries: 1 }); // was an inline single-shot throwing rpc

/**
 * Archival gate — can this endpoint even serve W's history? A 2022 window is
 * pruned by default mainnet-beta. If we cannot read the boundary's signatures
 * back to the window, we do NOT guess: the reconstruction is UNRECONSTRUCTED.
 */
async function servesWindow(caseDef) {
  if (!caseDef.boundaryVaults.length) {
    return { ok: false, why: "boundary vault set not yet pinned (converge item)" };
  }
  if (!Number.isInteger(caseDef.window.solventSlot) || !Number.isInteger(caseDef.window.insolventSlot)) {
    return { ok: false, why: "window slots not yet pinned with state witnesses" };
  }
  if (!validReferenceManifest(caseDef.reference)) {
    return { ok: false, why: "reference manifest not yet pinned" };
  }
  try {
    for (const vault of caseDef.boundaryVaults) {
      const probe = await reachesSlot(vault, caseDef.window.solventSlot);
      if (!probe.ok) return { ok: false, why: `${vault}: ${probe.why}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, why: `history not served (${e.message})` };
  }
}

function validReferenceManifest(reference) {
  return Number.isInteger(reference?.referenceSlot)
    && typeof reference.manifest?.hash === "string"
    && Array.isArray(reference.manifest.assets)
    && reference.manifest.assets.length > 0;
}

async function reachesSlot(address, targetSlot) {
  // A one-page probe proves only that an endpoint has recent history. Page every
  // declared boundary until its served range reaches W, then prove the archived
  // transaction itself is retrievable. A cap is a refusal, never a positive gate.
  const maxPages = Number(process.env.PRAEDA_MAX_HISTORY_PAGES || 200);
  let before;
  for (let page = 0; page < maxPages; page += 1) {
    const options = { limit: 1000, ...(before ? { before } : {}) };
    const sigs = await rpc("getSignaturesForAddress", [address, options]);
    if (!Array.isArray(sigs) || sigs.length === 0) {
      return { ok: false, why: "served signature history ends before the window" };
    }
    const oldest = sigs.at(-1);
    if (oldest.slot <= targetSlot) {
      const tx = await rpc("getTransaction", [oldest.signature, {
        encoding: "jsonParsed", maxSupportedTransactionVersion: 0,
      }]);
      return tx
        ? { ok: true }
        : { ok: false, why: "archived signature is served but its transaction is unavailable" };
    }
    before = oldest.signature;
  }
  return { ok: false, why: `history pagination cap (${maxPages} pages) reached before the window` };
}

/**
 * Boundary-crossing transfers → per-account net boundary outflow E.
 * For each transfer crossing a boundary vault inside W, resolve the observed
 * endpoint. Attribute through an intermediary only for a transaction-local,
 * one-to-one value-conserving CPI path; otherwise retain ROUTE_UNRESOLVED.
 * Price only mints with a pinned independent reference (SPEC Measure 1).
 * Returns { [account]: { E, decisiveSlot } }.
 */
async function extractionByAccount(_caseDef) {
  // Walk getSignaturesForAddress over each boundary vault within W, fetch each
  // getTransaction, diff pre/postTokenBalances for the vault, attribute the
  // signed delta to the counterparty, price at reference. Aggregate per account.
  // (Implementation pends the converge items above — vault set, window, prices.)
  return null;
}

/** Drawdown curve D(t) over W, sampled from headline state → drawdown timing L. */
async function drawdownCurve(_caseDef) {
  // Sample the system's headline value (aggregate vault balance) block-by-block
  // across W, normalize D(solventSlot)=0, D(insolventSlot)=1. L(a)=1−D(t_a).
  return null;
}

function classify(rows) {
  // Labels measure boundary flow; they never imply beneficiary or intent.
  const outflows = rows.filter((r) => r.E > 0).sort((a, b) => b.E - a.E);
  const medianL = median(rows.map((r) => r.L));
  const K = Math.max(1, Math.ceil(outflows.length * 0.05));
  return rows.map((r) => {
    if (r.E < 0) return { ...r, class: "NET_INFLOW" };
    if (r.E === 0) return { ...r, class: "NET_ZERO" };
    const rank = outflows.indexOf(r);
    const earlyTopOutflow = rank < K && r.L >= medianL;
    return { ...r, class: earlyTopOutflow ? "EARLY_TOP_OUTFLOW" : "NET_OUTFLOW" };
  });
}
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function reconstruct(caseDef) {
  const gate = await servesWindow(caseDef);
  if (!gate.ok) {
    return {
      verdict: "UNRECONSTRUCTED",
      target: caseDef.name,
      notes: [
        `UNRECONSTRUCTED: ${gate.why}.`,
        "The specified reconstruction could not be produced from the available record — not a guess.",
      ],
    };
  }
  const [ext, curve] = await Promise.all([
    extractionByAccount(caseDef),
    drawdownCurve(caseDef),
  ]);
  if (!ext || !curve) {
    return {
      verdict: "UNRECONSTRUCTED",
      target: caseDef.name,
      notes: ["UNRECONSTRUCTED: flows across W not yet computable (converge items pending)."],
    };
  }
  const rows = classify(
    Object.entries(ext).map(([account, v]) => ({
      account, E: v.E, L: 1 - curve.at(v.decisiveSlot),
    })),
  );
  return {
    verdict: "RECONSTRUCTED",
    target: caseDef.name,
    window: caseDef.window,
  ledger: rows.sort((a, b) => b.E - a.E),
    notes: [],
  };
}

const json = process.argv.includes("--json");
const rep = await reconstruct(CASE).catch((err) => ({
  verdict: "UNRECONSTRUCTED",
  target: CASE.name,
  notes: [`UNRECONSTRUCTED: ${err instanceof Error ? err.message : String(err)}.`],
}));

if (json) {
  console.log(JSON.stringify(rep, null, 2));
} else {
  console.log(`\n  praeda — boundary-flow reconstruction`);
  console.log(`  target : ${rep.target}${CASE.adjudicated ? "  (framing adjudicated)" : ""}`);
  console.log(`  verdict: [ ${rep.verdict} ]\n`);
  if (rep.ledger) {
    console.log("  boundary-flow ledger (E = net boundary outflow, reference-priced; L = timing):");
    for (const r of rep.ledger.slice(0, 20)) {
      const sign = r.E >= 0 ? "+" : "";
      console.log(`   ${r.class.padEnd(16)} ${r.account}  E=${sign}${r.E}  L=${r.L.toFixed(2)}`);
    }
  }
  for (const n of rep.notes) console.log(`\n  ${n}`);
  console.log("");
}
process.exit(rep.verdict === "UNRECONSTRUCTED" ? 2 : 0);

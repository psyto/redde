#!/usr/bin/env node
// reexec.mjs — Redde's re-execution tier, slice 1: TRUSTLESS STATE.
//
// The reads leg (verify-eth.mjs) trusts the RPC: it asks the node for a balance and
// believes the answer. This module does not. It fetches the state WITH its Merkle proof
// (eth_getProof) and verifies that proof against the block's stateRoot by walking the
// trie itself — keccak-hashing each node and checking it against its parent. An RPC
// cannot forge one account/slot without producing a stateRoot inconsistent with every
// other observer of that block. This is the foundation the revm execution leg (slice 2)
// stands on: executing bytecode is only trustless if it runs against verified state.
//
// Honesty boundary: this proves state is consistent with the block's COMMITTED stateRoot
// (from the header the RPC returned). Proving that stateRoot against consensus (the beacon
// chain / a second source) is a separate, checkable step — not yet done here.
//
// Known limitation (fail-closed): inline (embedded, <32-byte) trie nodes are not decoded
// in v0; a proof that uses them throws → treated as UNVERIFIED, never a false "verified".
//
// Zero dependencies (Node 18+). Reads only.
//   ETH_RPC_URL=<L1> node reexec.mjs            # demo: prove the EL balances Redde observes

import { keccak256, hexToBytes as hb, bytesToHex as bh } from "./keccak.mjs";

const RPC = process.env.ETH_RPC_URL || "https://eth.llamarpc.com";
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── RLP decode → nested arrays of byte-arrays ──────────────────────────────────
function rlp(bytes) { return item(bytes, 0)[0]; }
function item(b, p) {
  const x = b[p];
  if (x < 0x80) return [[x], p + 1];
  if (x < 0xb8) { const n = x - 0x80; return [b.slice(p+1, p+1+n), p+1+n]; }
  if (x < 0xc0) { const ll = x-0xb7; let n = 0; for (let i=0;i<ll;i++) n = n*256 + b[p+1+i]; const s = p+1+ll; return [b.slice(s, s+n), s+n]; }
  if (x < 0xf8) { const n = x - 0xc0; return list(b, p+1, p+1+n); }
  { const ll = x-0xf7; let n = 0; for (let i=0;i<ll;i++) n = n*256 + b[p+1+i]; const s = p+1+ll; return list(b, s, s+n); }
}
function list(b, s, e) { const out = []; let p = s; while (p < e) { let v; [v, p] = item(b, p); out.push(v); } return [out, e]; }
const isNode = (x) => Array.isArray(x) && x.length > 0 && Array.isArray(x[0]); // decoded-list vs raw bytes

// ── Merkle-Patricia proof walk: prove `key`'s value under `root` ────────────────
// proofHex: the RLP-encoded nodes from root to leaf. Returns the leaf value bytes or throws.
function walkProof(rootHex, keyBytes, proofHex) {
  const root = hb(rootHex);
  const keyN = []; for (const by of keyBytes) keyN.push(by >> 4, by & 0xf); // nibbles
  const proof = proofHex.map(hb);
  let expected = root, idx = 0;
  for (let ni = 0; ni < proof.length; ni++) {
    const node = proof[ni];
    if (!eq(keccak256(node), expected)) throw new Error(`node ${ni}: keccak ≠ parent hash (broken proof)`);
    const dec = rlp(node);
    if (dec.length === 17) {                         // branch
      if (idx === keyN.length) return dec[16];       // value sits in the branch
      const child = dec[idx < keyN.length ? keyN[idx++] : 0];
      if (child.length === 0) throw new Error("proof of exclusion (empty branch slot)");
      if (isNode(child)) throw new Error("inline branch child — not handled in v0 (fail-closed)");
      if (child.length !== 32) throw new Error("unexpected branch child length");
      expected = child;
    } else if (dec.length === 2) {                   // leaf or extension
      const path = dec[0], flag = path[0] >> 4, odd = flag & 1, isLeaf = flag & 2;
      const pn = []; if (odd) pn.push(path[0] & 0xf);
      for (let i = 1; i < path.length; i++) pn.push(path[i] >> 4, path[i] & 0xf);
      if (!eq(keyN.slice(idx, idx + pn.length), pn)) throw new Error(`path mismatch in ${isLeaf ? "leaf" : "extension"}`);
      idx += pn.length;
      if (isLeaf) return dec[1];
      const child = dec[1];
      if (isNode(child)) throw new Error("inline extension child — not handled in v0 (fail-closed)");
      if (child.length !== 32) throw new Error("unexpected extension child length");
      expected = child;
    } else throw new Error(`unexpected node arity ${dec.length}`);
  }
  throw new Error("proof ended without reaching a leaf");
}

// ── RPC ────────────────────────────────────────────────────────────────────────
let RID = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params, tries = 6) {
  let lastErr;
  for (let a = 0; a < tries; a++) {
    if (a) await sleep(300 * a);
    try {
      const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++RID, method, params }) });
      const txt = await res.text();
      if (!txt) { lastErr = new Error(`${method}: empty response`); continue; }
      const j = JSON.parse(txt);
      if (j.error) throw new Error(`${method}: ${j.error.message}`);
      return j.result;
    } catch (e) { if (/empty response|fetch failed|network|ECONN|ETIMEDOUT/i.test(e.message)) { lastErr = e; continue; } throw e; }
  }
  throw lastErr;
}

// ── proven reads ────────────────────────────────────────────────────────────────
// Prove an account's ETH balance against the block's stateRoot.
export async function provenBalance(address, blockHex, stateRoot) {
  const proof = await rpc("eth_getProof", [address, [], blockHex]);
  const leaf = walkProof(stateRoot, keccak256(hb(address)), proof.accountProof);
  const acct = rlp(leaf);                            // [nonce, balance, storageRoot, codeHash]
  const proven = BigInt(bh(acct[1]));
  if (proven !== BigInt(proof.balance)) throw new Error("proven balance ≠ RPC-claimed balance");
  return { balance: proven, storageRoot: bh(acct[2]), codeHash: bh(acct[3]) };
}

// Prove one storage slot against the account's storageRoot (itself proven above).
export async function provenStorage(address, slotHex, blockHex, storageRoot) {
  const proof = await rpc("eth_getProof", [address, [slotHex], blockHex]);
  const sp = proof.storageProof[0];
  const key = keccak256(hb(slotHex.replace(/^0x/, "").padStart(64, "0")));
  let value = 0n;
  try { const leaf = walkProof(storageRoot, key, sp.proof); value = BigInt(bh(rlp(leaf))); }
  catch (e) { if (/exclusion/.test(e.message)) value = 0n; else throw e; } // absent slot = 0
  if (value !== BigInt(sp.value)) throw new Error("proven slot ≠ RPC-claimed slot");
  return value;
}

// ── demo: prove the execution-layer balances the reads leg observes ──────────────
const TARGETS = [
  { name: "Lido stETH (buffer)", addr: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" },
  { name: "RocketPool rETH (buffer)", addr: "0xae78736Cd615f374D3085123A210448E74Fc6393" },
];
const WEI = 10n ** 18n, eth = (w) => (Number(w * 1000n / WEI) / 1000).toLocaleString();

if (import.meta.url === `file://${process.argv[1]}`) {
  const blk = await rpc("eth_blockNumber", []);
  const header = await rpc("eth_getBlockByNumber", [blk, false]);
  const bar = "─".repeat(74);
  console.log(bar);
  console.log(`  Redde · re-execution tier (slice 1: trustless state)   block ${parseInt(blk, 16)}`);
  console.log(`  stateRoot ${header.stateRoot}`);
  console.log(bar);
  for (const t of TARGETS) {
    try {
      const r = await provenBalance(t.addr, blk, header.stateRoot);
      console.log(`  ✅ ${t.name.padEnd(28)} ${eth(r.balance)} ETH  — proven against stateRoot`);
    } catch (e) {
      console.log(`  ⚠️  ${t.name.padEnd(28)} UNVERIFIED — ${e.message}`);
    }
  }
  console.log(bar);
  console.log(`  Proven = the balance is Merkle-consistent with the block's committed stateRoot,`);
  console.log(`  walked node-by-node here — not taken on the RPC's word. (stateRoot vs consensus`);
  console.log(`  is a separate, checkable step.)`);
  console.log(bar);
}

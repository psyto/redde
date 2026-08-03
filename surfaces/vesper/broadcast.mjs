#!/usr/bin/env node
// Vesper — broadcast: the thin on-chain adapter registry.mjs said was missing. It anchors a claim's
// verdict to Solana via the Memo program (the exact ≤566-byte memoPayload the registry already builds),
// filling the registry's onchain_sig. "The memo log IS the registry" — now literally, on-chain.
//
// DRY RUN by default (no key, no network). --send posts a real Memo tx with a funded keypair.
//   node broadcast.mjs <claim.json>                                  # dry-run: print the planned memo
//   node broadcast.mjs <claim.json> --send --keypair <path> [--rpc]  # anchor it on-chain
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { memoPayload, subjectKey } from './registry.mjs';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : undefined; };

const claimPath = argv[0];
if (!claimPath || claimPath.startsWith('--')) {
  console.error('usage: node broadcast.mjs <claim.json> [--rpc <url>] [--send --keypair <path>]');
  process.exit(2);
}
const send = argv.includes('--send');
const rpc = opt('--rpc') || 'https://api.devnet.solana.com';
const keypairPath = opt('--keypair');

const claim = JSON.parse(readFileSync(claimPath, 'utf8'));
if (!claim.claim_id || !claim.verdict?.flag) {
  console.error('not a Vesper claim (missing claim_id / verdict.flag)');
  process.exit(2);
}
const memo = memoPayload(claim);
if (memo.length > 566) {
  console.error(`memo is ${memo.length} bytes > 566 (Solana Memo limit)`);
  process.exit(2);
}
const plan = { program: MEMO_PROGRAM, rpc, bytes: memo.length, claim_id: claim.claim_id, verdict: claim.verdict.flag, subject: subjectKey(claim), memo };

if (!send) {
  console.log('DRY RUN — nothing sent. Planned Solana Memo anchor:');
  console.log(JSON.stringify(plan, null, 2));
  console.log('\nTo anchor on-chain: node broadcast.mjs <claim.json> --send --keypair <path> [--rpc <url>]');
  process.exit(0);
}

if (!keypairPath) { console.error('--send requires --keypair <path to a solana keypair json>'); process.exit(2); }
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } =
  await import('@solana/web3.js');
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const conn = new Connection(rpc, 'confirmed');
const ix = new TransactionInstruction({
  keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], // signer → the memo is attributable to this node
  programId: new PublicKey(MEMO_PROGRAM),
  data: Buffer.from(memo, 'utf8'),
});
console.error(`anchoring on-chain — rpc=${rpc} node=${kp.publicKey.toBase58()} memo="${memo}" ...`);
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [kp]);

// Fill the registry's onchain_sig — the append-only memo log now carries a real Solana signature.
mkdirSync(new URL('./registry/', import.meta.url), { recursive: true });
const row = {
  ts: Math.floor(Date.now() / 1000), node: kp.publicKey.toBase58(),
  claim_id: claim.claim_id, claim_type: claim.claim_type, subject: subjectKey(claim),
  window: claim.inputs.window, verdict: claim.verdict.flag, memo, onchain_sig: sig,
};
appendFileSync(new URL('./registry/log.jsonl', import.meta.url), JSON.stringify(row) + '\n');
console.log('anchored on-chain:', sig);

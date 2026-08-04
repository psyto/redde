// Campana keeper — keep the canonical on-chain status account LIVE by re-cranking it at every
// OPEN <-> CLOSED flip. Permissionless: the keeper is not trusted — after each crank it re-executes
// the off-chain reference (../campana.mjs) at the timestamp the chain used and asserts they agree, so
// a wrong crank is provable, not deniable. Don't trust the keeper — re-execute it.
//
//   node keeper.mjs                       # single-shot: crank once, print status + the next flip (launchd-friendly)
//   node keeper.mjs --loop                # long-running: crank, sleep to the next flip, repeat
//   node keeper.mjs --loop --heartbeat 3600   # also re-crank at least this often (liveness proof), default 6h
//   [--keypair <path>] [--rpc <url>]
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { marketStatus, STATUS } from '../campana.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const RPC = arg('--rpc', 'https://api.devnet.solana.com');
const KEYPAIR = arg('--keypair', `${process.env.HOME}/.config/solana/id.json`);
const HEARTBEAT = Number(arg('--heartbeat', 6 * 3600));   // seconds; also re-crank at least this often
const PROGRAM = new PublicKey('67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i');
// THE canonical US_EQUITIES_REGULAR Campana status account — created once, program-owned, rent-exempt,
// re-cranked in place forever (Crank takes it as a NON-signer, so only the payer signs).
const STATE = new PublicKey('7j3VCB9fhSJv8nSzdj6mCFUAPy1zj6VW7BfvPDgbcRc8');
const CODE = ['CLOSED', 'OPEN', 'HALF_DAY'];

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf8'))));
const conn = new Connection(RPC, 'confirmed');

// exact second of the next status change at/after `fromTs` (scan to 1s, bounded by long holiday weekends)
function nextFlip(fromTs) {
  const cur = marketStatus(fromTs).status;
  const STEP = 60, MAX = 8 * 86400;
  for (let t = fromTs + STEP; t <= fromTs + MAX; t += STEP) {
    if (marketStatus(t).status !== cur) {
      for (let s = t - STEP + 1; s <= t; s++) if (marketStatus(s).status !== cur) return s;
      return t;
    }
  }
  return null;
}

async function crankOnce() {
  const ix = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: STATE, isSigner: false, isWritable: true }], data: Buffer.from([0]) });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]);
  const d = (await conn.getAccountInfo(STATE)).data;
  const onchain = { status: CODE[d[0]], etOffset: (d[2] << 24) >> 24, updatedTs: Number(d.readBigInt64LE(8)), lastCloseTs: Number(d.readBigInt64LE(16)), cal: d.readUInt32LE(4) };
  // re-execute the reference at the SAME ts the chain used — the keeper proves itself, it is not trusted
  const ref = marketStatus(onchain.updatedTs);
  const agree = onchain.status === ref.status && onchain.lastCloseTs === ref.last_close_ts && onchain.cal === ref.calendar_version;
  if (!agree) throw new Error(`CRANK MISMATCH — on-chain ${onchain.status} != reference ${ref.status} at ${onchain.updatedTs}`);
  return { sig, onchain };
}

async function tick() {
  const { sig, onchain } = await crankOnce();
  const flip = nextFlip(onchain.updatedTs);
  const stamp = new Date(onchain.updatedTs * 1000).toISOString();
  console.log(`[${stamp}] cranked ${STATE.toBase58().slice(0, 6)}… → ${onchain.status} (ET${onchain.etOffset}) · re-executed: ON-CHAIN == OFF-CHAIN ✓ · ${sig.slice(0, 8)}…`);
  if (flip) console.log(`  next flip → ${marketStatus(flip).status} at ${new Date(flip * 1000).toISOString()}`);
  return flip;
}

if (!has('--loop')) {
  await tick();
  process.exit(0);
}

console.log(`Campana keeper — LOOP · program ${PROGRAM.toBase58()} · state ${STATE.toBase58()} · heartbeat ${HEARTBEAT}s\n`);
for (;;) {
  let flip;
  try { flip = await tick(); }
  catch (e) { console.error(`  crank failed: ${e.message} — retrying in 60s`); await new Promise((r) => setTimeout(r, 60_000)); continue; }
  const now = Math.floor(Date.now() / 1000);
  const untilFlip = flip ? flip + 2 - now : HEARTBEAT;         // wake just after the flip
  const sleepS = Math.max(30, Math.min(untilFlip, HEARTBEAT)); // …but re-crank at least every heartbeat
  console.log(`  sleeping ${Math.round(sleepS / 60)} min\n`);
  await new Promise((r) => setTimeout(r, sleepS * 1000));
}

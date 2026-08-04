// Campana on-chain — create a status account, crank it, read it back, and CROSS-CHECK the on-chain
// status bit against the off-chain reference (../campana.mjs). Don't trust the on-chain feed — re-execute.
//   node client.mjs [--keypair <path>] [--rpc <url>]   (needs a funded devnet key)
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { marketStatus, STATUS } from '../campana.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const RPC = arg('--rpc') || 'https://api.devnet.solana.com';
const KEYPAIR = arg('--keypair') || `${process.env.HOME}/.config/solana/id.json`;
const PROGRAM = new PublicKey('67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i');
const STATE_LEN = 32;
const CODE = ['CLOSED', 'OPEN', 'HALF_DAY']; // on-chain byte 0

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const state = Keypair.generate();

console.log(`\nCampana on-chain — crank + cross-check\n  program ${PROGRAM.toBase58()}\n  state   ${state.publicKey.toBase58()}\n  rpc     ${RPC}\n`);

// 1. create the status account (owned by the Campana program) and 2. crank it — in one tx.
const rent = await conn.getMinimumBalanceForRentExemption(STATE_LEN);
const create = SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: state.publicKey, lamports: rent, space: STATE_LEN, programId: PROGRAM });
const crank = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: state.publicKey, isSigner: false, isWritable: true }], data: Buffer.from([0]) });
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(create).add(crank), [payer, state]);
console.log(`  cranked on-chain: ${sig}`);

// 3. read the status account back
const acct = await conn.getAccountInfo(state.publicKey);
const d = acct.data;
const onchain = {
  status: CODE[d[0]], dayKind: d[1], etOffset: (d[2] << 24) >> 24,
  calendarVersion: d.readUInt32LE(4),
  updatedTs: Number(d.readBigInt64LE(8)),
  lastCloseTs: Number(d.readBigInt64LE(16)),
  year: d.readInt32LE(24), month: d[28], day: d[29],
};

// 4. CROSS-CHECK: re-execute the off-chain reference at the SAME timestamp the chain used.
const ref = marketStatus(onchain.updatedTs);
const agree = onchain.status === ref.status
  && onchain.lastCloseTs === ref.last_close_ts
  && onchain.calendarVersion === ref.calendar_version;

console.log(`\n  on-chain (67cLXa…, cranked ${new Date(onchain.updatedTs * 1000).toISOString()}):`);
console.log(`    status ${onchain.status} · ET${onchain.etOffset} · ${onchain.year}-${String(onchain.month).padStart(2, '0')}-${String(onchain.day).padStart(2, '0')} · last close ${new Date(onchain.lastCloseTs * 1000).toISOString()} · cal v${onchain.calendarVersion}`);
console.log(`  off-chain campana.mjs re-executed at the same ts:`);
console.log(`    status ${ref.status} · ET${ref.etOffset} · ${ref.dateET} · last close ${new Date(ref.last_close_ts * 1000).toISOString()} · cal v${ref.calendar_version}`);
console.log(`\n  ${agree ? '✅ ON-CHAIN == OFF-CHAIN' : '❌ MISMATCH'} — ${agree ? 'the status bit venues read reproduces from the calendar. Do not trust it — re-execute it.' : 'the on-chain feed does not reproduce; investigate.'}\n`);
console.log(`  explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
process.exit(agree ? 0 : 1);

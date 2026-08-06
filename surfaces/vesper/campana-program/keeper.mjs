// Campana keeper — keep the canonical on-chain status account LIVE by re-cranking it at every
// OPEN <-> CLOSED flip. Permissionless: the keeper is not trusted — after each crank it re-executes
// the off-chain reference (../campana.mjs) at the timestamp the chain used and asserts they agree, so
// a wrong crank is provable, not deniable. Don't trust the keeper — re-execute it.
//
//   node keeper.mjs                       # single-shot: crank once, print status + the next flip (launchd-friendly)
//   node keeper.mjs --check               # READ-ONLY: is the account in sync with the reference right now?
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

// This program's default action is a live on-chain write, so an argument it does not understand
// must stop it rather than fall through to that default. `--help` used to do exactly that: it was
// not recognised, so it reached crankOnce() and sent a transaction. A usage line that costs you a
// crank to read is a trap.
const USAGE = `Campana keeper — keep the canonical on-chain status account LIVE.

  node keeper.mjs                      single-shot: crank once, print status + the next flip
  node keeper.mjs --check              READ-ONLY: compare the account against the reference NOW
  node keeper.mjs --check --at <iso>   …or at some past instant (audit a window after the fact)
  node keeper.mjs --loop               long-running: crank, sleep to the next flip, repeat
  node keeper.mjs --loop --heartbeat N also re-crank at least every N seconds (default 21600)
  node keeper.mjs --rpc <url>          RPC endpoint (default devnet)
  node keeper.mjs --keypair <path>     payer keypair (default ~/.config/solana/id.json)

Every run except --check WRITES ON-CHAIN. --check exits 1 when the account is stale, so it is the
one command that answers "is the rail live?" without becoming the reason the answer is yes.`;

const KNOWN = ['--loop', '--check', '--at', '--heartbeat', '--rpc', '--keypair'];
if (has('--help') || has('-h')) { console.log(USAGE); process.exit(0); }
const unknown = process.argv.slice(2).filter((a) => a.startsWith('-') && !KNOWN.includes(a));
if (unknown.length) {
  console.error(`keeper: unknown argument ${unknown.join(' ')}\n\n${USAGE}`);
  process.exit(2);
}

// launchd resolves `node` from its own minimal PATH, which on this machine reaches a 2023-vintage
// v18 binary that hangs here instead of failing. KeepAlive then restarts it forever, so the keeper
// looks loaded while never once cranking. Fail loudly instead.
const MAJOR = Number(process.versions.node.split('.')[0]);
if (MAJOR < 20) {
  console.error(`keeper: node ${process.versions.node} is too old (need >= 20). \
Point the launchd plist at an absolute path to a current node.`);
  process.exit(2);
}
const RPC = arg('--rpc', 'https://api.devnet.solana.com');
const KEYPAIR = arg('--keypair', `${process.env.HOME}/.config/solana/id.json`);
const HEARTBEAT = Number(arg('--heartbeat', 6 * 3600));   // seconds; also re-crank at least this often
const PROGRAM = new PublicKey('67cLXa3wEmSe71tywnMKDBTaWgGFfTEBSHjpfi4aE19i');
// THE canonical US_EQUITIES_REGULAR Campana status account — created once, program-owned, rent-exempt,
// re-cranked in place forever (Crank takes it as a NON-signer, so only the payer signs).
const STATE = new PublicKey('7j3VCB9fhSJv8nSzdj6mCFUAPy1zj6VW7BfvPDgbcRc8');
const CODE = ['CLOSED', 'OPEN', 'HALF_DAY'];

// loaded lazily: --check must work on a machine that holds no key, or "is the rail live?" is a
// question only the operator can ask.
let _payer;
const payer = () => (_payer ??= Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf8')))));
const conn = new Connection(RPC, 'confirmed');
const iso = (ts) => new Date(ts * 1000).toISOString();

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

// every flip strictly inside (fromTs, toTs] — used to name the windows a gap actually cost
function flipsBetween(fromTs, toTs) {
  const out = [];
  for (let t = fromTs; out.length < 64; ) {
    const f = nextFlip(t);
    if (!f || f > toTs) break;
    out.push(f);
    t = f;
  }
  return out;
}

const decode = (d) => ({
  status: CODE[d[0]], etOffset: (d[2] << 24) >> 24, updatedTs: Number(d.readBigInt64LE(8)),
  lastCloseTs: Number(d.readBigInt64LE(16)), cal: d.readUInt32LE(4),
});

const readState = async () => decode((await conn.getAccountInfo(STATE)).data);

// Is the account telling the truth AT THIS INSTANT? Distinct from the post-crank check below, which
// only proves the chain agreed with the reference at the moment it was written — an account frozen
// mid-2024 passes that test forever. Staleness is the failure this keeper actually has.
function staleness(onchain, nowTs = Math.floor(Date.now() / 1000)) {
  const ref = marketStatus(nowTs);
  return { ref, stale: onchain.status !== ref.status, behindS: nowTs - onchain.updatedTs };
}

async function crankOnce() {
  const ix = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: STATE, isSigner: false, isWritable: true }], data: Buffer.from([0]) });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer()]);
  const onchain = decode((await conn.getAccountInfo(STATE)).data);
  // re-execute the reference at the SAME ts the chain used — the keeper proves itself, it is not trusted
  const ref = marketStatus(onchain.updatedTs);
  const agree = onchain.status === ref.status && onchain.lastCloseTs === ref.last_close_ts && onchain.cal === ref.calendar_version;
  if (!agree) throw new Error(`CRANK MISMATCH — on-chain ${onchain.status} != reference ${ref.status} at ${onchain.updatedTs}`);
  return { sig, onchain };
}

async function tick() {
  const { sig, onchain } = await crankOnce();
  const flip = nextFlip(onchain.updatedTs);
  console.log(`[${iso(onchain.updatedTs)}] cranked ${STATE.toBase58().slice(0, 6)}… → ${onchain.status} (ET${onchain.etOffset}) · re-executed: ON-CHAIN == OFF-CHAIN ✓ · ${sig.slice(0, 8)}…`);
  if (flip) console.log(`  next flip → ${marketStatus(flip).status} at ${iso(flip)}`);
  return { flip, onchain };
}

// Read-only liveness. Exits 1 on stale so cron/CI/a human can ask without cranking — the check that
// repairs what it measures cannot detect that it was ever broken.
if (has('--check')) {
  const onchain = await readState();
  const at = arg('--at');
  const now = at ? Math.floor(new Date(at).getTime() / 1000) : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(now)) { console.error(`keeper: --at ${at} is not a parseable timestamp`); process.exit(2); }
  const { ref, stale, behindS } = staleness(onchain, now);
  console.log(`account   ${onchain.status} · written ${iso(onchain.updatedTs)} (${Math.round(behindS / 60)} min ago)`);
  console.log(`reference ${ref.status} · now ${iso(now)}`);
  if (!stale) { console.log(`=> IN SYNC ✓`); process.exit(0); }
  const missed = flipsBetween(onchain.updatedTs, now);
  console.log(`=> STALE ✗ — account says ${onchain.status}, reference says ${ref.status}`);
  for (const f of missed) console.log(`   missed flip → ${marketStatus(f).status} at ${iso(f)}`);
  process.exit(1);
}

if (!has('--loop')) {
  await tick();
  process.exit(0);
}

// A single long setTimeout is not a schedule. On 2026-08-06 this keeper slept straight through the
// whole OPEN session (13:30Z–20:00Z): the process stayed up, `launchctl print` still said
// `state = running`, `runs = 1` — and the timer simply never fired across system sleep, so the
// account sat at CLOSED for 6.5h while the reference said OPEN and no line anywhere said so.
// A timer is a hope; wall-clock is the authority. Poll in short chunks, re-derive the deadline from
// Date.now() every pass, and treat the reference moving out from under the account as its own wake
// reason — that one condition covers a missed flip, a suspend, a clock jump and a calendar edit alike.
const POLL_MS = 60_000;

async function sleepUntil(targetTs, holdStatus) {
  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= targetTs) return 'due';
    if (holdStatus && marketStatus(now).status !== holdStatus) return 'diverged';
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, (targetTs - now) * 1000)));
  }
}

console.log(`Campana keeper — LOOP · program ${PROGRAM.toBase58()} · state ${STATE.toBase58()} · heartbeat ${HEARTBEAT}s · poll ${POLL_MS / 1000}s\n`);

// Say out loud what the gap cost before repairing it. A keeper that silently fixes its own downtime
// teaches you nothing, and the missed window is the part worth reading.
try {
  const prior = await readState();
  const now = Math.floor(Date.now() / 1000);
  const { ref, stale, behindS } = staleness(prior, now);
  if (stale) {
    console.log(`  STALE ON ARRIVAL — account ${prior.status} since ${iso(prior.updatedTs)} (${Math.round(behindS / 60)} min), reference ${ref.status}`);
    for (const f of flipsBetween(prior.updatedTs, now)) console.log(`    missed flip → ${marketStatus(f).status} at ${iso(f)}`);
  } else {
    console.log(`  in sync on arrival — account ${prior.status}, last written ${iso(prior.updatedTs)} (${Math.round(behindS / 60)} min ago)`);
  }
} catch (e) { console.error(`  arrival check failed: ${e.message}`); }
console.log('');

for (;;) {
  let flip, onchain;
  try { ({ flip, onchain } = await tick()); }
  catch (e) { console.error(`  crank failed: ${e.message} — retrying in 60s`); await new Promise((r) => setTimeout(r, 60_000)); continue; }
  const now = Math.floor(Date.now() / 1000);
  const wakeTs = Math.min(flip ? flip + 2 : now + HEARTBEAT, now + HEARTBEAT); // flip, or heartbeat — whichever first
  console.log(`  waiting until ${iso(wakeTs)} (${Math.round((wakeTs - now) / 60)} min) · polling every ${POLL_MS / 1000}s\n`);
  const why = await sleepUntil(Math.max(wakeTs, now + 30), onchain.status);
  const woke = Math.floor(Date.now() / 1000);
  if (why === 'diverged') console.log(`  WOKE EARLY — reference left ${onchain.status} at ${iso(woke)}; cranking now`);
  else if (woke > wakeTs + 120) console.log(`  woke ${Math.round((woke - wakeTs) / 60)} min late (suspend or clock jump) — cranking now`);
}

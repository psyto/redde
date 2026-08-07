// readout.mjs — the continuous weekend soundness readout. Rung 2 of "make the demand":
// don't wait for a relier, publish a standing, append-only, reproducible public record.
//
// Each run:
//   1. re-executes every tracked claim (verify Level 1, offline) and keeps the reproduced verdicts
//   2. appends an IMMUTABLE weekly entry to soundness-log/<ISO-week>.json (append-only)
//   3. regenerates soundness-log/README.md — the public board, newest week first
//   4. anchors the week's money-shot on Solana (Memo) — dry-run by default, --send to post
//
// Why this creates demand rather than waiting for it: every row is a COMMAND (node verify.mjs <claim>),
// not an assertion. The record compounds weekly. When a weekend gap finally burns a venue, the log shows
// the finding was published — reproducibly — every week beforehand. The first-mover slot is still empty.
// Don't trust the board — re-execute any row.
//
//   node readout.mjs                                   # assemble + verify + append + board (dry-run anchor)
//   node readout.mjs --send --keypair <path> [--rpc]   # + anchor the week's money-shot on Solana Memo
//   node readout.mjs --week 2026-W31 --force           # (re)build a specific week
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { verifyLevel1 } from './verify.mjs';
import { claimId } from './claim.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(n);
const HERE = new URL('./', import.meta.url);
const LOGDIR = new URL('./soundness-log/', import.meta.url);
const ARCHIVE = new URL('./claims/', LOGDIR);
const EMOJI = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', UNKNOWN: '❓' };
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// The tracked board: the SAME asset on multiple venues — the money-shot is their disagreement.
const TRACKED = [
  { claim: 'claims/jupiter-spyx-cmls.json' },
  { claim: 'claims/kamino-spyx-guard.json' },
];

// ISO-8601 week id (e.g. 2026-W32), computed in UTC.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;           // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);        // Thursday of this week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ftDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - ftDayNum + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
const shortId = (id) => id.slice(0, 12) + '…';

// 1. re-execute each tracked claim; a verdict only counts if it reproduces offline.
function assembleRows() {
  const rows = [];
  for (const t of TRACKED) {
    const claim = JSON.parse(readFileSync(new URL(t.claim, HERE), 'utf8'));
    const l1 = verifyLevel1(claim);
    const isCmls = claim.claim_type === 'closed-market-liquidation-soundness';
    rows.push({
      asset: claim.subject.asset, venue: claim.subject.venue,
      verdict: l1.flag, reproduced: l1.ok,
      claim_id: claim.claim_id, claim_type: claim.claim_type, claim_file: t.claim,
      window: claim.inputs.window, reason: claim.verdict.reason,
      note: claim.verdict.note || null, stress: claim.verdict.stress || null,
      reproduce: `node verify.mjs ${t.claim}${isCmls ? ' --fetch' : ''}`,
    });
    if (!l1.ok) console.error(`  ⚠ ${t.claim} did NOT reproduce — recorded but excluded from the money-shot`);
  }
  return rows;
}

// 1b. Freeze each week's evidence next to the week that cites it.
//
// The log records claim_ids, but claims/*.json is OVERWRITTEN every run with the current window —
// so the moment a week rolled over, the ids its entry cited no longer resolved to anything in the
// tree, and reproducing a past week meant digging through git history. A board whose whole argument
// is "this was published, reproducibly, every week beforehand" cannot have its evidence reachable
// only by archaeology.
//
// claim_id is already a content address (sha256 over the canonical body), so <claim_id>.json is
// self-naming, self-deduplicating, and self-checking: we recompute the id from the bytes we are
// about to write and refuse the write unless it matches its own name. Two runs of the same claim
// collide on the same file with identical bytes; a claim that changed at all gets a different id and
// a different file. Nothing is ever overwritten.
function archiveClaims(rows) {
  mkdirSync(ARCHIVE, { recursive: true });
  let frozen = 0;
  for (const r of rows) {
    const dest = new URL(`./${r.claim_id}.json`, ARCHIVE);
    const bytes = readFileSync(new URL(r.claim_file, HERE), 'utf8');
    const recomputed = claimId(JSON.parse(bytes));
    if (recomputed !== r.claim_id) {
      throw new Error(`archive refused: ${r.claim_file} names ${r.claim_id} but its bytes hash to ${recomputed}`);
    }
    if (existsSync(dest)) {
      if (readFileSync(dest, 'utf8') !== bytes) {
        throw new Error(`archive collision: ${r.claim_id}.json exists with different bytes — content-addressing is broken`);
      }
      continue;                                   // already frozen, byte-identical
    }
    writeFileSync(dest, bytes);
    frozen++;
  }
  return frozen;
}

// Where a week's evidence actually lives now. Past entries were written before the archive existed,
// so resolve by content address and fall back to whatever the entry recorded at the time.
function reproduceCmd(row) {
  const archived = existsSync(new URL(`./${row.claim_id}.json`, ARCHIVE));
  if (!archived) return row.reproduce;
  const isCmls = row.claim_type === 'closed-market-liquidation-soundness';
  return `node verify.mjs soundness-log/claims/${row.claim_id}.json${isCmls ? ' --fetch' : ''}`;
}

// The money-shot: same asset carrying RED and GREEN at once, both reproduced.
function moneyShots(rows) {
  const byAsset = {};
  for (const r of rows) if (r.reproduced) (byAsset[r.asset] ||= []).push(r);
  const out = [];
  for (const [asset, rs] of Object.entries(byAsset)) {
    const red = rs.find((r) => r.verdict === 'RED'), green = rs.find((r) => r.verdict === 'GREEN');
    if (red && green) out.push({ asset, red, green });
  }
  return out;
}

function weeklyMemo(week, ms) {
  return `vesper ${week} | ${ms.asset}: RED@${ms.red.venue}=${ms.red.claim_id} vs GREEN@${ms.green.venue}=${ms.green.claim_id}`
    + ` | same asset, opposite closed-market gap-safety | verify: node verify.mjs`;
}

// 3. regenerate the public board from every weekly entry on disk (newest week first).
function regenerateBoard() {
  const weeks = readdirSync(LOGDIR).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(new URL(f, LOGDIR), 'utf8')))
    .sort((a, b) => (a.week < b.week ? 1 : -1));
  const L = [];
  L.push('# Vesper — weekend soundness readout');
  L.push('');
  L.push('A standing, append-only, **re-executable** record of closed-market liquidation soundness for');
  L.push('tokenized equities on Solana. Each weekend the same asset is graded on multiple venues; every');
  L.push('row is a command you can run, not a claim to trust ([`../MANIFESTO.md`](../MANIFESTO.md)).');
  L.push('');
  L.push('> *Don\'t trust — re-execute.* `node verify.mjs <claim.json>` reproduces any verdict below;');
  L.push('> add `--fetch` to re-pull the on-chain observations. A mismatch is provable, not deniable.');
  L.push('');
  L.push('Every claim a week cites is frozen at `soundness-log/claims/<claim_id>.json`, where the');
  L.push('filename IS the sha256 content address of the claim body. Past weeks reproduce from this');
  L.push('checkout — no git archaeology, and no way to quietly restate what an old week said.');
  L.push('');
  if (!weeks.length) { L.push('_No weeks recorded yet._'); }
  for (const e of weeks) {
    L.push(`## ${e.week}  ·  _generated ${e.generated_iso}_`);
    L.push('');
    L.push('| Asset | Venue | Verdict | Reproduces | Claim | Reproduce |');
    L.push('|---|---|---|:--:|---|---|');
    for (const r of e.rows) {
      L.push(`| ${r.asset} | ${r.venue} | ${EMOJI[r.verdict] || ''} ${r.verdict} | ${r.reproduced ? '✅' : '❌'} | \`${shortId(r.claim_id)}\` | \`${reproduceCmd(r)}\` |`);
    }
    L.push('');
    for (const m of (e.money_shots || [])) {
      L.push(`**Money-shot — ${m.asset}:** ${EMOJI.RED} **RED** on ${m.red.venue} (\`${shortId(m.red.claim_id)}\`) vs ${EMOJI.GREEN} **GREEN** on ${m.green.venue} (\`${shortId(m.green.claim_id)}\`) — same chain, same asset, opposite closed-market gap-safety.`);
    }
    if (e.anchor?.sig) {
      L.push('');
      L.push(`Anchored on Solana: [\`${e.anchor.sig.slice(0, 12)}…\`](https://explorer.solana.com/tx/${e.anchor.sig}?cluster=${e.anchor.cluster || 'devnet'}) · \`${e.anchor.bytes}\`-byte memo.`);
    } else {
      L.push('');
      L.push('_Not yet anchored on-chain (dry-run)._');
    }
    // the honest residual for any GREEN row that carries a note
    for (const r of e.rows) if (r.verdict === 'GREEN' && r.note) L.push(`\n> **${r.venue} ${r.asset} — honest residual.** ${r.note}`);
    L.push('');
  }
  writeFileSync(new URL('./README.md', LOGDIR), L.join('\n'));
  return weeks.length;
}

async function anchorOnChain(memo, keypairPath, rpc) {
  if (memo.length > 566) throw new Error(`memo ${memo.length} > 566 bytes`);
  const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } =
    await import('@solana/web3.js');
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
  const conn = new Connection(rpc, 'confirmed');
  const ix = new TransactionInstruction({
    keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }],
    programId: new PublicKey(MEMO_PROGRAM), data: Buffer.from(memo, 'utf8'),
  });
  return sendAndConfirmTransaction(conn, new Transaction().add(ix), [kp]);
}

// ── run ─────────────────────────────────────────────────────────────────────
const week = opt('--week') || isoWeek(new Date());
mkdirSync(LOGDIR, { recursive: true });
const file = new URL(`./${week}.json`, LOGDIR);

const rows = assembleRows();
const ms = moneyShots(rows);
console.log(`\nVesper readout · ${week}`);
for (const r of rows) console.log(`  ${EMOJI[r.verdict] || ''} ${r.verdict}  ${r.asset} @ ${r.venue}  ${r.reproduced ? 'reproduces ✓' : 'DID NOT REPRODUCE ✗'}  ${shortId(r.claim_id)}`);
for (const m of ms) console.log(`  → money-shot: ${m.asset} RED@${m.red.venue} vs GREEN@${m.green.venue}`);

const frozen = archiveClaims(rows);
console.log(`  archived ${frozen} new claim(s) to soundness-log/claims/ (content-addressed)`);

let entry;
if (existsSync(file) && !has('--force')) {
  entry = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n  soundness-log/${week}.json already exists (append-only) — keeping it; use --force to rebuild.`);
} else {
  entry = {
    week, generated_ts: Math.floor(Date.now() / 1000), generated_iso: new Date().toISOString(),
    rows, money_shots: ms.map((m) => ({ asset: m.asset, red: { venue: m.red.venue, claim_id: m.red.claim_id }, green: { venue: m.green.venue, claim_id: m.green.claim_id } })),
  };
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n');
  console.log(`\n  wrote soundness-log/${week}.json`);
}

// 4. anchor the week's money-shot
if (ms.length) {
  const memo = weeklyMemo(week, ms[0]);
  if (has('--send') && entry.anchor?.sig && !has('--force')) {
    // The log is append-only, but --send used to overwrite `anchor` on any rerun — so a retried or
    // double-fired Monday would silently replace the signature that IS the week's evidence. An
    // anchor already witnessed on-chain is not ours to reissue.
    console.log(`\n  already anchored: ${entry.anchor.sig} (${entry.anchor.cluster}) — not re-anchoring; use --force to replace.`);
  } else if (has('--send')) {
    const keypairPath = opt('--keypair');
    if (!keypairPath) { console.error('  --send requires --keypair <path>'); process.exit(2); }
    const rpc = opt('--rpc') || 'https://api.devnet.solana.com';
    const cluster = rpc.includes('devnet') ? 'devnet' : rpc.includes('testnet') ? 'testnet' : 'mainnet';
    console.log(`  anchoring week money-shot on-chain (${cluster}) …`);
    const sig = await anchorOnChain(memo, keypairPath, rpc);
    entry.anchor = { sig, cluster, bytes: memo.length, memo, ts: Math.floor(Date.now() / 1000) };
    writeFileSync(file, JSON.stringify(entry, null, 2) + '\n');
    console.log(`  anchored: ${sig}`);
  } else {
    console.log(`\n  DRY RUN — week money-shot memo (${memo.length} bytes), not sent:`);
    console.log(`    ${memo}`);
    console.log(`  to anchor: node readout.mjs --send --keypair <path> [--rpc <url>]`);
  }
}

const n = regenerateBoard();
console.log(`\n  regenerated soundness-log/README.md — ${n} week(s) on the board.\n`);

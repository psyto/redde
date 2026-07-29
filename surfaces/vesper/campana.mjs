// Campana — neutral, re-executable closed-market truth feed (engine + self-test)
// Redde lineage: zero-dep, deterministic, verifiable. status is a PURE function of
// (unix timestamp, holiday calendar) — anyone can re-execute it. No clock is read in the core.
//
// Scope: US_EQUITIES_REGULAR (NYSE regular session 09:30–16:00 ET, half-days 09:30–13:00 ET).
// Campana is price-agnostic: it publishes market STATUS + session TIMING only.

export const STATUS = Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED', HALF_DAY: 'HALF_DAY' });

// ── Holiday calendar (versioned input; the ONLY trusted data) ────────────────
// 2026 NYSE full closures + early closes. Illustrative — pin/verify against the
// official NYSE calendar before production. This is `calendar_version` in the spec.
export const CALENDAR_2026 = {
  version: 2026_01,
  holidays: [
    '2026-01-01', // New Year's Day
    '2026-01-19', // MLK Jr. Day
    '2026-02-16', // Washington's Birthday
    '2026-04-03', // Good Friday
    '2026-05-25', // Memorial Day
    '2026-06-19', // Juneteenth
    '2026-07-03', // Independence Day (observed; Jul 4 is a Saturday)
    '2026-09-07', // Labor Day
    '2026-11-26', // Thanksgiving
    '2026-12-25', // Christmas
  ],
  halfDays: [
    '2026-11-27', // day after Thanksgiving — 13:00 ET close
    '2026-12-24', // Christmas Eve — 13:00 ET close
  ],
};

const REG_OPEN_MIN = 9 * 60 + 30;   // 09:30 ET
const REG_CLOSE_MIN = 16 * 60;      // 16:00 ET
const HALF_CLOSE_MIN = 13 * 60;     // 13:00 ET

// ── ET offset (deterministic US Eastern DST, no tz library) ──────────────────
// EDT (UTC-4) from 2nd Sunday of March 02:00 to 1st Sunday of November 02:00, else EST (UTC-5).
function nthSundayOfMonth(year, month /*1-12*/, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}
export function etOffsetHours(ts) {
  const y = new Date(ts * 1000).getUTCFullYear();
  const dstStart = Date.UTC(y, 2, nthSundayOfMonth(y, 3, 2), 7, 0, 0) / 1000; // 07:00 UTC = 02:00 EST
  const dstEnd = Date.UTC(y, 10, nthSundayOfMonth(y, 11, 1), 6, 0, 0) / 1000; // 06:00 UTC = 02:00 EDT
  return ts >= dstStart && ts < dstEnd ? -4 : -5;
}
const pad = (n) => String(n).padStart(2, '0');
function etParts(ts) {
  const off = etOffsetHours(ts);
  const w = new Date((ts + off * 3600) * 1000); // ET wall-clock as a UTC date
  return {
    off,
    y: w.getUTCFullYear(), m: w.getUTCMonth() + 1, d: w.getUTCDate(),
    wday: w.getUTCDay(), // 0=Sun..6=Sat
    min: w.getUTCHours() * 60 + w.getUTCMinutes(),
    date: `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`,
  };
}
// convert an ET wall-clock (y,m,d,minutes) back to a unix timestamp
function etWallToUnix(y, m, d, minutes) {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) / 1000;
  return guess - etOffsetHours(guess) * 3600;
}

// ── Trading-day classification ───────────────────────────────────────────────
function dayKind(dateStr, wday, cal) {
  if (wday === 0 || wday === 6) return 'weekend';
  if (cal.holidays.includes(dateStr)) return 'holiday';
  if (cal.halfDays.includes(dateStr)) return 'half';
  return 'full';
}
function closeMinFor(kind) { return kind === 'half' ? HALF_CLOSE_MIN : REG_CLOSE_MIN; }

// ── The pure status function (the whole point) ───────────────────────────────
export function marketStatus(ts, cal = CALENDAR_2026) {
  const p = etParts(ts);
  const kind = dayKind(p.date, p.wday, cal);
  const isTrading = kind === 'full' || kind === 'half';
  const closeMin = closeMinFor(kind);

  let status = STATUS.CLOSED;
  let session_open_ts = null, session_close_ts = null;
  if (isTrading && p.min >= REG_OPEN_MIN && p.min < closeMin) {
    status = kind === 'half' ? STATUS.HALF_DAY : STATUS.OPEN;
    session_open_ts = etWallToUnix(p.y, p.m, p.d, REG_OPEN_MIN);
    session_close_ts = etWallToUnix(p.y, p.m, p.d, closeMin);
  }

  // last regular-session close at or before ts (walk back up to 10 days)
  let last_close_ts = null;
  for (let back = 0; back < 10 && last_close_ts === null; back++) {
    const probe = ts - back * 86400;
    const pp = etParts(probe);
    const k = dayKind(pp.date, pp.wday, cal);
    if (k === 'full' || k === 'half') {
      const c = etWallToUnix(pp.y, pp.m, pp.d, closeMinFor(k));
      if (c <= ts) last_close_ts = c;
    }
  }

  return {
    market_id: 'US_EQUITIES_REGULAR',
    status, dateET: p.date, etOffset: p.off, dayKind: kind,
    session_open_ts, session_close_ts, last_close_ts,
    calendar_version: cal.version,
  };
}

// convenience: `now` — reads the clock only at the edge, core stays pure
export function statusNow(cal = CALENDAR_2026) { return marketStatus(Math.floor(Date.now() / 1000), cal); }

// ── Self-test ────────────────────────────────────────────────────────────────
function U(iso) { return Math.floor(Date.parse(iso + 'Z') / 1000); } // iso is UTC
function run() {
  const cases = [
    // [label, unix, expectedStatus]
    ['Thu 2026-07-23 14:00 ET (18:00 UTC) mid-session', U('2026-07-23T18:00:00'), STATUS.OPEN],
    ['Thu 2026-07-23 08:00 ET (12:00 UTC) pre-open', U('2026-07-23T12:00:00'), STATUS.CLOSED],
    ['Thu 2026-07-23 16:30 ET (20:30 UTC) after close', U('2026-07-23T20:30:00'), STATUS.CLOSED],
    ['Sat 2026-07-18 12:00 ET (backtest weekend)', U('2026-07-18T16:00:00'), STATUS.CLOSED],
    ['Sun 2026-07-19 12:00 ET (backtest weekend)', U('2026-07-19T16:00:00'), STATUS.CLOSED],
    ['Fri 2026-07-03 12:00 ET (Independence Day obs.)', U('2026-07-03T16:00:00'), STATUS.CLOSED],
    ['Fri 2026-11-27 12:00 ET (half-day, before 13:00)', U('2026-11-27T17:00:00'), STATUS.HALF_DAY],
    ['Fri 2026-11-27 13:30 ET (half-day, after close)', U('2026-11-27T18:30:00'), STATUS.CLOSED],
    ['Wed 2026-01-14 10:00 ET winter EST offset', U('2026-01-14T15:00:00'), STATUS.OPEN],
  ];
  let pass = 0;
  console.log('\nCampana — self-test (US_EQUITIES_REGULAR, calendar 2026)\n');
  for (const [label, ts, exp] of cases) {
    const r = marketStatus(ts);
    const ok = r.status === exp;
    pass += ok ? 1 : 0;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.status.padEnd(8)} (exp ${exp.padEnd(8)}) ET${r.etOffset}  ${label}`);
    if (!ok) console.log(`        got`, r);
  }
  // DST check
  const dstOk = etOffsetHours(U('2026-01-14T15:00:00')) === -5 && etOffsetHours(U('2026-07-23T18:00:00')) === -4;
  console.log(`  ${dstOk ? 'PASS' : 'FAIL'}  DST offset: Jan=EST(-5), Jul=EDT(-4)`);
  console.log(`\n  ${pass}/${cases.length} status cases + DST ${dstOk ? 'ok' : 'FAIL'}\n`);

  // Closed-market window demonstration — the exact weekend Jupiter liquidated through
  console.log('Demonstration — the window Jupiter Lend ignored (Campana would have flipped it):');
  const iso = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
  for (const t of [
    '2026-07-17T19:30:00', // Fri 15:30 ET — OPEN
    '2026-07-17T20:30:00', // Fri 16:30 ET — CLOSED (bell)
    '2026-07-18T16:00:00', // Sat — CLOSED
    '2026-07-19T16:00:00', // Sun — CLOSED
    '2026-07-20T14:00:00', // Mon 10:00 ET — OPEN
  ]) {
    const ts = U(t), r = marketStatus(ts);
    const lc = r.last_close_ts ? iso(r.last_close_ts) + ' UTC' : '—';
    console.log(`  ${iso(ts)} UTC  →  ${r.status.padEnd(8)}  last_close=${lc}`);
  }
  console.log('\n  → band anchors to the Fri 20:00 UTC close and stays engaged all weekend,');
  console.log('    exactly the window Jupiter\'s 24/7 feed liquidated through.\n');
  return pass === cases.length && dstOk;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = run();
  process.exit(ok ? 0 : 1);
}

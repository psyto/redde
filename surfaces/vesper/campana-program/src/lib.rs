// Campana — on-chain market-status truth feed (Pinocchio). The SAME deterministic function as
// campana.mjs: status is a pure function of (unix timestamp, holiday calendar). The on-chain Crank reads
// the Solana Clock and publishes OPEN / CLOSED / HALF_DAY + last regular-session close into a state account
// that venues can read to gate closed-market liquidations. Anyone re-executes campana.mjs (or these tests)
// to verify the on-chain value — don't trust the status bit, re-execute it. Only trusted input: the
// versioned NYSE holiday calendar (below). Time comes from the on-chain Clock; no price, no oracle.
#![cfg_attr(feature = "bpf-entrypoint", no_std)]

// ── status codes (byte 0 of the state account) ──────────────────────────────────
pub const CLOSED: u8 = 0;
pub const OPEN: u8 = 1;
pub const HALF_DAY: u8 = 2;

// ── the ONLY trusted input: a versioned NYSE calendar (mirrors campana.mjs CALENDAR_2026) ────────
pub const CALENDAR_VERSION: u32 = 202601;
const HOLIDAYS: &[(i32, u8, u8)] = &[
    (2026, 1, 1), (2026, 1, 19), (2026, 2, 16), (2026, 4, 3), (2026, 5, 25),
    (2026, 6, 19), (2026, 7, 3), (2026, 9, 7), (2026, 11, 26), (2026, 12, 25),
];
const HALF_DAYS: &[(i32, u8, u8)] = &[(2026, 11, 27), (2026, 12, 24)];

const REG_OPEN_MIN: i64 = 9 * 60 + 30; // 09:30 ET
const REG_CLOSE_MIN: i64 = 16 * 60; // 16:00 ET
const HALF_CLOSE_MIN: i64 = 13 * 60; // 13:00 ET

// ── pure civil-date math (Howard Hinnant's algorithms; integer-only, no_std-safe) ────────────────
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let mm = m as i64;
    let doy = (153 * (if mm > 2 { mm - 3 } else { mm + 9 }) + 2) / 5 + (d as i64 - 1); // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}
// 0 = Sunday .. 6 = Saturday (1970-01-01 was a Thursday)
fn weekday(days: i64) -> u32 { ((days.rem_euclid(7) + 4).rem_euclid(7)) as u32 }
fn nth_sunday(y: i64, month: u32, n: i64) -> u32 {
    let dow = weekday(days_from_civil(y, month, 1)) as i64;
    (1 + (7 - dow).rem_euclid(7) + (n - 1) * 7) as u32
}
// US Eastern DST: EDT (UTC-4) from 2nd Sunday of March 02:00 to 1st Sunday of November 02:00, else EST (-5).
fn et_offset_hours(ts: i64) -> i64 {
    let (y, _, _) = civil_from_days(ts.div_euclid(86400));
    let dst_start = days_from_civil(y, 3, nth_sunday(y, 3, 2)) * 86400 + 7 * 3600; // 07:00 UTC = 02:00 EST
    let dst_end = days_from_civil(y, 11, nth_sunday(y, 11, 1)) * 86400 + 6 * 3600; // 06:00 UTC = 02:00 EDT
    if ts >= dst_start && ts < dst_end { -4 } else { -5 }
}
fn et_parts(ts: i64) -> (i64, u32, u32, u32, i64) {
    let off = et_offset_hours(ts);
    let wall = ts + off * 3600;
    let days = wall.div_euclid(86400);
    let secs = wall - days * 86400;
    let (y, m, d) = civil_from_days(days);
    (y, m, d, weekday(days), secs / 60)
}
fn et_wall_to_unix(y: i64, m: u32, d: u32, minutes: i64) -> i64 {
    let guess = days_from_civil(y, m, d) * 86400 + (minutes / 60) * 3600 + (minutes % 60) * 60;
    guess - et_offset_hours(guess) * 3600
}
// 0 = weekend, 1 = holiday, 2 = half-day, 3 = full trading day
fn day_kind(y: i64, m: u32, d: u32, wday: u32) -> u8 {
    if wday == 0 || wday == 6 { return 0; }
    let key = (y as i32, m as u8, d as u8);
    if HOLIDAYS.contains(&key) { return 1; }
    if HALF_DAYS.contains(&key) { return 2; }
    3
}

/// The pure status function — the whole point. Deterministic in (ts, calendar).
pub struct MarketStatus {
    pub status: u8,
    pub day_kind: u8,
    pub et_offset: i64,
    pub year: i64,
    pub month: u32,
    pub day: u32,
    pub last_close_ts: i64,
}
pub fn market_status(ts: i64) -> MarketStatus {
    let (y, m, d, wday, min) = et_parts(ts);
    let kind = day_kind(y, m, d, wday);
    let trading = kind == 2 || kind == 3;
    let close_min = if kind == 2 { HALF_CLOSE_MIN } else { REG_CLOSE_MIN };
    let status = if trading && min >= REG_OPEN_MIN && min < close_min {
        if kind == 2 { HALF_DAY } else { OPEN }
    } else {
        CLOSED
    };
    // last regular-session close at or before ts (walk back up to 10 days)
    let mut last_close_ts = 0i64;
    let mut back = 0i64;
    while back < 10 {
        let probe = ts - back * 86400;
        let (py, pm, pd, pwday, _) = et_parts(probe);
        let k = day_kind(py, pm, pd, pwday);
        if k == 2 || k == 3 {
            let cmin = if k == 2 { HALF_CLOSE_MIN } else { REG_CLOSE_MIN };
            let c = et_wall_to_unix(py, pm, pd, cmin);
            if c <= ts { last_close_ts = c; break; }
        }
        back += 1;
    }
    MarketStatus { status, day_kind: kind, et_offset: et_offset_hours(ts), year: y, month: m, day: d, last_close_ts }
}

// ── state account layout (32 bytes) — what venues read ──────────────────────────
pub const STATE_LEN: usize = 32;
/// Serialize the status into a venue-readable account. Pure (testable without a runtime).
pub fn write_state(dst: &mut [u8], s: &MarketStatus, ts: i64) -> bool {
    if dst.len() < STATE_LEN {
        return false;
    }
    dst[0] = s.status;
    dst[1] = s.day_kind;
    dst[2] = s.et_offset as i8 as u8;
    dst[3] = 0;
    dst[4..8].copy_from_slice(&CALENDAR_VERSION.to_le_bytes());
    dst[8..16].copy_from_slice(&ts.to_le_bytes());
    dst[16..24].copy_from_slice(&s.last_close_ts.to_le_bytes());
    dst[24..28].copy_from_slice(&(s.year as i32).to_le_bytes());
    dst[28] = s.month as u8;
    dst[29] = s.day as u8;
    dst[30] = 0;
    dst[31] = 0;
    true
}

// ── on-chain program (Pinocchio) — compiled only for the BPF target ──────────────────────────────
#[cfg(feature = "bpf-entrypoint")]
mod onchain {
    use super::{market_status, write_state};
    use pinocchio::{
        account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey,
        sysvars::{clock::Clock, Sysvar}, ProgramResult,
    };

    pinocchio_pubkey::declare_id!("1111111QLbz7JHiBTspS962RLKV8GndWFwiEaqKM"); // placeholder — set on deploy

    pinocchio::program_entrypoint!(entry);
    pinocchio::default_allocator!();
    #[panic_handler]
    fn panic_handler(_: &core::panic::PanicInfo<'_>) -> ! { loop {} }

    fn entry(program_id: &Pubkey, accounts: &[AccountInfo], ix: &[u8]) -> ProgramResult {
        match ix.first().copied().unwrap_or(0) {
            0 => crank(program_id, accounts), // Crank: read Clock → publish status (permissionless)
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }

    fn crank(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let state = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
        if !state.is_writable() {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        let ts = Clock::get()?.unix_timestamp;
        let s = market_status(ts);
        let mut data = state.try_borrow_mut_data()?;
        if !write_state(&mut data, &s, ts) {
            return Err(ProgramError::AccountDataTooSmall);
        }
        Ok(())
    }
}

// ── cross-check: the on-chain logic reproduces campana.mjs's self-test verdicts ───────────────────
#[cfg(test)]
mod tests {
    use super::*;
    fn utc(y: i64, mo: u32, d: u32, h: i64, mi: i64) -> i64 {
        days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60
    }

    #[test]
    fn reproduces_campana_reference_verdicts() {
        // (unix ts, expected status, label) — the exact cases campana.mjs's self-test asserts.
        let cases: &[(i64, u8, &str)] = &[
            (utc(2026, 7, 23, 18, 0), OPEN, "Thu 14:00 ET mid-session (EDT)"),
            (utc(2026, 7, 23, 12, 0), CLOSED, "Thu 08:00 ET pre-open"),
            (utc(2026, 7, 23, 20, 30), CLOSED, "Thu 16:30 ET after close"),
            (utc(2026, 7, 18, 16, 0), CLOSED, "Sat weekend"),
            (utc(2026, 7, 19, 16, 0), CLOSED, "Sun weekend"),
            (utc(2026, 7, 3, 16, 0), CLOSED, "Fri Independence Day (obs) holiday"),
            (utc(2026, 11, 27, 18, 30), CLOSED, "Fri 13:30 ET half-day after close"),
            (utc(2026, 11, 27, 17, 0), HALF_DAY, "Fri 12:00 ET during half session"),
            (utc(2026, 1, 14, 15, 0), OPEN, "Wed 10:00 ET winter EST mid-session"),
        ];
        for (ts, want, label) in cases {
            let got = market_status(*ts).status;
            assert_eq!(got, *want, "{}: got {} want {}", label, got, want);
        }
    }

    #[test]
    fn et_offset_flips_with_dst() {
        assert_eq!(market_status(utc(2026, 1, 14, 15, 0)).et_offset, -5); // January → EST
        assert_eq!(market_status(utc(2026, 7, 23, 18, 0)).et_offset, -4); // July → EDT
    }

    #[test]
    fn last_close_is_prior_regular_close() {
        // Sunday 2026-07-19 → last close is Friday 2026-07-17 16:00 ET.
        let sun = utc(2026, 7, 19, 16, 0);
        let s = market_status(sun);
        assert_eq!(s.last_close_ts, et_wall_to_unix(2026, 7, 17, REG_CLOSE_MIN));
        assert!(s.last_close_ts <= sun);
    }

    #[test]
    fn state_serializes() {
        let mut buf = [0u8; STATE_LEN];
        let s = market_status(utc(2026, 7, 23, 18, 0));
        assert!(write_state(&mut buf, &s, utc(2026, 7, 23, 18, 0)));
        assert_eq!(buf[0], OPEN);
        assert_eq!(u32::from_le_bytes(buf[4..8].try_into().unwrap()), CALENDAR_VERSION);
    }
}

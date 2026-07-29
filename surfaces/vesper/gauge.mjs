// Vesper — weekend safety gauge (user-facing)
// "Can I hold my Jupiter Lend xStock position through the closed-market window?"
// Powered by campana.mjs (is the market open?) + the CMLS buffer logic. Pure core.

import { marketStatus, statusNow, STATUS } from './campana.mjs';

// Real Jupiter Lend xStock vaults (mainnet, decoded 2026-07-23). CF = collateral factor,
// LT = liquidation threshold. Liquidation triggers once LTV (debt / collateral value) ≥ LT.
export const JUP_XSTOCK_VAULTS = [
  { vault: 77, ticker: 'TSLAx', name: 'Tesla', mint: 'XsDoVfqe…', cf: 0.65, lt: 0.75 },
  { vault: 78, ticker: 'SPYx', name: 'S&P 500', mint: 'XsoCS1Tf…', cf: 0.75, lt: 0.85 },
  { vault: 79, ticker: 'QQQx', name: 'Nasdaq 100', mint: 'Xs8S1uUs…', cf: 0.75, lt: 0.85 },
  { vault: 80, ticker: 'NVDAx', name: 'NVIDIA', mint: 'Xsc9qvGR…', cf: 0.65, lt: 0.75 },
];

// ── The gauge (pure) ─────────────────────────────────────────────────────────
// A position is safe over a closed market if, after an assumed adverse gap `tailGap`,
// its LTV would still sit below the liquidation threshold:  ltv / (1 - tailGap) < lt.
export function weekendGauge({ ltv, lt, tailGap = 0.12, status }) {
  const safeMaxLtv = lt * (1 - tailGap);          // hold below this and you survive the gap
  const gapSurvivable = Math.max(0, 1 - ltv / lt); // the drop this position can take before liq

  if (status === STATUS.OPEN) {
    return { verdict: 'INACTIVE', label: 'market open — guard inactive',
      safeMaxLtv, gapSurvivable, action: 'Standard liquidation risk applies while the market is open.' };
  }
  if (ltv >= lt) {
    return { verdict: 'LIQUIDATABLE', label: 'already at/above threshold',
      safeMaxLtv, gapSurvivable, action: 'Position is at the liquidation threshold — act immediately.' };
  }
  if (ltv <= safeMaxLtv) {
    return { verdict: 'SAFE', label: 'safe to hold through the close',
      safeMaxLtv, gapSurvivable, action: 'None — buffer survives the assumed weekend gap.' };
  }
  const repayFrac = 1 - safeMaxLtv / ltv;          // fraction of debt to repay to reach safeMaxLtv
  return { verdict: 'DE-RISK', label: 'thin buffer for the closed window',
    safeMaxLtv, gapSurvivable,
    action: `Reduce LTV to ≤ ${(safeMaxLtv * 100).toFixed(1)}% before the close — repay ≈ ${(repayFrac * 100).toFixed(1)}% of your debt (or add collateral).` };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function pct(x) { return (x * 100).toFixed(1) + '%'; }
const EMOJI = { SAFE: '✅', 'DE-RISK': '⚠️ ', LIQUIDATABLE: '🔴', INACTIVE: '➖' };

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}
function tsFromAt(at) {
  if (!at) return Math.floor(Date.now() / 1000);
  let s = at.includes('T') ? at : at + 'T18:00:00';
  if (!s.endsWith('Z')) s += 'Z';
  return Math.floor(Date.parse(s) / 1000);
}
function usage() {
  console.log(`
Vesper weekend gauge — try your own Jupiter Lend xStock position:

  node gauge.mjs --stock TSLAx --ltv 0.68
  node gauge.mjs --stock SPYx --collateral 10000 --debt 7000 --gap 0.15
  node gauge.mjs --stock NVDAx --ltv 0.70 --at 2026-07-18     # test a specific (closed) day

  --stock <TSLAx|NVDAx|SPYx|QQQx>   your xStock (sets its liq threshold: TSLAx/NVDAx 75%, SPYx/QQQx 85%)
  --vault <77|78|79|80>   or by internal vault id
  --lt <0..1>             or set the liquidation threshold directly
  --ltv <0..1>            your loan-to-value                (or use --collateral & --debt)
  --collateral <usd> --debt <usd>
  --gap <0..1>            weekend gap to survive (default 0.12; routine measured ≈ 0.01)
  --at <ISO|YYYY-MM-DD>   evaluate market status at this time (default: now)

No args → runs the reference scenario below.
`);
}
function runOne(a) {
  const tail = a.gap != null ? Number(a.gap) : 0.12;
  const ts = tsFromAt(a.at);
  const ms = marketStatus(ts);
  let lt, vlabel;
  const byStock = a.stock && JUP_XSTOCK_VAULTS.find((x) => x.ticker.toLowerCase() === String(a.stock).toLowerCase());
  const byVault = a.vault != null && JUP_XSTOCK_VAULTS.find((x) => String(x.vault) === String(a.vault));
  const v = byStock || byVault;
  if ((a.stock || a.vault != null) && !v) { console.error(`unknown xStock — have TSLAx, NVDAx, SPYx, QQQx`); process.exit(1); }
  if (v) { lt = v.lt; vlabel = `${v.ticker} (${v.name}) · Jupiter Lend`; }
  else if (a.lt != null) { lt = Number(a.lt); vlabel = `custom LT ${pct(Number(a.lt))}`; }
  else { lt = 0.75; vlabel = 'default LT 75%'; }

  let ltv;
  if (a.ltv != null) ltv = Number(a.ltv);
  else if (a.collateral != null && a.debt != null) ltv = Number(a.debt) / Number(a.collateral);
  else { console.error('need --ltv, or --collateral and --debt'); usage(); process.exit(1); }

  const g = weekendGauge({ ltv, lt, tailGap: tail, status: ms.status });
  const lc = ms.last_close_ts ? new Date(ms.last_close_ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  console.log('\nVesper — weekend safety gauge\n');
  console.log(`  ${vlabel} · liq threshold ${pct(lt)} · your LTV ${pct(ltv)}`);
  console.log(`  market status (Campana @ ${new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC): ${ms.status} · last close ${lc}`);
  console.log(`  weekend gap to survive: ${pct(tail)} · weekend-safe max LTV: ${pct(g.safeMaxLtv)}\n`);
  console.log(`  ${EMOJI[g.verdict] || ''} ${g.verdict} — ${g.label}`);
  console.log(`  survives an adverse gap of ${pct(g.gapSurvivable)} at current LTV`);
  console.log(`  → ${g.action}\n`);
}

function run() {
  const TAIL = 0.12; // assumed adverse weekend gap to survive (band_extreme in REMEDIATION); routine backtest drift was ~1%
  const live = statusNow();
  console.log('\nVesper — weekend safety gauge · Jupiter Lend xStock position\n');
  console.log(`  live market status (Campana): ${live.status}` +
    (live.last_close_ts ? `  · last regular close ${new Date(live.last_close_ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''));
  console.log(`  assumed weekend gap to survive: ${pct(TAIL)}   (routine measured weekend drift ≈ 1%)`);

  // Deterministic scenario: the closed window Jupiter liquidates through (backtest Saturday).
  const sat = Math.floor(Date.parse('2026-07-18T16:00:00Z') / 1000);
  const status = marketStatus(sat).status; // CLOSED
  const v = JUP_XSTOCK_VAULTS[0];           // TSLAx, LT 75%
  console.log(`\n  Scenario — market ${status} (Sat 2026-07-18) · ${v.ticker} (${v.name}) on Jupiter Lend · liq threshold ${pct(v.lt)}`);
  console.log(`  weekend-safe max LTV = ${pct(v.lt)} × (1 − ${pct(TAIL)}) = ${pct(v.lt * (1 - TAIL))}\n`);
  console.log('    your LTV   verdict         survives gap   action');
  for (const ltv of [0.50, 0.62, 0.66, 0.70, 0.74]) {
    const g = weekendGauge({ ltv, lt: v.lt, tailGap: TAIL, status });
    console.log(`    ${pct(ltv).padEnd(9)} ${(EMOJI[g.verdict] + ' ' + g.verdict).padEnd(15)} ${pct(g.gapSurvivable).padEnd(14)} ${g.action}`);
  }

  console.log('\n  How a user uses it: before the Friday close, check your position here.');
  console.log('  ✅ SAFE → hold through the weekend.  ⚠️  DE-RISK → repay/add collateral first.');
  console.log('  Honest limit: this manages YOUR buffer; it does not make Jupiter risk-free.');
  console.log('  Full safety = Jupiter adopting Campana + the band (→ Vesper 🟢, guard no longer needed).\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (a.help != null || a.h != null) usage();
  else if (a.ltv != null || (a.collateral != null && a.debt != null)) runOne(a);
  else run();
}

// Generate the public board (site/board.html) from scan-results.json.
//   node gen-board.mjs
import { readFileSync, writeFileSync } from "node:fs";

const { summary, board } = JSON.parse(readFileSync(new URL("./scan-results.json", import.meta.url)));
let marinade = null;
try { marinade = JSON.parse(readFileSync(new URL("./marinade-result.json", import.meta.url))); } catch {}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n0 = (x) => Math.round(x).toLocaleString("en-US");
const n3 = (lamports) => (Number(BigInt(lamports)) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 });
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const STATUS = {
  GREEN: { cls: "g", label: "GREEN" },
  RED: { cls: "r", label: "RED" },
  "STALE-EPOCH": { cls: "s", label: "STALE" },
  UNVERIFIED: { cls: "u", label: "UNVERIFIED" },
};

function detail(r) {
  if (r.status === "GREEN") {
    const drift = r.supplyDrift && r.supplyDrift !== "0" ? ` · supply-drift +${r.supplyDrift}` : "";
    return `backing +${(r.marginSol ?? 0).toFixed(1)} SOL over claim · ${r.usablePdas} usable PDAs${drift}`;
  }
  if (r.status === "RED") return esc(r.reason || "invariant failed");
  if (r.status === "STALE-EPOCH") return `header frozen ${r.lag} epoch${r.lag === 1 ? "" : "s"} ago (epoch ${r.epoch})`;
  return "fresh, but backing could not be read this cycle (RPC limit) — re-verify pending";
}

const rows = board.map((r, i) => {
  const st = STATUS[r.status] ?? { cls: "u", label: r.status };
  return `<tr class="row-${st.cls}">
    <td class="num">${i + 1}</td>
    <td class="mono"><a href="https://solscan.io/account/${esc(r.pool)}" title="${esc(r.pool)}">${esc(short(r.pool))}</a></td>
    <td class="num sol">${n0(r.totalSol)}</td>
    <td><span class="pill ${st.cls}">${st.label}</span></td>
    <td class="detail">${detail(r)}</td>
  </tr>`;
}).join("\n");

const tile = (label, value, cls = "") => `<div class="tile ${cls}"><div class="tval">${value}</div><div class="tlabel">${label}</div></div>`;

function marinadeCard(m) {
  if (!m || !m.inv2b || !m.inv2b.available) return "";
  const st = STATUS[m.verdict] ?? { cls: "u", label: m.verdict };
  const margin = (BigInt(m.inv2b.backing) - BigInt(m.liability)).toString();
  return `<div class="wrap"><div class="class2">
    <div class="c2head">
      <span class="label">Invariant class #2 · Marinade (mSOL) · non-SPL, Anchor custody</span>
      <span class="pill ${st.cls}">${st.label}</span>
    </div>
    <p class="c2lede">The same engine, a second architecture. Backing reconstructed from Marinade's own
    <span class="mono">stake_list</span> — ${m.inv2b.usableStakes} stake accounts, rent-netted, ${m.inv2b.ticketCount}
    unstake tickets deducted and reconciled to the header — with zero cooperation. <span class="mono">msol_price</span>
    (display-only) and the LP leg are excluded.</p>
    <dl class="c2figs">
      <div><dt>redeemable liability</dt><dd>${n3(m.liability)} SOL</dd></div>
      <div><dt>independent net backing</dt><dd>${n3(m.inv2b.backing)} SOL</dd></div>
      <div><dt>margin</dt><dd class="pos">+${n3(margin)} SOL</dd></div>
    </dl>
  </div></div>`;
}

const html = `<title>Redde — The Board</title>
<style>
  :root{
    --paper:#ECE9E2;--panel:#E4E0D6;--ink:#17130F;--ink-2:#5b5347;--hair:#cbc4b5;
    --seal:#8a2226;--green:#2f5d46;--amber:#8a6a1e;--grey:#6f6a60;
    --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
    --mono:ui-monospace,"SF Mono","SFMono-Regular",Menlo,Consolas,monospace;
    --edge:clamp(1rem,4vw,3.5rem);
  }
  @media (prefers-color-scheme:dark){:root{
    --paper:#12100c;--panel:#1a1712;--ink:#e9e3d6;--ink-2:#9a9082;--hair:#2e2a22;
    --seal:#cf5a53;--green:#7bab8b;--amber:#c69f52;--grey:#8b8579;}}
  :root[data-theme="light"]{--paper:#ECE9E2;--panel:#E4E0D6;--ink:#17130F;--ink-2:#5b5347;--hair:#cbc4b5;--seal:#8a2226;--green:#2f5d46;--amber:#8a6a1e;--grey:#6f6a60;}
  :root[data-theme="dark"]{--paper:#12100c;--panel:#1a1712;--ink:#e9e3d6;--ink-2:#9a9082;--hair:#2e2a22;--seal:#cf5a53;--green:#7bab8b;--amber:#c69f52;--grey:#8b8579;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);line-height:1.55;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:60rem;margin:0 auto;padding:0 var(--edge);}
  .label{font-family:var(--mono);font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-2);}
  header.mast{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:1.3rem 0 1rem;flex-wrap:wrap;}
  .mast .mark{font-family:var(--mono);font-weight:600;letter-spacing:.18em;text-transform:uppercase;font-size:.82rem;}
  .mast .lat{font-style:italic;color:var(--ink-2);font-size:.95rem;}
  hr.dbl{height:3px;border:0;margin:0;background:linear-gradient(var(--ink),var(--ink)) top/100% 1px no-repeat,linear-gradient(var(--ink),var(--ink)) bottom/100% 1px no-repeat;}
  .hero{padding:clamp(2rem,6vw,3.5rem) 0 1.5rem;}
  h1{font-family:var(--serif);font-weight:600;font-size:clamp(2rem,6vw,3.4rem);line-height:1.02;letter-spacing:-.015em;text-wrap:balance;margin:.8rem 0 1rem;}
  h1 em{font-style:italic;color:var(--seal);}
  .lede{max-width:38rem;font-size:clamp(1.02rem,2vw,1.18rem);color:var(--ink);}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:1px;background:var(--hair);border:1px solid var(--hair);margin:1.8rem 0 .6rem;}
  .tile{background:var(--paper);padding:1.1rem 1rem;}
  .tval{font-family:var(--mono);font-size:1.7rem;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.02em;}
  .tlabel{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);margin-top:.35rem;}
  .tile.g .tval{color:var(--green);} .tile.s .tval{color:var(--amber);} .tile.r .tval{color:var(--seal);} .tile.u .tval{color:var(--grey);}
  .coverage{font-size:.95rem;color:var(--ink-2);max-width:44rem;margin:.4rem 0 0;}
  .class2{border:1px solid var(--hair);border-top:3px solid var(--green);background:var(--panel);padding:clamp(1.2rem,3vw,2rem);margin:2.2rem 0 .5rem;}
  .c2head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap;margin-bottom:.9rem;}
  .c2lede{max-width:44rem;font-size:.98rem;color:var(--ink);margin:0 0 1.2rem;}
  .c2figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:1px;background:var(--hair);border:1px solid var(--hair);}
  .c2figs>div{background:var(--paper);padding:1rem 1.1rem;}
  .c2figs dt{font-family:var(--mono);font-size:.64rem;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-2);}
  .c2figs dd{margin:.3rem 0 0;font-family:var(--mono);font-size:1.15rem;font-weight:600;font-variant-numeric:tabular-nums;}
  .c2figs dd.pos{color:var(--green);}
  section{padding:2rem 0 3rem;}
  .tablewrap{overflow-x:auto;border:1px solid var(--hair);margin-top:1.2rem;}
  table{border-collapse:collapse;width:100%;font-size:.9rem;min-width:38rem;}
  thead th{font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);text-align:left;padding:.7rem .8rem;border-bottom:1px solid var(--hair);background:var(--panel);position:sticky;top:0;}
  td{padding:.55rem .8rem;border-bottom:1px solid var(--hair);vertical-align:baseline;}
  tbody tr:hover{background:var(--panel);}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
  .mono{font-family:var(--mono);} .mono a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--hair);}
  .mono a:hover{border-bottom-color:var(--seal);}
  .sol{color:var(--ink);} .detail{color:var(--ink-2);font-size:.85rem;}
  .pill{font-family:var(--mono);font-size:.66rem;letter-spacing:.1em;font-weight:600;text-transform:uppercase;padding:.2em .6em;border-radius:999px;border:1.5px solid;white-space:nowrap;}
  .pill.g{color:var(--green);border-color:var(--green);} .pill.r{color:var(--seal);border-color:var(--seal);}
  .pill.s{color:var(--amber);border-color:var(--amber);} .pill.u{color:var(--grey);border-color:var(--grey);}
  .row-g td{background:color-mix(in srgb,var(--green) 5%,transparent);}
  .row-r td{background:color-mix(in srgb,var(--seal) 6%,transparent);}
  footer{padding:2rem 0 3.5rem;font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;color:var(--ink-2);text-transform:uppercase;}
  footer .lat{font-family:var(--serif);font-style:italic;text-transform:none;font-size:1.05rem;color:var(--seal);letter-spacing:0;}
</style>

<div class="wrap">
  <header class="mast"><span class="mark">Redde · The Board</span><span class="lat">redde rationem</span></header>
</div>
<div class="wrap"><hr class="dbl"/></div>

<div class="wrap">
  <div class="hero">
    <span class="label">Every SPL stake pool + Marinade · epoch ${summary.epoch}</span>
    <h1>We ran it against <em>all of them.</em></h1>
    <p class="lede">Redde audited every liquid-staking stake pool on Solana mainnet — and
    Marinade, a second architecture — with zero cooperation from any of them, using one engine.
    This is the board.</p>
  </div>

  <div class="tiles">
    ${tile("pools scanned", summary.pools)}
    ${tile("green", summary.green, "g")}
    ${tile("red", summary.red, "r")}
    ${tile("stale (frozen)", summary.staleEpoch, "s")}
    ${tile("unverified", summary.unverified, "u")}
    ${tile("SOL verified", n0(summary.totalSolFullyVerified))}
  </div>
  <p class="coverage">Of ${summary.pools} pools, <b>${summary.staleEpoch}</b> fail the
  freshness gate — their on-chain accounting is frozen a full epoch or more behind,
  so current redeemability cannot be independently verified. <b>${summary.green + summary.red}</b>
  were fully checked (${n0(summary.totalSolFullyVerified)} of ${n0(summary.totalSolObserved)} SOL
  observed); <b>${summary.red}</b> insolvent. <b>${summary.unverified}</b> are fresh but
  their backing could not be read this cycle under public-RPC limits — re-verification
  pending, <em>not</em> a finding. This is not a complete solvency audit; it is an
  honest board of what could be proven now.</p>
</div>

${marinadeCard(marinade)}

<section>
  <div class="wrap">
    <span class="label">Invariant class #1 · SPL stake pools · sorted by size</span>
    <div class="tablewrap">
      <table>
        <thead><tr><th>#</th><th>Pool</th><th>SOL</th><th>Verdict</th><th>Detail</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>
</section>

<div class="wrap"><hr class="dbl"/></div>
<footer><div class="wrap">
  Reads only · no protocol cooperation · reproducible from <span class="mono">verify.mjs</span> ·
  a GREEN survives an independent backing check, not a safety blessing &nbsp;·&nbsp;
  <span class="lat">redde rationem.</span>
</div></footer>
`;

writeFileSync(new URL("./site/board.html", import.meta.url), html);
console.log(`wrote site/board.html — ${board.length} rows, ${summary.green} GREEN / ${summary.staleEpoch} STALE-EPOCH / ${summary.unverified} UNVERIFIED / ${summary.red} RED`);

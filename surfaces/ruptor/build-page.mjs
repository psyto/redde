// Ruptor — build the shareable page from a live snapshot.
//   node ruptor.mjs --json > snapshot.json && node build-page.mjs
// Emits break.html: a self-contained, theme-aware, interactive artifact. Zero deps.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2] || 'snapshot.json';
const OUT = process.argv[3] || 'break.html';
const snap = JSON.parse(readFileSync(new URL('./' + SRC, import.meta.url)));
const DATA = JSON.stringify(snap);
const VENUE = snap.target.venue || 'Venue A';
const TICK = snap.target.ticker || 'EQXx';
const DEMO = !!snap.target.demo;

const html = `<style>
  :root{
    --paper:#eef1f5;--surface:#fff;--surface-2:#f6f8fb;--ink:#131a26;--muted:#59647a;--faint:#8a94a6;
    --line:#dde3ec;--line-strong:#c7cfdb;--accent:#3663c8;--accent-soft:#eaf0fc;
    --green:#157f52;--green-soft:#e4f2ea;--amber:#9a6712;--amber-soft:#f6eddb;--red:#b93f2c;--red-soft:#f7e6e1;
    --shadow:0 1px 2px rgba(19,26,38,.05),0 10px 34px -14px rgba(19,26,38,.16);
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
    --paper:#0b0f17;--surface:#121824;--surface-2:#0f141e;--ink:#e8ecf3;--muted:#97a3b8;--faint:#6b7688;
    --line:#232e3e;--line-strong:#334054;--accent:#6f9bff;--accent-soft:#16233c;
    --green:#3fc389;--green-soft:#10281e;--amber:#e2a740;--amber-soft:#2a2010;--red:#f0715b;--red-soft:#2c1512;
  }}
  :root[data-theme="light"]{--paper:#eef1f5;--surface:#fff;--surface-2:#f6f8fb;--ink:#131a26;--muted:#59647a;--faint:#8a94a6;--line:#dde3ec;--line-strong:#c7cfdb;--accent:#3663c8;--accent-soft:#eaf0fc;--green:#157f52;--green-soft:#e4f2ea;--amber:#9a6712;--amber-soft:#f6eddb;--red:#b93f2c;--red-soft:#f7e6e1;}
  :root[data-theme="dark"]{--paper:#0b0f17;--surface:#121824;--surface-2:#0f141e;--ink:#e8ecf3;--muted:#97a3b8;--faint:#6b7688;--line:#232e3e;--line-strong:#334054;--accent:#6f9bff;--accent-soft:#16233c;--green:#3fc389;--green-soft:#10281e;--amber:#e2a740;--amber-soft:#2a2010;--red:#f0715b;--red-soft:#2c1512;}
  *{box-sizing:border-box;}
  .rp{background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;padding:clamp(16px,4vw,44px) clamp(14px,4vw,32px) 70px;}
  .wrap{max-width:820px;margin:0 auto;}
  .tnum{font-variant-numeric:tabular-nums;} .mono{font-family:var(--mono);}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin:0 0 8px;}
  header{margin-bottom:22px;}
  h1{font-size:clamp(23px,4vw,32px);margin:0 0 8px;letter-spacing:-.01em;line-height:1.13;}
  h1 .b{color:var(--red);}
  .sub{color:var(--muted);margin:0;max-width:62ch;font-size:15px;}
  .pill{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12.5px;padding:6px 12px;border-radius:20px;border:1px solid var(--line);background:var(--surface);margin-top:14px;color:var(--amber);}
  .pill .dot{width:9px;height:9px;border-radius:50%;background:var(--amber);}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:clamp(18px,3vw,24px);margin-top:16px;}
  .card h2{font-size:13px;font-family:var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin:0 0 16px;font-weight:600;}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:14px;}
  .stat .k{font-size:12px;color:var(--muted);margin-bottom:4px;}
  .stat .v{font-family:var(--mono);font-size:19px;font-weight:650;letter-spacing:-.01em;}
  .stat .v.red{color:var(--red);}
  .flabel{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:var(--muted);margin-bottom:9px;font-weight:550;}
  .flabel .val{font-family:var(--mono);font-size:16px;color:var(--ink);font-weight:700;}
  input[type=range]{width:100%;accent-color:var(--red);height:22px;cursor:pointer;}
  .three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px;}
  .box{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--surface-2);}
  .box .bk{font-size:11.5px;color:var(--muted);margin-bottom:6px;}
  .box .bv{font-family:var(--mono);font-size:20px;font-weight:700;letter-spacing:-.01em;}
  .box.debt .bv{color:var(--red);} .box.extract .bv{color:var(--accent);} .box.liq .bv{color:var(--amber);}
  .box .bs{font-size:11px;color:var(--faint);margin-top:3px;}
  svg{display:block;width:100%;height:auto;overflow:visible;}
  .axl{font-family:var(--mono);font-size:10px;fill:var(--faint);}
  .money{margin-top:16px;padding:16px 18px;border-radius:12px;background:var(--red-soft);border:1px solid color-mix(in srgb,var(--red) 30%,transparent);font-size:15px;line-height:1.55;}
  .money b{color:var(--red);font-family:var(--mono);}
  .trade{font-family:var(--mono);font-size:13px;line-height:1.7;color:var(--muted);margin-top:6px;}
  .trade b{color:var(--ink);}
  .foot{margin-top:20px;font-size:12.5px;color:var(--faint);line-height:1.6;}
  .foot code{font-family:var(--mono);background:var(--surface-2);padding:1px 5px;border-radius:4px;}
  a{color:var(--accent);}
</style>
<div class="rp"><div class="wrap">
  <header>
    <p class="eyebrow">Ruptor · offensive re-execution</p>
    <h1>What a Monday gap <span class="b">extracts</span> from a live lending book.</h1>
    <p class="sub">${DEMO
      ? 'Synthetic borrowers modeling a live Solana lending venue that lists tokenized equities'
      : 'Real ' + VENUE + ' ' + TICK + ' borrowers, read from Solana mainnet'} and re-executed now.
      Drag the Monday-open gap and watch the book break: how much bad debt the protocol eats, and what a
      searcher takes. Risk advisors stop at <em>"this is risky."</em> Ruptor prints the trade.</p>
    <span class="pill"><span class="dot"></span><span id="cap"></span></span>
  </header>

  <div class="card">
    <h2>Live book — re-executed from chain state</h2>
    <div class="stats" id="stats"></div>
  </div>

  <div class="card">
    <h2>Stress the book — Monday-open gap</h2>
    <div class="flabel"><span>Gap down on the underlying at reopen</span><span class="val" id="gv">0%</span></div>
    <input type="range" id="gap" min="0" max="40" value="0" step="0.5">
    <div class="three">
      <div class="box liq"><div class="bk">Liquidatable</div><div class="bv" id="nliq">—</div><div class="bs" id="nliqs"></div></div>
      <div class="box debt"><div class="bk">Bad debt (protocol eats)</div><div class="bv" id="bd">—</div><div class="bs">${DEMO ? 'protocol loss' : VENUE + ' loss'}</div></div>
      <div class="box extract"><div class="bk">Searcher extracts</div><div class="bv" id="ex">—</div><div class="bs">liquidation-bonus P&amp;L</div></div>
    </div>
    <div class="money" id="money"></div>
  </div>

  <div class="card">
    <h2>Bad-debt curve — the cheapest break</h2>
    <svg id="chart" viewBox="0 0 720 260" role="img" aria-label="Bad debt and searcher extract vs gap"></svg>
    <div class="trade" id="trade"></div>
  </div>

  <p class="foot" id="foot"></p>
</div></div>
<script>
const S = ${DATA};
const VENUE = ${JSON.stringify(VENUE)}, DEMO = ${DEMO};
const P = S.params, LT = P.lt, BONUS = P.bonus, CF = P.cf;
const book = S.book;
const fmtUsd = x => '$' + Math.round(x).toLocaleString('en-US');
const pct = x => (x*100).toFixed(1) + '%';

function stress(g){
  let nLiq=0, debtAtRisk=0, badDebt=0, extract=0, firstBreaker=null;
  for(const p of book){
    const postColl = p.coll*(1-g);
    if(p.debt/postColl < LT) continue;
    nLiq++; debtAtRisk += p.debt;
    const rMax = postColl/(1+BONUS);
    extract += Math.min(CF*p.debt, rMax)*BONUS;
    const bd = Math.max(0, p.debt - rMax);
    if(bd>0){ badDebt += bd; if(!firstBreaker) firstBreaker = p; }
  }
  return {g,nLiq,debtAtRisk,badDebt,extract,firstBreaker};
}

// stats
const totColl = book.reduce((a,p)=>a+p.coll,0), totDebt = book.reduce((a,p)=>a+p.debt,0);
const worst = book.slice().sort((a,b)=>b.ltv-a.ltv)[0];
document.getElementById('cap').textContent = DEMO ? 'synthetic · method demo (no real venue)' : 'live · captured ' + S.capturedAt.slice(0,16).replace('T',' ') + ' UTC';
document.getElementById('stats').innerHTML = [
  ['Borrowers', book.length],
  ['Fair price', '$'+S.price.toFixed(2)],
  ['Collateral', fmtUsd(totColl)],
  ['Debt', fmtUsd(totDebt)],
  ['Worst LTV', pct(worst.ltv)],
].map(([k,v],i)=>'<div class="stat"><div class="k">'+k+'</div><div class="v'+(i===4&&worst.ltv>=LT?' red':'')+'">'+v+'</div></div>').join('');

// critical gap g*
let gStar=null;
for(let g=0; g<=0.5+1e-9; g+=0.0025){ if(stress(g).badDebt>0){ gStar=g; break; } }

// chart: bad debt (red area) + searcher extract (blue line) vs gap 0..40%
const W=720,H=260,ml=64,mr=56,mt=16,mb=34, pw=W-ml-mr, ph=H-mt-mb;
const GS=[]; for(let g=0; g<=0.401; g+=0.01) GS.push(g);
const rows = GS.map(g=>({g,...stress(g)}));
const maxBD = Math.max(1, ...rows.map(r=>r.badDebt));
const maxEX = Math.max(1, ...rows.map(r=>r.extract));
const X = g => ml + (g/0.40)*pw;
const Ybd = v => mt+ph - (v/maxBD)*ph;
const Yex = v => mt+ph - (v/maxEX)*ph;
function draw(gSel){
  const area = 'M'+X(0)+','+(mt+ph)+' ' + rows.map(r=>'L'+X(r.g).toFixed(1)+','+Ybd(r.badDebt).toFixed(1)).join(' ') + ' L'+X(0.40)+','+(mt+ph)+' Z';
  const line = rows.map((r,i)=>(i?'L':'M')+X(r.g).toFixed(1)+','+Yex(r.extract).toFixed(1)).join(' ');
  const xt = [0,0.1,0.2,0.3,0.4].map(g=>'<text class="axl" x="'+X(g)+'" y="'+(H-12)+'" text-anchor="middle">'+(g*100)+'%</text>').join('');
  const gsx = gStar!=null ? '<line x1="'+X(gStar)+'" x2="'+X(gStar)+'" y1="'+mt+'" y2="'+(mt+ph)+'" stroke="var(--red)" stroke-dasharray="3 3" opacity=".7"/><text class="axl" x="'+X(gStar)+'" y="'+(mt-3)+'" text-anchor="middle" fill="var(--red)">g*='+pct(gStar)+'</text>' : '';
  const cur = '<line x1="'+X(gSel)+'" x2="'+X(gSel)+'" y1="'+mt+'" y2="'+(mt+ph)+'" stroke="var(--ink)" stroke-width="2"/>';
  document.getElementById('chart').innerHTML =
    '<path d="'+area+'" fill="var(--red)" opacity=".18"/>' +
    '<path d="'+area+'" fill="none" stroke="var(--red)" stroke-width="1.5"/>' +
    '<path d="'+line+'" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
    gsx + cur + xt +
    '<text class="axl" x="'+ml+'" y="'+(mt+8)+'" text-anchor="end">'+fmtUsd(maxBD)+'</text>' +
    '<text class="axl" x="'+(W-mr+6)+'" y="'+(mt+8)+'" text-anchor="start" fill="var(--accent)">'+fmtUsd(maxEX)+'</text>' +
    '<text class="axl" x="'+ml+'" y="'+(H-12)+'" text-anchor="end" fill="var(--red)">bad debt</text>' +
    '<text class="axl" x="'+(W-mr+6)+'" y="'+(H-12)+'" text-anchor="start" fill="var(--accent)">extract</text>';
}

function render(){
  const g = +document.getElementById('gap').value/100;
  const r = stress(g);
  document.getElementById('gv').textContent = pct(g);
  document.getElementById('nliq').textContent = r.nLiq + '/' + book.length;
  document.getElementById('nliqs').textContent = fmtUsd(r.debtAtRisk) + ' at risk';
  document.getElementById('bd').textContent = fmtUsd(r.badDebt);
  document.getElementById('ex').textContent = fmtUsd(r.extract);
  const b20 = stress(0.20);
  document.getElementById('money').innerHTML = gStar==null
    ? 'No gap \\u2264 50% forces bad debt on this book \\u2014 over-collateralized right now.'
    : 'Cheapest break: a <b>'+pct(gStar)+'</b> Monday gap is enough to push this book into its first bad debt. '
      + 'At a <b>20%</b> gap, '+VENUE+' eats <b>'+fmtUsd(b20.badDebt)+'</b> bad debt across <b>'+b20.nLiq+'</b> positions while a searcher extracts <b>'+fmtUsd(b20.extract)+'</b>.';
  const fb = (r.firstBreaker)||(gStar!=null?stress(gStar).firstBreaker:null);
  if(fb){
    const postColl = fb.coll*(1-(gStar??g));
    document.getElementById('trade').innerHTML =
      'the trade \\u00b7 first breaker <b>'+fb.pk.slice(0,8)+'\\u2026</b><br>'
      + 'now: collateral <b>'+fmtUsd(fb.coll)+'</b> \\u00b7 debt <b>'+fmtUsd(fb.debt)+'</b> \\u00b7 LTV <b>'+pct(fb.ltv)+'</b><br>'
      + 'at g*='+pct(gStar??g)+': collateral <b>'+fmtUsd(postColl)+'</b> &lt; debt \\u2192 underwater; searcher seizes all, protocol eats <b>'+fmtUsd(Math.max(0,fb.debt-postColl/(1+BONUS)))+'</b>.';
  } else document.getElementById('trade').textContent='';
  draw(g);
}
document.getElementById('gap').addEventListener('input', render);
document.getElementById('foot').innerHTML =
  'Positions, price, LTV, collateral and debt are real chain state (LTV = 1.0015^tick / price). '
  + 'Liquidation params are labeled assumptions: bonus <code>'+pct(BONUS)+'</code>, close factor <code>'+pct(CF)+'</code>. '
  + 'The waterfall is a first-order model, not a full replay. This cascade only exists on a venue that liquidates against the '
  + 'gapped/stale closed-market price (Vesper RED); a clamp+suspend venue (GREEN, e.g. Kamino) removes it. '
  + 'Prop / credibility artifact \\u2014 not financial advice, not a product.';
render();
</script>`;

writeFileSync(new URL('./' + OUT, import.meta.url), html);
console.log('wrote ' + OUT + ' (' + html.length + ' bytes) from ' + SRC + ' @ ' + snap.capturedAt);

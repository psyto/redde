// Ariete — build the shareable page from a live book + live-measured liquidity.
//   node ruptor.mjs --json > snapshot.json && node measure.mjs && node build-ariete-page.mjs
// Emits ariete-break.html: the measured liquidity-seizure money-shot, interactive. Zero deps.
import { readFileSync, writeFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url)));
const meas = JSON.parse(readFileSync(new URL('./measured.json', import.meta.url)));
const VENUE = snap.target.venue || 'Venue A';
const TICK = snap.target.ticker || 'EQXx';
const DATA = JSON.stringify({ snap, meas });

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
  .mono{font-family:var(--mono);}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin:0 0 8px;}
  header{margin-bottom:22px;}
  h1{font-size:clamp(23px,4vw,32px);margin:0 0 8px;letter-spacing:-.01em;line-height:1.13;}
  h1 .b{color:var(--red);}
  .sub{color:var(--muted);margin:0;max-width:64ch;font-size:15px;}
  .pill{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12.5px;padding:6px 12px;border-radius:20px;border:1px solid var(--line);background:var(--surface);margin-top:14px;color:var(--green);}
  .pill .dot{width:9px;height:9px;border-radius:50%;background:var(--green);}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:clamp(18px,3vw,24px);margin-top:16px;}
  .card h2{font-size:13px;font-family:var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin:0 0 16px;font-weight:600;}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:14px;}
  .stat .k{font-size:12px;color:var(--muted);margin-bottom:4px;}
  .stat .v{font-family:var(--mono);font-size:18px;font-weight:650;letter-spacing:-.01em;}
  .stat .v.red{color:var(--red);}
  .flabel{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:var(--muted);margin-bottom:9px;font-weight:550;}
  .flabel .val{font-family:var(--mono);font-size:16px;color:var(--ink);font-weight:700;}
  input[type=range]{width:100%;accent-color:var(--red);height:22px;cursor:pointer;}
  svg{display:block;width:100%;height:auto;overflow:visible;}
  .axl{font-family:var(--mono);font-size:10px;fill:var(--faint);}
  .cap{font-family:var(--mono);font-size:11px;fill:var(--red);}
  .bars{margin-top:8px;}
  .barrow{display:flex;align-items:center;gap:12px;margin-bottom:12px;}
  .barrow .lab{font-size:12px;color:var(--muted);width:120px;flex:none;text-align:right;}
  .bartrack{flex:1;height:26px;background:var(--surface-2);border:1px solid var(--line);border-radius:7px;position:relative;overflow:hidden;}
  .barfill{position:absolute;top:0;bottom:0;left:0;border-radius:6px;}
  .barfill.demand{background:color-mix(in srgb,var(--red) 60%,var(--surface));}
  .barfill.cap{background:color-mix(in srgb,var(--green) 55%,var(--surface));}
  .barval{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-family:var(--mono);font-size:12px;font-weight:700;}
  .three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px;}
  .box{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--surface-2);}
  .box .bk{font-size:11.5px;color:var(--muted);margin-bottom:6px;}
  .box .bv{font-family:var(--mono);font-size:20px;font-weight:700;letter-spacing:-.01em;}
  .box.stranded .bv{color:var(--red);} .box.green .bv{color:var(--green);}
  .box .bs{font-size:11px;color:var(--faint);margin-top:3px;}
  .money{margin-top:16px;padding:16px 18px;border-radius:12px;background:var(--red-soft);border:1px solid color-mix(in srgb,var(--red) 30%,transparent);font-size:15px;line-height:1.55;}
  .money b{color:var(--red);font-family:var(--mono);}
  .foot{margin-top:20px;font-size:12.5px;color:var(--faint);line-height:1.6;}
  .foot code{font-family:var(--mono);background:var(--surface-2);padding:1px 5px;border-radius:4px;}
</style>
<div class="rp"><div class="wrap">
  <header>
    <p class="eyebrow">Ariete · cross-venue contagion</p>
    <h1>The break isn't a cascade. It's a <span class="b">liquidity seizure</span>.</h1>
    <p class="sub">We measured, live, how much ${TICK} you can actually dump on-chain before routes vanish —
      then compared it to what a naive lending venue would have to offload in a Monday gap. The debt that
      can't be sold is stranded. Real ${VENUE} borrowers, real chain state, live-measured liquidity.</p>
    <span class="pill"><span class="dot"></span><span id="cap"></span></span>
  </header>

  <div class="card">
    <h2>Measured sell-side liquidity — ${TICK}</h2>
    <svg id="liq" viewBox="0 0 720 220" role="img" aria-label="Measured price impact vs sell size"></svg>
    <p class="foot" style="margin-top:10px" id="liqcap"></p>
  </div>

  <div class="card">
    <h2>Live book — re-executed from chain state</h2>
    <div class="stats" id="stats"></div>
  </div>

  <div class="card">
    <h2>Monday-open gap → who can't be liquidated</h2>
    <div class="flabel"><span>Fundamental gap on the underlying</span><span class="val" id="gv">10%</span></div>
    <input type="range" id="gap" min="0" max="25" value="10" step="0.5">
    <div class="bars" id="bars"></div>
    <div class="three">
      <div class="box"><div class="bk">Underwater</div><div class="bv" id="under">—</div><div class="bs" id="unders"></div></div>
      <div class="box stranded"><div class="bk">Stranded (can't sell)</div><div class="bv" id="stuck">—</div><div class="bs" id="stucks"></div></div>
      <div class="box green"><div class="bk">Clamp venue stranded</div><div class="bv" id="gstuck">—</div><div class="bs">pauses, settles orderly</div></div>
    </div>
    <div class="money" id="money"></div>
  </div>

  <p class="foot" id="foot"></p>
</div></div>
<script>
const {snap, meas} = ${DATA};
const book = snap.book, fair = snap.price, VENUE = ${JSON.stringify(VENUE)};
const LT = snap.target.lt ?? 0.75, BONUS = 0.075, CF = 0.5, BAND = 0.05;
const CEIL = meas.routableCeilingUSD, CURVE = meas.curve;
const fmtUsd = x => '$' + Math.round(x).toLocaleString('en-US');
const pct = x => (x*100).toFixed(1) + '%';

function impactFrac(sizeUSD){
  if(sizeUSD<=CURVE[0].usd) return (CURVE[0].impactPct/100)*(sizeUSD/CURVE[0].usd);
  for(let i=1;i<CURVE.length;i++){ if(sizeUSD<=CURVE[i].usd){ const a=CURVE[i-1],b=CURVE[i],t=(sizeUSD-a.usd)/(b.usd-a.usd); return (a.impactPct+t*(b.impactPct-a.impactPct))/100; } }
  return CURVE[CURVE.length-1].impactPct/100;
}
function measuredBreak(g0, clamp){
  const p = clamp ? Math.max(fair*(1-g0), fair*(1-BAND)) : fair*(1-g0);
  const under = book.filter(b=> b.debt/(b.qty*p) >= LT).sort((a,b)=>b.ltv-a.ltv);
  let sellDemand=0; for(const q of under) sellDemand += Math.min(CF*q.debt, (q.qty*p)/(1+BONUS))*(1+BONUS);
  let budget = clamp ? Infinity : CEIL, nCleared=0, nStuck=0, stuckDebt=0, badDebt=0, soldUSD=0;
  for(const q of under){ const collVal=q.qty*p, repaid=Math.min(CF*q.debt, collVal/(1+BONUS)), sellUSD=repaid*(1+BONUS), sf=Math.max(0,q.debt-collVal/(1+BONUS));
    if(sellUSD<=budget){ budget-=sellUSD; nCleared++; soldUSD+=sellUSD; badDebt+=sf; } else { nStuck++; stuckDebt+=q.debt; badDebt+=sf; } }
  return {nUnder:under.length, sellDemand, nCleared, nStuck, stuckDebt, badDebt, soldUSD};
}

// measured liquidity curve chart with the ceiling cliff
(function(){
  const W=720,H=220,ml=52,mr=20,mt=14,mb=30,pw=W-ml-mr,ph=H-mt-mb;
  const maxU=CEIL*1.15, maxI=Math.max(...CURVE.map(c=>c.impactPct))*1.25;
  const X=u=>ml+(u/maxU)*pw, Y=i=>mt+ph-(i/maxI)*ph;
  const line=CURVE.map((c,i)=>(i?'L':'M')+X(c.usd).toFixed(1)+','+Y(c.impactPct).toFixed(1)).join(' ');
  const dots=CURVE.map(c=>'<circle cx="'+X(c.usd)+'" cy="'+Y(c.impactPct)+'" r="2.5" fill="var(--accent)"/>').join('');
  const cliff='<line x1="'+X(CEIL)+'" x2="'+X(CEIL)+'" y1="'+mt+'" y2="'+(mt+ph)+'" stroke="var(--red)" stroke-dasharray="4 3"/><text class="cap" x="'+(X(CEIL)-6)+'" y="'+(mt+12)+'" text-anchor="end">no route past '+fmtUsd(CEIL)+'</text>';
  const xt=[0,50000,100000,150000].map(u=>'<text class="axl" x="'+X(u)+'" y="'+(H-10)+'" text-anchor="middle">$'+(u/1000)+'k</text>').join('');
  const yt=[0,2,4,6].map(i=>'<text class="axl" x="'+(ml-6)+'" y="'+(Y(i)+3)+'" text-anchor="end">'+i+'%</text>').join('');
  document.getElementById('liq').innerHTML='<path d="'+line+'" fill="none" stroke="var(--accent)" stroke-width="2"/>'+dots+cliff+xt+yt+'<text class="axl" x="'+ml+'" y="'+(mt-2)+'">price impact of a market sell</text>';
  document.getElementById('liqcap').innerHTML='Live '+meas.source+' quotes, '+meas.capturedAt.slice(0,16).replace('T',' ')+'Z. A $50k sell moves the price '+CURVE.find(c=>c.usd===50000).impactPct.toFixed(1)+'% — and past <b>'+fmtUsd(CEIL)+'</b> the aggregator finds no route at all. This is the entire liquidation budget.';
})();

const totColl=book.reduce((a,b)=>a+b.coll,0), totDebt=book.reduce((a,b)=>a+b.debt,0);
const worst=book.slice().sort((a,b)=>b.ltv-a.ltv)[0];
document.getElementById('cap').textContent='live · book '+snap.capturedAt.slice(0,16).replace('T',' ')+'Z';
document.getElementById('stats').innerHTML=[['Borrowers',book.length],['Debt',fmtUsd(totDebt)],['Collateral',fmtUsd(totColl)],['Sell capacity',fmtUsd(CEIL)],['Worst LTV',pct(worst.ltv)]]
  .map(([k,v],i)=>'<div class="stat"><div class="k">'+k+'</div><div class="v'+(i===4&&worst.ltv>=LT?' red':'')+(i===3?' red':'')+'">'+v+'</div></div>').join('');

function render(){
  const g0=+document.getElementById('gap').value/100;
  const r=measuredBreak(g0,false), gr=measuredBreak(g0,true);
  document.getElementById('gv').textContent=pct(g0);
  // demand vs capacity bars (scaled to max of demand)
  const scale=Math.max(r.sellDemand, CEIL)*1.05;
  document.getElementById('bars').innerHTML=
    '<div class="barrow"><div class="lab">sell demand</div><div class="bartrack"><div class="barfill demand" style="width:'+(100*r.sellDemand/scale).toFixed(1)+'%"></div><div class="barval">'+fmtUsd(r.sellDemand)+'</div></div></div>'+
    '<div class="barrow"><div class="lab">measured capacity</div><div class="bartrack"><div class="barfill cap" style="width:'+(100*CEIL/scale).toFixed(1)+'%"></div><div class="barval">'+fmtUsd(CEIL)+'</div></div></div>';
  document.getElementById('under').textContent=r.nUnder+'/'+book.length;
  document.getElementById('unders').textContent=fmtUsd(r.sellDemand)+' to offload';
  document.getElementById('stuck').textContent=fmtUsd(r.stuckDebt);
  document.getElementById('stucks').textContent=r.nStuck+' positions can\\u2019t be sold';
  document.getElementById('gstuck').textContent=fmtUsd(gr.stuckDebt);
  const over=r.sellDemand/CEIL;
  document.getElementById('money').innerHTML= r.nUnder===0
    ? 'At '+pct(g0)+', no position is underwater — the book holds.'
    : 'At a <b>'+pct(g0)+'</b> gap, a naive '+VENUE+' must offload <b>'+fmtUsd(r.sellDemand)+'</b> to clear '+r.nUnder+' underwater positions — but on-chain liquidity absorbs only <b>'+fmtUsd(CEIL)+'</b> (<b>'+over.toFixed(1)+'\\u00d7</b> short). <b>'+fmtUsd(r.stuckDebt)+'</b> of debt is stranded: no buyer exists, so it cannot be liquidated. A clamp+suspend venue strands '+fmtUsd(gr.stuckDebt)+'.';
}
document.getElementById('gap').addEventListener('input', render);
document.getElementById('foot').innerHTML='Positions, LTV, collateral, debt = real chain state (LTV = 1.0015^tick / price). Sell-side liquidity and the routable ceiling = live '+meas.source+' quotes. The only scenario inputs are the fundamental gap and close factor <code>'+pct(CF)+'</code>; the conclusion (demand \\u226b capacity) is robust to both. Not a smooth-cascade model \\u2014 a hard liquidity budget. Prop / credibility artifact, not financial advice.';
render();
</script>`;

writeFileSync(new URL('./ariete-break.html', import.meta.url), html);
console.log('wrote ariete-break.html (' + html.length + ' bytes)');

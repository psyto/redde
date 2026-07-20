/**
 * Redde — Slice 3 checker: Marinade (mSOL). Second invariant class.
 *
 *   redde rationem. Solvency, whether they like it or not.
 *
 * Zero deps (Node 18+). Reads only. Reconstructs Marinade's mSOL redemption
 * liability and its independent on-chain backing, per Codex round-6 spec.
 *
 *   SOLANA_RPC_URL=... node verify-marinade.mjs [--json]
 *
 * Backing inventory comes from the stake_list (the protocol's own registry), NOT
 * an authority scan — a third party can point a stake account's withdrawer at the
 * PDA, which an authority scan would wrongly count. msol_price is display-only and
 * is never used for the liability. liq_sol (LP leg) is excluded.
 */
import { createHash } from "node:crypto";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const MARINADE = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const STATE = process.env.MARINADE_STATE || "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";

// State byte offsets (Anchor discriminator included), from Codex round-6.
const S = {
  msolMint: 8, reserveBump: 136, mintAuthBump: 137, rentExempt: 138,
  stakeListAcct: 150, stakeListItemSize: 182, stakeListCount: 186,
  delayedCooling: 226, depositBump: 234, withdrawBump: 235,
  totalActive: 376, availableReserve: 496, msolSupply: 504,
  ticketCount: 520, ticketBalance: 528, emergencyCooling: 568,
};
// stake_list record from offset 8; stake_pubkey@0, last_update_delegated@32,
// last_update_epoch@40, is_emergency@48, status@49. Record STRIDE is the
// on-chain item_size (State@182 = 56), NOT the packed field span.
const REC = { base: 8, epoch: 40, status: 49 };
// StakeStateV2 (native): tag u32@0; Meta rent@4 staker@12 withdrawer@44; delegation.voter@124.
const STK = { rent: 4, staker: 12, withdrawer: 44 };
const MINT_SUPPLY = 36;

// ---- base58 ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58e(buf){const b=[...buf];let z=0;while(z<b.length&&b[z]===0)z++;const e=[];let s=z;while(s<b.length){let r=0;for(let i=s;i<b.length;i++){const a=(r<<8)+b[i];b[i]=(a/58)|0;r=a%58;}e.push(B58[r]);if(b[s]===0)s++;}return "1".repeat(z)+e.reverse().join("");}
function b58d(str){const b=[];for(const c of str){let carry=B58.indexOf(c);if(carry<0)throw new Error("b58");for(let j=0;j<b.length;j++){carry+=b[j]*58;b[j]=carry&255;carry>>=8;}while(carry){b.push(carry&255);carry>>=8;}}let z=0;for(const c of str){if(c==="1")z++;else break;}const o=Buffer.from([...new Array(z).fill(0),...b.reverse()]);if(o.length!==32)throw new Error("pk!=32");return o;}
// ---- ed25519 on-curve (findProgramAddress) ----
const P=(1n<<255n)-19n,D=37095705934669439343138083508754565189542113879843219016388785533085940283555n,II=19681161376707505956807079304988542015446066515923890162744021073123829784752n;
const fm=(a)=>((a%P)+P)%P;function fp(b,e){let r=1n;b=fm(b);while(e>0n){if(e&1n)r=fm(r*b);b=fm(b*b);e>>=1n;}return r;}const fi=(a)=>fp(a,P-2n);
function onCurve(buf){let y=0n;for(let i=31;i>=0;i--)y=(y<<8n)|BigInt(buf[i]);y&=(1n<<255n)-1n;const y2=fm(y*y),n=fm(y2-1n),d=fm(fm(D*y2)+1n),x2=fm(n*fi(d));if(x2===0n)return true;let x=fp(x2,(P+3n)/8n);if(fm(x*x-x2)!==0n)x=fm(x*II);return fm(x*x-x2)===0n;}
const progB = b58d(MARINADE);
function cpa(seeds){const h=createHash("sha256");for(const s of seeds)h.update(s);h.update(progB);h.update(Buffer.from("ProgramDerivedAddress"));return b58e(h.digest());}
function anchorDisc(name){return createHash("sha256").update(`account:${name}`).digest().subarray(0,8);}

async function rpc(m,p){const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});const j=await r.json();if(j.error)throw new Error(`${m}: ${JSON.stringify(j.error)}`);return j.result;}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function rpcWait(m,p,t=8){for(let i=0;;i++){try{return await rpc(m,p);}catch(e){if(i<t-1&&/-32016|Minimum context slot/.test(e.message)){await sleep(400);continue;}throw e;}}}
const dec=(v)=>v?{owner:v.owner,lamports:BigInt(v.lamports),data:Buffer.from(v.data[0],"base64")}:null;
async function getMulti(keys,minSlot){const cfg={encoding:"base64",commitment:"finalized"};if(minSlot!=null)cfg.minContextSlot=minSlot;const r=await rpcWait("getMultipleAccounts",[keys,cfg]);return{slot:r.context.slot,values:r.value.map(dec)};}
const u64=(b,o)=>b.readBigUInt64LE(o);
const u32=(b,o)=>b.readUInt32LE(o);
const pk=(b,o)=>b58e(b.subarray(o,o+32));
const sol=(l)=>(Number(BigInt(l))/1e9).toLocaleString("en-US",{maximumFractionDigits:3});

function stale(why){return{verdict:"STALE",notes:[`STALE: ${why}. An unverifiable claim is a published property.`]};}

async function check() {
  const notes=[];
  // (1) authenticate state
  const s0=(await getMulti([STATE])).values[0];
  if(!s0) return stale("state not found");
  if(s0.owner!==MARINADE) return stale("state not owned by Marinade program");
  const d=s0.data;
  if(d.length<576) return stale("state too small");

  const msolMint=pk(d,S.msolMint);
  const reserveBump=d[S.reserveBump], mintAuthBump=d[S.mintAuthBump], depositBump=d[S.depositBump], withdrawBump=d[S.withdrawBump];
  const rentExempt=u64(d,S.rentExempt);
  const stakeListAcct=pk(d,S.stakeListAcct);
  const stakeCount=u32(d,S.stakeListCount);
  const msolSupply=u64(d,S.msolSupply);
  const totalActive=u64(d,S.totalActive), availableReserve=u64(d,S.availableReserve);
  const delayedCooling=u64(d,S.delayedCooling), emergencyCooling=u64(d,S.emergencyCooling);
  const ticketBalance=u64(d,S.ticketBalance);

  const reservePda=cpa([b58d(STATE),Buffer.from("reserve"),Buffer.from([reserveBump])]);
  const depositAuth=cpa([b58d(STATE),Buffer.from("deposit"),Buffer.from([depositBump])]);
  const withdrawAuth=cpa([b58d(STATE),Buffer.from("withdraw"),Buffer.from([withdrawBump])]);
  const mintAuth=cpa([b58d(STATE),Buffer.from("st_mint"),Buffer.from([mintAuthBump])]);

  const currentEpoch=(await rpc("getEpochInfo",[{commitment:"finalized"}]).catch(()=>null))?.epoch;
  if(currentEpoch==null) return stale("current epoch unreadable");

  // (2) consistent snapshot of state + mint + reserve + stake_list. Every field
  // used for the verdict must come from the same slot: require the re-read State
  // bytes to equal the bytes we derived everything from.
  const snap=await getMulti([STATE,msolMint,reservePda,stakeListAcct]);
  const [st2,mint,reserve,list]=snap.values;
  if(!st2||!mint||!reserve||!list) return stale("referenced account unreadable");
  if(!st2.data.equals(d)) return stale("state changed between reads — inconsistent snapshot");
  if(mint.owner!==TOKEN_PROGRAM||mint.data.length<82) return stale("msol mint wrong owner/size");
  if(u32(mint.data,0)!==1||pk(mint.data,4)!==mintAuth) return stale("msol mint authority is not the Marinade PDA");
  if(reserve.owner!==SYSTEM_PROGRAM) return stale("reserve is not a System-owned account");
  if(list.owner!==MARINADE) return stale("stake_list not owned by Marinade");
  if(!list.data.subarray(0,8).equals(anchorDisc_staker)) return stale("stake_list wrong discriminator");
  const itemSize=u32(d,S.stakeListItemSize);
  if(itemSize<50) return stale(`stake_list item_size ${itemSize} < 50`);
  const capacity=Math.floor((list.data.length-REC.base)/itemSize);
  if(stakeCount>capacity) return stale(`stake_list count ${stakeCount} > capacity ${capacity}`);

  // M-INV-1 — no excess minting
  const mintSupply=u64(mint.data,MINT_SUPPLY);
  const supplyDelta=msolSupply-mintSupply;
  const inv1=mintSupply<=msolSupply;
  if(!inv1) notes.push(`M-INV-1: mint.supply ${mintSupply} > state.msol_supply ${msolSupply} (excess minting)`);
  else if(supplyDelta>0n) notes.push(`SUPPLY-DRIFT: state exceeds mint by ${supplyDelta} (direct burns); conservative for holders`);

  // liability = mint * virtualValue / msol_supply  (msol_price NOT used)
  const virtualValue=availableReserve+totalActive+delayedCooling+emergencyCooling-ticketBalance;
  const liability=msolSupply===0n?0n:(mintSupply*virtualValue)/msolSupply;

  // M-OBS-2a — self-report virtual value (observation only, near-tautological
  // after M-INV-1; NOT a verdict driver). Reported for transparency.
  if(virtualValue<0n) notes.push(`M-OBS-2a: negative virtual value (${virtualValue})`);

  // (3) freshness from stake_list records + collect stake pubkeys.
  // Every record must be updated exactly this epoch; any lag (or lead) → STALE.
  const cnt=stakeCount;
  const stakeKeys=[], seen=new Set(); let staleRecords=0;
  for(let i=0;i<cnt;i++){
    const b=REC.base+i*itemSize;
    const key=pk(list.data,b);
    if(seen.has(key)) return stale("duplicate stake record in stake_list");
    seen.add(key); stakeKeys.push(key);
    if(u64(list.data,b+REC.epoch)!==BigInt(currentEpoch)) staleRecords++;
  }
  if(staleRecords>0) notes.push(`freshness: ${staleRecords}/${cnt} stake records not at current epoch`);

  // M-INV-2b — independent backing from listed stake accounts (+ reserve − tickets)
  let inv2b=null, backing=null, usable=0, unusable=0, tickets=null, ticketCount=null;
  try {
    // listed stake accounts, batched
    let stakeSum=0n;
    for(let i=0;i<stakeKeys.length;i+=100){
      const batch=stakeKeys.slice(i,i+100);
      const accs=(await getMulti(batch,snap.slot)).values;
      for(const a of accs){
        if(a&&a.owner===STAKE_PROGRAM&&a.data.length>=48&&u32(a.data,0)===2
           &&pk(a.data,STK.staker)===depositAuth&&pk(a.data,STK.withdrawer)===withdrawAuth){
          stakeSum+=a.lamports-u64(a.data,STK.rent); usable++;
        } else unusable++;
      }
    }
    // open tickets under this state, deducted. Must reconcile exactly with the
    // header — an incomplete scan would under-deduct and hide a deficit.
    const disc=b58e(anchorDisc("TicketAccountData"));
    const gpa=await rpcWait("getProgramAccounts",[MARINADE,{
      encoding:"base64",commitment:"finalized",minContextSlot:snap.slot,
      filters:[{memcmp:{offset:0,bytes:disc}},{memcmp:{offset:8,bytes:STATE}}],
    }]);
    tickets=0n; ticketCount=gpa.length;
    for(const t of gpa){ tickets+=u64(Buffer.from(t.account.data[0],"base64"),72); } // lamports_amount@72
    const headerTicketCount=u64(d,S.ticketCount);
    if(tickets!==ticketBalance||BigInt(ticketCount)!==headerTicketCount){
      return stale(`ticket reconciliation failed: scanned ${ticketCount}/${tickets} vs header ${headerTicketCount}/${ticketBalance}`);
    }
    const reserveNet=reserve.lamports-rentExempt;
    backing=reserveNet+stakeSum-tickets;

    // (4) mutation guard — full re-read; every byte used for the verdict must be
    // unchanged across the whole read window.
    const re=await getMulti([STATE,msolMint,reservePda,stakeListAcct],snap.slot);
    const [s3,m3,r3,l3]=re.values;
    if(!s3||!m3||!r3||!l3||!s3.data.equals(d)||!m3.data.equals(mint.data)
       ||r3.lamports!==reserve.lamports||r3.owner!==reserve.owner||!l3.data.equals(list.data)){
      return stale("state/mint/reserve/stake_list mutated during read window");
    }
    inv2b=backing>=liability;
    if(!inv2b) notes.push(`M-INV-2b: net backing ${backing} < liability ${liability}`);
    if(unusable>0) notes.push(`M-INV-2b: ${unusable} listed stake account(s) not usable — counted 0`);
  } catch(e){ notes.push(`M-INV-2b unavailable (${e.message})`); }

  let verdict;
  if(!inv1||inv2b===false) verdict="RED";
  else if(inv2b===true&&staleRecords===0) verdict="GREEN";
  else verdict="STALE"; // fresh backing not fully proven, or records stale

  return {
    verdict, target:STATE, currentEpoch, snapshotSlot:snap.slot, stakeRecords:cnt, staleRecords,
    mintSupply:mintSupply.toString(), msolSupply:msolSupply.toString(), supplyDelta:supplyDelta.toString(),
    virtualValue:virtualValue.toString(), liability:liability.toString(),
    inv2b: backing==null?{available:false}:{available:true,ok:inv2b,backing:backing.toString(),
      usableStakes:usable,unusableStakes:unusable,tickets:tickets.toString(),ticketCount},
    notes,
  };
}
const anchorDisc_staker=Buffer.from("staker__","utf8"); // Marinade List discriminator

const json=process.argv.includes("--json");
const rep=await check().catch(e=>stale(e instanceof Error?e.message:String(e)));
if(json){ console.log(JSON.stringify(rep,null,2)); }
else{
  const seal={GREEN:"[ GREEN ]",RED:"[  RED  ]",STALE:"[ STALE ]"}[rep.verdict];
  console.log(`\n  redde — marinade (mSOL)`);
  console.log(`  verdict: ${seal}${rep.currentEpoch!=null?`   (epoch ${rep.currentEpoch}, ${rep.stakeRecords} stake records, ${rep.staleRecords} stale)`:""}\n`);
  if(rep.liability){
    console.log(`  M-INV-1  no excess minting     ${BigInt(rep.mintSupply)<=BigInt(rep.msolSupply)?"hold ✓":"FAIL ✗"}   mint=${sol(rep.mintSupply)}  state=${sol(rep.msolSupply)} mSOL`);
    console.log(`  liability (redeemable)         ${sol(rep.liability)} SOL   (virtual value ${sol(rep.virtualValue)})`);
    if(rep.inv2b.available)
      console.log(`  M-INV-2b independent backing   ${rep.inv2b.ok?"hold ✓":"FAIL ✗"}   net=${sol(rep.inv2b.backing)} SOL   (${rep.inv2b.usableStakes} stakes, ${rep.inv2b.ticketCount} tickets −${sol(rep.inv2b.tickets)})`);
    else console.log(`  M-INV-2b independent backing   n/a — getProgramAccounts unavailable`);
  }
  for(const n of rep.notes) console.log(`\n  ${n}`);
  console.log("");
}
process.exit(rep.verdict==="RED"?1:0);

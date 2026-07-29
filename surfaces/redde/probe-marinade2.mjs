// Slice 3 scouting #2: find Marinade's stake-withdraw authority so INV-2b's
// getProgramAccounts-by-authority backing scan can be reused. Tries the known
// candidate seeds and reports which one owns the ~2.33M SOL of stake accounts.
import { createHash } from "node:crypto";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const MARINADE_PROGRAM = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
const STATE = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
const OFF = { reserveBal: 496, msolSupply: 504, msolPrice: 512 };
const PRICE_DENOM = 0x1_0000_0000n;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58e(buf){const b=[...buf];let z=0;while(z<b.length&&b[z]===0)z++;const e=[];let s=z;while(s<b.length){let r=0;for(let i=s;i<b.length;i++){const a=(r<<8)+b[i];b[i]=(a/58)|0;r=a%58;}e.push(B58[r]);if(b[s]===0)s++;}return "1".repeat(z)+e.reverse().join("");}
function b58d(str){const b=[];for(const c of str){let carry=B58.indexOf(c);if(carry<0)throw new Error("b58");for(let j=0;j<b.length;j++){carry+=b[j]*58;b[j]=carry&255;carry>>=8;}while(carry){b.push(carry&255);carry>>=8;}}let z=0;for(const c of str){if(c==="1")z++;else break;}return Buffer.from([...new Array(z).fill(0),...b.reverse()]);}
const P=(1n<<255n)-19n, D=37095705934669439343138083508754565189542113879843219016388785533085940283555n, I=19681161376707505956807079304988542015446066515923890162744021073123829784752n;
const fm=(a)=>((a%P)+P)%P; function fp(b,e){let r=1n;b=fm(b);while(e>0n){if(e&1n)r=fm(r*b);b=fm(b*b);e>>=1n;}return r;} const fi=(a)=>fp(a,P-2n);
function onCurve(buf){let y=0n;for(let i=31;i>=0;i--)y=(y<<8n)|BigInt(buf[i]);y&=(1n<<255n)-1n;const y2=fm(y*y),num=fm(y2-1n),den=fm(fm(D*y2)+1n),x2=fm(num*fi(den));if(x2===0n)return true;let x=fp(x2,(P+3n)/8n);if(fm(x*x-x2)!==0n)x=fm(x*I);return fm(x*x-x2)===0n;}
function findPda(seeds,prog){const pid=b58d(prog);for(let b=255;b>=0;b--){const h=createHash("sha256");for(const s of seeds)h.update(s);h.update(Buffer.from([b]));h.update(pid);h.update(Buffer.from("ProgramDerivedAddress"));const d=h.digest();if(!onCurve(d))return b58e(d);}return null;}
async function rpc(m,p){const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});const j=await r.json();if(j.error)throw new Error(JSON.stringify(j.error));return j.result;}
const sol=(l)=>(Number(l)/1e9).toLocaleString("en-US",{maximumFractionDigits:3});
const u64=(b,o)=>b.readBigUInt64LE(o);

const st = (await rpc("getAccountInfo",[STATE,{encoding:"base64"}])).value;
const sd = Buffer.from(st.data[0],"base64");
const msolSupply = u64(sd, OFF.msolSupply), msolPrice = u64(sd, OFF.msolPrice), reserveBal = u64(sd, OFF.reserveBal);
const liability = msolSupply * msolPrice / PRICE_DENOM;
console.log("msol_supply       :", msolSupply, `(${sol(msolSupply)} mSOL)`);
console.log("msol_price        :", msolPrice, `(${(Number(msolPrice)/Number(PRICE_DENOM)).toFixed(6)} SOL/mSOL)`);
console.log("=> liability (virtual staked):", liability, `(${sol(liability)} SOL)`);
console.log("available_reserve :", reserveBal, `(${sol(reserveBal)} SOL)\n`);

const stateB = b58d(STATE);
const candidates = ["stake_withdraw", "stake_deposit", "reserve", "liq_pool_msol", "msol_mint"];
for (const seed of candidates) {
  const auth = findPda([stateB, Buffer.from(seed)], MARINADE_PROGRAM);
  try {
    const gpa = await rpc("getProgramAccounts", [STAKE_PROGRAM, {
      encoding: "base64", commitment: "finalized", dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset: 44, bytes: auth } }],
    }]);
    const sum = gpa.reduce((s, a) => s + BigInt(a.account.lamports), 0n);
    console.log(`seed "${seed}" -> ${auth}`);
    console.log(`   stake accounts: ${gpa.length}   sum: ${sol(sum)} SOL${gpa.length ? "   <<< BACKING AUTHORITY" : ""}`);
  } catch (e) { console.log(`seed "${seed}" -> ${auth}  (gpa error ${e.message})`); }
}

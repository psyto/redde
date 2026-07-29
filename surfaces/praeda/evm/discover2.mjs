// Pin the window W by binary-searching each drained asset's transition block.
const RPC = process.env.ETH_RPC_URL;
const hex = (n) => "0x" + BigInt(n).toString(16);
async function rpc(method, params) {
  for (let a = 0; ; a += 1) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const t = await r.text(); if (!t) throw new Error(`empty ${r.status}`);
      const j = JSON.parse(t); if (j.error) throw new Error(JSON.stringify(j.error));
      return j.result;
    } catch (e) { if (a >= 5) throw e; await new Promise((s) => setTimeout(s, 400 * (a + 1))); }
  }
}
const BAL = "0x70a08231";
async function bal(token, holder, block) {
  const data = BAL + holder.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const res = await rpc("eth_call", [{ to: token, data }, hex(block)]);
  return BigInt(res === "0x" ? "0x0" : res);
}
const tsCache = new Map();
async function ts(block) {
  if (tsCache.has(block)) return tsCache.get(block);
  const b = await rpc("eth_getBlockByNumber", [hex(block), false]);
  const v = b ? new Date(Number(b.timestamp) * 1000).toISOString() : null;
  tsCache.set(block, v); return v;
}
const EULER = "0x27182842E098f60e3D576794A5bFFb0777E025d3";
const TOKENS = {
  DAI:  ["0x6B175474E89094C44Da98b954EedeAC495271d0F", 18],
  WETH: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18],
  USDC: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6],
  wstETH:["0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", 18],
};
// Find the largest block in [lo,hi] whose balance is still >= half of `pre` (last-solvent for that asset).
async function lastSolvent(token, pre, lo, hi) {
  const thresh = pre / 2n;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const b = await bal(token, EULER, mid);
    if (b >= thresh) lo = mid; else hi = mid - 1;
  }
  return lo;
}
const LO = 16817000, HI = 16820000;
let firstDrain = Infinity, lastDrain = -Infinity;
for (const [sym, [tok, dec]] of Object.entries(TOKENS)) {
  const pre = await bal(tok, EULER, LO);
  const ls = await lastSolvent(tok, pre, LO, HI); // last block still >=50%
  const drainBlock = ls + 1;
  firstDrain = Math.min(firstDrain, drainBlock);
  lastDrain = Math.max(lastDrain, drainBlock);
  const bAfter = await bal(tok, EULER, drainBlock);
  const f = (x) => (Number(x) / 10 ** dec).toLocaleString();
  console.log(`${sym.padEnd(6)} last>=50% @${ls} (${await ts(ls)}) -> @${drainBlock} bal=${f(bAfter)}`);
}
console.log("\nfirstDrain block:", firstDrain, await ts(firstDrain));
console.log("lastDrain  block:", lastDrain, await ts(lastDrain));
console.log("suggested W: fromBlock =", firstDrain - 1, " toBlock =", lastDrain + 2);

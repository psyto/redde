// One-off boundary/window discovery for the Euler case — resolve on-chain, never guess.
const RPC = process.env.ETH_RPC_URL;
const hex = (n) => "0x" + BigInt(n).toString(16);
async function rpc(method, params) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const txt = await r.text();
      if (!txt) throw new Error(`empty body (http ${r.status})`);
      const j = JSON.parse(txt);
      if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
      return j.result;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
}
const BAL = "0x70a08231";
async function balanceOf(token, holder, block) {
  const data = BAL + holder.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const res = await rpc("eth_call", [{ to: token, data }, hex(block)]);
  return BigInt(res === "0x" ? "0x0" : res);
}
async function ts(block) {
  const b = await rpc("eth_getBlockByNumber", [hex(block), false]);
  return b ? new Date(Number(b.timestamp) * 1000).toISOString() : null;
}
const EULER = "0x27182842E098f60e3D576794A5bFFb0777E025d3"; // Euler main module (candidate boundary)
const TOKENS = {
  DAI:  ["0x6B175474E89094C44Da98b954EedeAC495271d0F", 18],
  WETH: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18],
  USDC: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6],
  wstETH:["0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", 18],
};
const latest = Number(await rpc("eth_blockNumber", []));
console.log("archival ok. latest block:", latest);
const PRE = 16817000, POST = 16820000; // around 2023-03-13 exploit
console.log("PRE ", PRE, await ts(PRE));
console.log("POST", POST, await ts(POST));
for (const [sym, [tok, dec]] of Object.entries(TOKENS)) {
  const pre = await balanceOf(tok, EULER, PRE);
  const post = await balanceOf(tok, EULER, POST);
  const f = (x) => (Number(x) / 10 ** dec).toLocaleString();
  console.log(`${sym.padEnd(6)} pre=${f(pre).padStart(18)}  post=${f(post).padStart(16)}  drained=${pre>post?"YES":"no"}`);
}

// Pin an INDEPENDENT reference: Chainlink feeds + Lido wstETH rate at t0 block.
// Chainlink was not the Euler collapse mechanism (a donateToReserves/self-liquidation
// exploit) — so it is an admissible reference under SPEC Measure 1.
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
    } catch (e) { if (a >= 8) throw e; await new Promise((s) => setTimeout(s, 800 * (a + 1))); }
  }
}
const call = (to, data, block) => rpc("eth_call", [{ to, data }, hex(block)]);
const toInt = (h) => BigInt.asIntN(256, BigInt(h)); // int256
const BLK = 16817995;
const LATEST_ANSWER = "0x50d25bcd"; // latestAnswer() int256, 8 decimals for USD feeds
const STETH_PER_TOKEN = "0x035faf82"; // wstETH.stEthPerToken() uint256 (1e18)
const feeds = {
  "ETH/USD":  "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "USDC/USD": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
  "DAI/USD":  "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9",
  "STETH/USD":"0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8",
};
const px = {};
for (const [name, addr] of Object.entries(feeds)) {
  const raw = toInt(await call(addr, LATEST_ANSWER, BLK));
  px[name] = Number(raw) / 1e8;
  console.log(`${name.padEnd(10)} = $${px[name].toFixed(4)}   (Chainlink ${addr})`);
}
const wsteth = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const rate = Number(BigInt(await call(wsteth, STETH_PER_TOKEN, BLK))) / 1e18;
console.log(`\nwstETH stEthPerToken = ${rate.toFixed(6)} stETH/wstETH  (Lido, block ${BLK})`);
console.log(`wstETH/USD (derived) = $${(rate * px["STETH/USD"]).toFixed(4)}  = stEthPerToken x STETH/USD`);
console.log("\n--- pinned reference (USD per token) ---");
console.log(JSON.stringify({
  DAI: +px["DAI/USD"].toFixed(6),
  WETH: +px["ETH/USD"].toFixed(6),
  USDC: +px["USDC/USD"].toFixed(6),
  wstETH: +(rate * px["STETH/USD"]).toFixed(6),
}, null, 2));

/**
 * poolscan — shared core for the peg-pool exit-balance invariant.
 * Used by scan.mjs (one-shot) and monitor.mjs (standing monitor).
 *
 * The invariant: a peg pool sits balanced; a rising share of one leg = the hard exit
 * asset draining. A REAL red needs BOTH a drained pool AND the dominant coin trading
 * at a discount (get_dy) — balance imbalance at peg is a benign/deprecated pool.
 * Each pool is self-verified on-chain (coins/balances/decimals resolved, no hardcoded
 * coin addresses). Reads only; reproducible by anyone with an archival RPC.
 */
const RPC = process.env.ETH_RPC_URL;
export async function rpc(m, p) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const t = await r.text(); if (!t) throw new Error("empty");
      return JSON.parse(t);
    } catch (e) { if (a >= 12) throw e; await new Promise((s) => setTimeout(s, 600 * (a + 1))); }
  }
}
const call = async (to, data) => { const j = await rpc("eth_call", [{ to, data }, "latest"]);
  return j.result && j.result !== "0x" ? j.result : null; };
const u = (i) => i.toString(16).padStart(64, "0");
const COINS = "0xc6610657", BALANCES = "0x4903b0d1", DECIMALS = "0x313ce567", GET_DY = "0x5e0d443f";
const ETHPH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const addrOf = (h) => "0x" + h.slice(-40).toLowerCase();

const LABEL = {
  [ETHPH]: "ETH", "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": "stETH",
  "0x5e8422345238f34275888049021821e8e08caa1f": "frxETH", "0xae78736cd615f374d3085123a210448e74fc6393": "rETH",
  "0xbe9895146f7af43049ca1c1ae358b0541ea49704": "cbETH", "0xe95a203b1a91a908f9b9ce46459d101078c2c3cb": "ankrETH",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT", "0x853d955acef822db058eb8505911ed77f175b99e": "FRAX",
  "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e": "crvUSD", "0x4c9edd5852cd905f086c759e8383e09bff1e68b3": "USDe",
};
export const label = (a) => LABEL[a] || (a.slice(0, 6) + "…" + a.slice(-4));

export const WATCH = [
  ["stETH/ETH (old)", "0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"],
  ["stETH/ETH ng", "0x21E27a5E5513D6e65C4f830167390997aA84843a"],
  ["frxETH/ETH", "0xa1F8A6807c402E4A15ef4EBa36528A3FED24E577"],
  ["rETH/ETH ng", "0x0f3159811670c117c372428D4E69AC32325e4D0F"],
  ["cbETH/ETH", "0x5FAE7E604FC3e24fd43A72867ceBaC94c65b404A"],
  ["ankrETH/ETH", "0xA96A65c051bF88B4095Ee1f2451C2A9d43F53Ae2"],
  ["3pool (DAI/USDC/USDT)", "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"],
  ["FRAXBP (FRAX/USDC)", "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2"],
  ["crvUSD/USDT", "0x390f3595bCa2Df7d23783dFd126427CCeb997BF4"],
  ["crvUSD/USDC", "0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E"],
  ["USDe/USDC", "0x02950460E2b9529D0E00284A5fA2d7bDF3fA4d72"],
];

export const DISC = 0.01; // >1% discount on the dominant coin = the peg is materially off
export function flag(r) {
  const off = r.discount != null && r.discount > DISC;
  if (r.maxShare >= 0.75 && off) return "RED";
  if (r.maxShare >= 0.65 && off) return "AMBER";
  if (r.maxShare >= 0.65) return "benign"; // imbalanced but at peg (deprecated/migrated)
  return "green";
}

export async function scanPool(label0, pool) {
  const coins = [], bals = [], decs = [];
  for (let i = 0; i < 4; i++) {
    const c = await call(pool, COINS + u(i)); if (!c) break;
    const coin = addrOf(c);
    const b = await call(pool, BALANCES + u(i)); if (!b) break;
    let dec = 18;
    if (coin !== ETHPH) { const d = await call(coin, DECIMALS); if (d) dec = Number(BigInt(d)); }
    coins.push(coin); bals.push(BigInt(b)); decs.push(dec);
  }
  if (coins.length < 2) return { label: label0, pool, ok: false, why: "not a standard 2+ coin Curve pool" };
  const units = bals.map((b, i) => Number(b) / 10 ** decs[i]);
  const total = units.reduce((s, x) => s + x, 0);
  if (total <= 0) return { label: label0, pool, ok: false, why: "empty pool" };
  const shares = units.map((x) => x / total);
  const maxShare = Math.max(...shares), minShare = Math.min(...shares);
  const domIdx = shares.indexOf(maxShare), scarceIdx = shares.indexOf(minShare);
  const legs = coins.map((c, i) => ({ token: label(c), share: +(shares[i]).toFixed(4) }));
  let price = null, discount = null;
  if (maxShare >= 0.60 && domIdx !== scarceIdx) {
    const one = (10n ** BigInt(decs[domIdx])).toString(16).padStart(64, "0");
    const dy = await call(pool, GET_DY + u(domIdx) + u(scarceIdx) + one);
    if (dy) { price = Number(BigInt(dy)) / 10 ** decs[scarceIdx]; discount = +(1 - price).toFixed(4); }
  }
  const r = { label: label0, pool, ok: true, n: coins.length, totalUnits: Math.round(total),
    maxShare: +maxShare.toFixed(4), domToken: label(coins[domIdx]),
    price: price != null ? +price.toFixed(4) : null, discount,
    legs: legs.sort((a, b) => b.share - a.share) };
  r.flag = flag(r);
  return r;
}

export async function scanAll(onProgress) {
  const rows = [];
  for (const [l, p] of WATCH) {
    try { rows.push(await scanPool(l, p)); } catch (e) { rows.push({ label: l, pool: p, ok: false, why: e.message }); }
    if (onProgress) onProgress(rows.length, WATCH.length, rows.at(-1));
  }
  return rows;
}

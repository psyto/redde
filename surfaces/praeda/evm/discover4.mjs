// Resolve each ledger endpoint on-chain: contract vs EOA, and code presence.
// No hand-labeling — Praeda resolves, it does not guess.
import { readFileSync } from "node:fs";
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
    } catch (e) { if (a >= 10) throw e; await new Promise((s) => setTimeout(s, 700 * (a + 1))); }
  }
}
const led = JSON.parse(readFileSync(new URL("./data/euler-ledger.json", import.meta.url)));
const BLK = led.window.toBlock;
console.log(`endpoints in ledger: ${led.ledger.length}  (code checked @ block ${BLK})\n`);
for (const r of led.ledger) {
  const code = await rpc("eth_getCode", [r.account, hex(BLK)]);
  const kind = code && code !== "0x" ? `CONTRACT(${(code.length - 2) / 2}b)` : "EOA";
  const nat = Object.entries(r.native || {}).map(([s, n]) => `${(+n.toPrecision(5)).toLocaleString()} ${s}`).join(", ");
  console.log(`${(r.cls ?? "?").padEnd(14)} ${r.account}  ${kind.padEnd(16)} E=$${Math.round(r.E).toLocaleString().padStart(13)}  ${nat}`);
}

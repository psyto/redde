// keccak.mjs — the single audited keccak256 for the whole verifier (Solana + EVM legs).
// Pure JS, BigInt, zero-dep. Self-tested on import: if the primitive is wrong, every
// selector and every Merkle-proof check downstream is wrong, so we refuse to load.

const RC = [0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,
0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,
0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,
0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,
0x80000001n,0x8000000080008008n];
const ROT = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const MASK = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0n ? x : (((x << n) | (x >> (64n - n))) & MASK);

function keccakF(s) {
  for (let r = 0; r < 24; r++) {
    const C = [0n,0n,0n,0n,0n];
    for (let x = 0; x < 5; x++) C[x] = s[x]^s[x+5]^s[x+10]^s[x+15]^s[x+20];
    const D = [0n,0n,0n,0n,0n];
    for (let x = 0; x < 5; x++) D[x] = C[(x+4)%5] ^ rotl(C[(x+1)%5], 1n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x+5*y] ^= D[x];
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y+5*((2*x+3*y)%5)] = rotl(s[x+5*y], BigInt(ROT[x+5*y]));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x+5*y] = B[x+5*y] ^ ((~B[(x+1)%5+5*y]) & B[(x+2)%5+5*y] & MASK);
    s[0] ^= RC[r];
  }
}

// keccak256 over an array of byte values (0..255); returns a 32-element byte array.
export function keccak256(bytes) {
  const rate = 136, s = new Array(25).fill(0n), pad = [...bytes];
  pad.push(0x01); while (pad.length % rate !== 0) pad.push(0x00); pad[pad.length-1] |= 0x80;
  for (let off = 0; off < pad.length; off += rate) {
    for (let i = 0; i < rate; i++) { const l = (i/8)|0; s[l] = (s[l] ^ (BigInt(pad[off+i]) << BigInt(8*(i%8)))) & MASK; }
    keccakF(s);
  }
  const out = [];
  for (let i = 0; i < 32; i++) { const l = (i/8)|0; out.push(Number((s[l] >> BigInt(8*(i%8))) & 0xffn)); }
  return out;
}

export const hexToBytes = (h) => {
  h = h.replace(/^0x/, ""); if (h.length % 2) h = "0" + h;
  const b = []; for (let i = 0; i < h.length; i += 2) b.push(parseInt(h.slice(i, i+2), 16)); return b;
};
export const bytesToHex = (b) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const utf8 = (s) => [...Buffer.from(s, "utf8")];
export const selector = (sig) => bytesToHex(keccak256(utf8(sig)).slice(0, 4));
export const storageKey = (...parts) => bytesToHex(keccak256(parts.flatMap((p) => typeof p === "string" ? utf8(p) : p)));

// self-test: known vectors. Throws on load if the implementation drifts.
(function selftest() {
  if (bytesToHex(keccak256([])) !== "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470") throw new Error("keccak256 self-test failed (empty)");
  if (selector("totalSupply()") !== "0x18160ddd") throw new Error("keccak256 self-test failed (totalSupply selector)");
  if (selector("balanceOf(address)") !== "0x70a08231") throw new Error("keccak256 self-test failed (balanceOf selector)");
})();

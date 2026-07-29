// Base58 + account-buffer helpers shared by the Solana surfaces.
// Extracted verbatim from vesper/kamino-reserve.mjs (the most complete copy);
// redde/probe.mjs, ruptor/ruptor.mjs and praeda/find-sol-pool.mjs each carried
// their own copy of these.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s || '1';
}

export function b58decode(str) {
  let n = 0n;
  for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad b58'); n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of str) { if (c === '1') bytes.unshift(0); else break; }
  return Buffer.from(bytes);
}

/** Read a 32-byte pubkey out of an account buffer at a byte offset. */
export const pk = (buf, off) => b58encode(buf.subarray(off, off + 32));

/** Fetch + base64-decode an account's data. Returns { lamports, owner, data:Buffer } or null. */
export async function getAccount(rpc, pubkey) {
  const res = await rpc('getAccountInfo', [pubkey, { encoding: 'base64' }]);
  if (!res || !res.value) return null;
  return {
    lamports: BigInt(res.value.lamports),
    owner: res.value.owner,
    data: Buffer.from(res.value.data[0], 'base64'),
  };
}

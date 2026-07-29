// Canonical JSON-RPC client for the re-execution surfaces.
//
// Every surface (redde/vesper/ruptor/praeda) used to carry its own near-identical
// `async function rpc(method, params, tries)`. This is the single implementation:
// robust Solana + EVM JSON-RPC with timeout, HTML-rate-limit detection, and backoff.
//
//   import { solanaRpc, evmRpc } from '../../core/rpc.mjs'
//   const rpc = solanaRpc(process.env.RPC)
//   const acc = await rpc('getAccountInfo', [pk, { encoding: 'base64' }])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a JSON-RPC caller for a given endpoint.
 * @param {string} url          RPC endpoint
 * @param {object} [opts]
 * @param {number} [opts.tries=5]     max attempts
 * @param {number} [opts.timeoutMs=15000]  per-attempt abort cap
 * @param {number} [opts.backoffMs=400]    linear backoff base (× attempt)
 */
export function makeRpc(url, opts = {}) {
  const { tries = 5, timeoutMs = 15000, backoffMs = 400 } = opts;
  if (!url) throw new Error('makeRpc: no endpoint (set RPC env or pass url)');
  return async function rpc(method, params) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: ac.signal,
        });
        const text = await r.text();
        if (text.trimStart().startsWith('<')) throw new Error('HTML (rate-limited)');
        const j = JSON.parse(text);
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        return j.result;
      } catch (e) {
        lastErr = e;
        await sleep(backoffMs * (i + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`${method}: ${lastErr && lastErr.message}`);
  };
}

/** Solana mainnet caller (defaults to public endpoint). */
export const solanaRpc = (url = process.env.RPC || 'https://api.mainnet-beta.solana.com', opts) =>
  makeRpc(url, opts);

/** EVM caller (defaults to a public Ethereum endpoint). */
export const evmRpc = (url = process.env.ETH_RPC || 'https://eth.llamarpc.com', opts) =>
  makeRpc(url, opts);

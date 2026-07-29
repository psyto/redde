// Canonical JSON-RPC client for the re-execution surfaces.
//
// Every surface (redde/vesper/ruptor/praeda) used to carry its own near-identical
// `async function rpc(method, params, tries)`. This is the single implementation:
// robust Solana + EVM JSON-RPC with timeout, HTML-rate-limit detection, and backoff.
//
//   import { solanaRpc } from '../../core/rpc.mjs'
//   const rpc = solanaRpc(process.env.RPC);
//   const acc = await rpc('getAccountInfo', [pk, { encoding: 'base64' }]);
//
// Retry policy is configurable so a call site can reproduce the exact behavior its
// inline copy had (e.g. redde's -32016 minimum-context-slot wait):
//
//   const rpc     = solanaRpc(RPC, { tries: 1 });                       // single-shot
//   const rpcWait = solanaRpc(RPC, { tries: 8, retryOn: /-32016|Minimum context slot/ });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One-shot JSON-RPC POST to `url`. Throws on HTML rate-limit page, empty body,
 * transport error, or a JSON-RPC `error`. Used directly by per-call-url call
 * sites, and as the primitive under {@link makeRpc}.
 * @param {string} url
 * @param {string} method
 * @param {any[]} params
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000]
 * @param {number} [opts.id=1]
 */
export async function jsonRpc(url, method, params, opts = {}) {
  const { timeoutMs = 15000, id = 1 } = opts;
  if (!url) throw new Error('jsonRpc: no endpoint (set RPC env or pass url)');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: ac.signal,
    });
    const text = await r.text();
    if (!text) throw new Error(`${method}: empty response`);
    if (text.trimStart().startsWith('<')) throw new Error(`${method}: HTML (rate-limited)`);
    const j = JSON.parse(text);
    if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
    return j.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a JSON-RPC caller bound to `url`.
 * @param {string} url          RPC endpoint
 * @param {object} [opts]
 * @param {number} [opts.tries=5]           max attempts
 * @param {number} [opts.timeoutMs=15000]   per-attempt abort cap
 * @param {number} [opts.backoffMs=400]     linear backoff base (× attempt)
 * @param {RegExp|((e:Error)=>boolean)} [opts.retryOn]
 *        If set, only retry when it matches the error (message regex or predicate);
 *        a non-matching error throws immediately. If unset, every error is retried
 *        up to `tries`.
 */
export function makeRpc(url, opts = {}) {
  const { tries = 5, timeoutMs = 15000, backoffMs = 400, retryOn = null } = opts;
  if (!url) throw new Error('makeRpc: no endpoint (set RPC env or pass url)');
  const shouldRetry = (e) =>
    retryOn == null ? true : retryOn instanceof RegExp ? retryOn.test(e.message) : !!retryOn(e);
  return async function rpc(method, params) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await jsonRpc(url, method, params, { timeoutMs });
      } catch (e) {
        lastErr = e;
        if (i === tries - 1 || !shouldRetry(e)) throw e;
        await sleep(backoffMs * (i + 1));
      }
    }
    throw lastErr;
  };
}

/** Solana mainnet caller (defaults to public endpoint). */
export const solanaRpc = (url = process.env.RPC || 'https://api.mainnet-beta.solana.com', opts) =>
  makeRpc(url, opts);

/** EVM caller (defaults to a public Ethereum endpoint). */
export const evmRpc = (url = process.env.ETH_RPC || 'https://eth.llamarpc.com', opts) =>
  makeRpc(url, opts);

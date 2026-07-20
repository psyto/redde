/**
 * Redde — verify / authorize a signed solvency attestation.
 *
 * Signature validity and AUTHORIZATION are separate outcomes:
 *
 *   VALID            — well-formed, hash matches, signature verifies.
 *   AUTHORIZED       — VALID *and* a pinned signer's unexpired GREEN for the
 *                      exact class + target the relying party demanded.
 *
 * A validly-signed RED/STALE, a GREEN for a different target/class, an unpinned
 * check, or an expired attestation are VALID but **NOT AUTHORIZING** — they exit
 * non-zero so a money path cannot mistake them for success.
 *
 *   # authorize a real action (all three required):
 *   ... | node verify-attestation.mjs --pin <signer> --expect-class marinade \
 *          --expect-target <pubkey> [--at-slot <n> | uses finalized RPC slot]
 *   # inspect only (never authorization):
 *   ... | node verify-attestation.mjs
 *
 * Do not gate money on VALID alone. The chain is the truth: re-run the checker
 * for binding.target and confirm its verdict equals binding.verdict.
 */
import { createHash, verify as edVerify, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

const DOMAIN = "redde-solvency-v1";
const SIG_CONTEXT = "redde-attestation-v1\x00"; // must match attest.mjs
const CLASSES = new Set(["spl-stake-pool", "marinade"]);
const VERDICTS = new Set(["GREEN", "RED", "STALE"]);
const MAX_TTL_SLOTS = 216_000;
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58d(str) {
  const b = []; for (const c of str) { let carry = B58.indexOf(c); if (carry < 0) throw new Error("bad base58"); for (let j = 0; j < b.length; j++) { carry += b[j] * 58; b[j] = carry & 255; carry >>= 8; } while (carry) { b.push(carry & 255); carry >>= 8; } }
  let z = 0; for (const c of str) { if (c === "1") z++; else break; }
  return Buffer.from([...new Array(z).fill(0), ...b.reverse()]);
}
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
const ED_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const pubFromRaw = (raw32) => createPublicKey({ key: Buffer.concat([ED_SPKI_PREFIX, raw32]), format: "der", type: "spki" });

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const die = (label, msg, code) => { console.log(`${label} — ${msg}`); process.exit(code); };

const isInt = (x) => Number.isSafeInteger(x);
function schemaErrors(b) {
  const e = [];
  if (typeof b !== "object" || !b) return ["binding is not an object"];
  if (typeof b.domain !== "string") e.push("domain not a string");
  if (!CLASSES.has(b.class)) e.push(`class '${b.class}' not recognized`);
  if (typeof b.target !== "string" || !b.target) e.push("target missing");
  if (!VERDICTS.has(b.verdict)) e.push(`verdict '${b.verdict}' invalid`);
  if (b.epoch != null && !isInt(b.epoch)) e.push("epoch not an integer");
  for (const k of ["issued_at_slot", "expiry_slot"]) if (b[k] != null && !isInt(b[k])) e.push(`${k} not an integer`);
  if (isInt(b.issued_at_slot) && isInt(b.expiry_slot)) {
    if (b.expiry_slot < b.issued_at_slot) e.push("expiry_slot < issued_at_slot");
    if (b.expiry_slot - b.issued_at_slot > MAX_TTL_SLOTS) e.push("TTL exceeds cap");
  }
  if (typeof b.signer !== "string") e.push("signer missing");
  return e;
}

async function finalizedSlot() {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "finalized" }] }) });
  const j = await r.json();
  if (j.error || !isInt(j.result)) throw new Error("getSlot failed");
  return j.result;
}

// ---- establish VALIDITY (well-formed + hash + signature) ----
let att;
try { att = JSON.parse(readFileSync(0, "utf8")); } catch { die("INVALID", "not JSON", 1); }
const { binding, claim_hash, signature } = att || {};
if (!binding || typeof claim_hash !== "string" || typeof signature !== "string") die("INVALID", "missing binding/claim_hash/signature", 1);
const errs = schemaErrors(binding);
if (errs.length) die("INVALID", `schema: ${errs.join("; ")}`, 1);
if (sha256hex(canonical(binding)) !== claim_hash) die("INVALID", "claim_hash does not match binding (tampered)", 1);
let pub; try { pub = pubFromRaw(b58d(binding.signer)); } catch { die("INVALID", "signer is not a valid ed25519 key", 1); }
const message = Buffer.concat([Buffer.from(SIG_CONTEXT), Buffer.from(claim_hash, "hex")]);
let sigOk = false; try { sigOk = edVerify(null, message, pub, Buffer.from(signature, "base64")); } catch { sigOk = false; }
if (!sigOk) die("INVALID", "ed25519 signature does not verify", 1);

// ---- AUTHORIZATION (all three inputs required) ----
const pin = flag("--pin"), expectClass = flag("--expect-class"), expectTarget = flag("--expect-target");
if (!pin || !expectClass || !expectTarget) {
  const missing = [!pin && "--pin", !expectClass && "--expect-class", !expectTarget && "--expect-target"].filter(Boolean).join(", ");
  console.log(`VALID BUT NON-AUTHORIZING — inspection only (missing ${missing})`);
  console.log(`  ${binding.class} ${binding.target}  verdict=${binding.verdict}  signer=${binding.signer}`);
  process.exit(2);
}

const reasons = [];
if (binding.domain !== DOMAIN) reasons.push(`domain '${binding.domain}' != ${DOMAIN}`);
if (binding.signer !== pin) reasons.push(`signer ${binding.signer} != pinned ${pin}`);
if (binding.verdict !== "GREEN") reasons.push(`verdict is ${binding.verdict}, not GREEN`);
if (binding.class !== expectClass) reasons.push(`class ${binding.class} != expected ${expectClass}`);
if (binding.target !== expectTarget) reasons.push(`target != expected ${expectTarget}`);

// expiry — fail closed: a slot MUST be established.
let slot = null;
const atRaw = flag("--at-slot");
if (atRaw !== undefined) {
  if (!/^\d+$/.test(atRaw) || !isInt(Number(atRaw))) die("NOT AUTHORIZED", `--at-slot '${atRaw}' is not a non-negative integer`, 1);
  slot = Number(atRaw);
} else {
  try { slot = await finalizedSlot(); } catch { reasons.push("cannot determine current slot for expiry (set --at-slot or SOLANA_RPC_URL)"); }
}
if (binding.expiry_slot == null) reasons.push("attestation has no expiry_slot");
else if (slot != null && slot > binding.expiry_slot) reasons.push(`expired: slot ${slot} > expiry ${binding.expiry_slot}`);

if (reasons.length) {
  console.log(`NOT AUTHORIZED —`);
  for (const r of reasons) console.log(`  - ${r}`);
  process.exit(1);
}
console.log(`AUTHORIZED — pinned-signer GREEN for ${binding.class} ${binding.target}`);
console.log(`  epoch ${binding.epoch}  issued_at_slot ${binding.issued_at_slot}  valid through ${binding.expiry_slot}  (checked at slot ${slot})`);
console.log(`  liability ${binding.liability}  backing ${binding.backing}`);
console.log(`  still: re-run the checker for this target to reproduce the verdict — the chain is the truth.`);
process.exit(0);

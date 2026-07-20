/**
 * Redde — signed solvency attestation.
 *
 *   redde rationem. Solvency, whether they like it or not — and now signed.
 *
 * Turns a Redde verdict into an ed25519-signed, content-addressed attestation
 * bound to the exact target/epoch/slot/verdict. Same trust model as Liquet's
 * attest.rs: a relying party pins the signer, recomputes the hash, verifies the
 * signature — and can re-run the checker to reproduce the verdict itself. This
 * is the seam-ready shape: it drops into Liquet as a `SolvencyAttestation` slot
 * the moment a real solvency-gated flow needs it (demand-not-feasibility).
 *
 * Zero deps beyond node:crypto (native ed25519). Signing key lives in
 * redde-signer.key (gitignored); generated on first run, its public key printed.
 *
 *   node verify.mjs --json          | node attest.mjs --class spl
 *   node verify-marinade.mjs --json | node attest.mjs --class marinade
 *   node attest.mjs --pubkey        # print the pinned signer, do nothing else
 */
import { createHash, generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, chmodSync } from "node:fs";

const DOMAIN = "redde-solvency-v1";
// Signature context — the exact bytes signed are contextPrefix || claim_hash, so
// this key's signatures can never be reused as another protocol's message.
export const SIG_CONTEXT = "redde-attestation-v1\x00";
const KEY_PATH = new URL("./redde-signer.key", import.meta.url);
const TTL_SLOTS = 216_000; // ~24h at ~2.5 slots/s — attestation validity window

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58e(buf) {
  const b = [...buf]; let z = 0; while (z < b.length && b[z] === 0) z++;
  const e = []; let s = z;
  while (s < b.length) { let r = 0; for (let i = s; i < b.length; i++) { const a = (r << 8) + b[i]; b[i] = (a / 58) | 0; r = a % 58; } e.push(B58[r]); if (b[s] === 0) s++; }
  return "1".repeat(z) + e.reverse().join("");
}

// Deterministic canonical JSON (sorted keys) so the hash is reproducible anywhere.
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

// ed25519 key: 32-byte raw public key from an SPKI-DER export (last 32 bytes).
function loadOrCreateSigner() {
  if (existsSync(KEY_PATH)) {
    const mode = statSync(KEY_PATH).mode & 0o777;
    if (mode & 0o077) { chmodSync(KEY_PATH, 0o600); process.stderr.write(`redde: tightened ${KEY_PATH.pathname} perms ${mode.toString(8)} -> 600\n`); }
    const { publicKeyDer, privateKeyPem } = JSON.parse(readFileSync(KEY_PATH, "utf8"));
    return { priv: createPrivateKey(privateKeyPem), pubRaw: Buffer.from(publicKeyDer, "base64").subarray(-32) };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  writeFileSync(KEY_PATH, JSON.stringify({ publicKeyDer, privateKeyPem }), { mode: 0o600 });
  return { priv: privateKey, pubRaw: Buffer.from(publicKeyDer, "base64").subarray(-32) };
}

// Pull the verdict-relevant fields out of either checker's --json shape.
function bindingFrom(v, cls, signer) {
  const evidence = {}; // the numbers a verifier reproduces
  let liability = null, backing = null;
  if (cls === "spl") {
    liability = v.inv2b?.claimedTotal ?? null;
    backing = v.inv2b?.redeemableBacking ?? null;
    Object.assign(evidence, { inv1: v.inv1, inv2a: v.inv2a, inv2b: v.inv2b });
  } else if (cls === "marinade") {
    liability = v.liability ?? null;
    backing = v.inv2b?.backing ?? null;
    Object.assign(evidence, { msolSupply: v.msolSupply, mintSupply: v.mintSupply, inv2b: v.inv2b, staleRecords: v.staleRecords });
  } else throw new Error("--class must be spl|marinade");

  const issuedAtSlot = Number.isSafeInteger(v.snapshotSlot) ? v.snapshotSlot : null;
  return {
    domain: DOMAIN,
    class: cls === "spl" ? "spl-stake-pool" : "marinade",
    target: v.target,
    epoch: v.epoch ?? v.currentEpoch ?? null,
    verdict: v.verdict,
    liability,
    backing,
    // A commitment to the CHECKER'S REPORTED numbers, not the raw chain inputs —
    // named honestly. A verifier reproduces by re-running the checker, not from this.
    report_commitment: sha256hex(canonical(evidence)),
    issued_at_slot: issuedAtSlot,
    expiry_slot: issuedAtSlot != null ? issuedAtSlot + TTL_SLOTS : null,
    signer,
  };
}

const args = process.argv.slice(2);
const { priv, pubRaw } = loadOrCreateSigner();
const signer = b58e(pubRaw);

if (args.includes("--pubkey")) { console.log(signer); process.exit(0); }

const clsArg = args[args.indexOf("--class") + 1];
const input = readFileSync(0, "utf8"); // verdict JSON from stdin
const verdict = JSON.parse(input);
const binding = bindingFrom(verdict, clsArg, signer);

// Refuse to sign a GREEN with no safe issued slot — an unexpirable GREEN is a
// fail-open authorization hazard downstream.
if (binding.verdict === "GREEN" && binding.issued_at_slot == null) {
  process.stderr.write("redde: refusing to sign a GREEN with no issued slot (checker did not report snapshotSlot)\n");
  process.exit(2);
}

const claim_hash = sha256hex(canonical(binding));
const message = Buffer.concat([Buffer.from(SIG_CONTEXT), Buffer.from(claim_hash, "hex")]);
const signature = edSign(null, message, priv).toString("base64");

console.log(JSON.stringify({ binding, claim_hash, signature }, null, 2));

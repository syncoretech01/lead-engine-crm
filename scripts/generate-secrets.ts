import { randomBytes } from "node:crypto";

// Each of these is consumed as high-entropy key material (HMAC secret / hashed
// to an AES key / shared webhook secret), so a 32-byte random value is ideal.
function secret() {
  return randomBytes(32).toString("base64url");
}

console.log("# Generated production secrets — set these in your hosting env (never commit).");
console.log(`SYNCORE_AUTH_SECRET="${secret()}"`);
console.log(`SYNCORE_WEBHOOK_SECRET="${secret()}"`);
console.log(`SYNCORE_CREDENTIAL_ENCRYPTION_KEY="${secret()}"`);
console.log(`SYNCORE_CREDENTIAL_KEY_ID="prod-key-${new Date().toISOString().slice(0, 10)}"`);

import { createHash, timingSafeEqual } from "node:crypto";
import { ApprovalPayload } from "@syncore/contracts";

/**
 * The approval payload hash — v9.1 §10, §26.13: "the approved object always
 * matches its hash".
 *
 * `@syncore/contracts` documents this rule and deliberately does not implement
 * it: a shared crypto helper would be executable code, and six repos inheriting
 * a shared runtime dependency is the anti-scope that package is defined against.
 * So these few lines live here, and must match the contracts README exactly.
 *
 * THE RULE (contracts README § Approvals):
 *
 *     canonical = JSON.stringify(payload, null, 2) + "\n"     // UTF-8, LF
 *     hash      = lowercase hex SHA-256 of those bytes
 *
 * ⚠️ PARSE FIRST. This is the part that is easy to get wrong and expensive to
 * debug, and it is not stated in the contracts README (reported in
 * docs/CRM-1-CONTRACTS-FEEDBACK.md § 2.1).
 *
 * `JSON.stringify` serialises keys in insertion order, so the digest depends on
 * key order. Zod rebuilds objects in schema-declaration order, which means
 * `ApprovalPayload.parse()` IS the key-order canonicalizer and `stringify` only
 * fixes whitespace. Measured against contracts 0.2.0:
 *
 *     parse(x) vs parse(shuffled x)        -> same hash   (top level AND nested)
 *     raw x    vs raw nested-shuffled x    -> DIFFERENT hash
 *
 * Both the CRM and the bot share the same schema, so both produce the same
 * ordering — but only if both parse. Hashing an incoming request body directly
 * is the obvious implementation and it yields a digest that depends on the
 * sender's key order: intermittent, cross-service, and effectively undebuggable.
 *
 * Never hash a raw body. Always go through here.
 */

/** The exact bytes that get hashed. Exported so tests can assert on them. */
export function canonicalApprovalPayloadJson(payload: unknown): string {
  // Parse, not validate-then-use-the-input: the parsed value is the canonical
  // key ordering. Throws on an invalid payload, which is correct — an
  // unparseable payload has no canonical form and must not acquire a hash.
  const parsed = ApprovalPayload.parse(payload);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/** Lowercase hex SHA-256 over the payload's canonical JSON form. */
export function hashApprovalPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalApprovalPayloadJson(payload), "utf8").digest("hex");
}

/**
 * Constant-time hash comparison (v9.1 §23).
 *
 * Overkill for a content digest read from our own database, deliberately: this
 * is also the check on a payload that arrived over the wire, and having one
 * comparison helper means nobody reaches for `===` on the path where it matters.
 */
export function approvalHashMatches(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(actual, "utf8"));
}

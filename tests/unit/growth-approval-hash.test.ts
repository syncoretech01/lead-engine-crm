import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  approvalHashMatches,
  canonicalApprovalPayloadJson,
  hashApprovalPayload
} from "@/lib/growth/approval-hash";

/**
 * Hash stability against the contracts fixture.
 *
 * ⚠️ The fixture's own `payloadSha256` is a PLACEHOLDER in contracts 0.2.0:
 * `b1946ac9…611184` is 32 hex characters repeated twice (the MD5 of "hello\n"),
 * not a SHA-256 of anything. Reported in docs/CRM-1-CONTRACTS-FEEDBACK.md § 1.1.
 *
 * So this pins the value computed from the fixture's own payload under the
 * canonicalization the contracts README specifies. That makes this repo's bytes
 * exact and gives the contracts repo the correct value to adopt.
 *
 * ON THE CONTRACTS BUMP: delete the constant and read `payloadSha256` from the
 * fixture instead. Until then the authority for this value is this repo, which
 * is backwards, and the sooner it is fixed the better.
 */
const EXPECTED_NICHE_TEST_PAYLOAD_SHA256 =
  "fa965db8128f718235afef87fc7d2ffcfddaa4e833e1af3cccb87a1f2c1dbd13";

const require = createRequire(import.meta.url);
const fixture = JSON.parse(
  readFileSync(require.resolve("@syncore/contracts/fixtures/approvals/approval-record.json"), "utf8")
) as { payload: Record<string, unknown>; payloadSha256: string };

describe("approval payload canonicalization", () => {
  it("reproduces the canonical hash of the contracts fixture payload", () => {
    expect(hashApprovalPayload(fixture.payload)).toBe(EXPECTED_NICHE_TEST_PAYLOAD_SHA256);
  });

  it("documents that the fixture's own hash is still the placeholder", () => {
    // This test is a tripwire, not an endorsement. When contracts patches the
    // fixture it FAILS, which is the signal to delete the pinned constant above
    // and read the value from the fixture.
    expect(fixture.payloadSha256).toBe(
      "b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184"
    );
    expect(fixture.payloadSha256).not.toBe(EXPECTED_NICHE_TEST_PAYLOAD_SHA256);
  });

  it("emits two-space indented JSON with a trailing newline", () => {
    const canonical = canonicalApprovalPayloadJson(fixture.payload);
    expect(canonical.endsWith("}\n")).toBe(true);
    expect(canonical).toContain('\n  "type": "NICHE_TEST"');
  });

  it("is lowercase hex, 64 characters", () => {
    expect(hashApprovalPayload(fixture.payload)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is independent of top-level key order", () => {
    const p = fixture.payload;
    const shuffled = {
      summary: p.summary,
      brief: p.brief,
      type: p.type,
      nicheBriefId: p.nicheBriefId,
      estimatedCostCents: p.estimatedCostCents,
      title: p.title,
      nicheRequestId: p.nicheRequestId
    };
    expect(hashApprovalPayload(shuffled)).toBe(hashApprovalPayload(p));
  });

  it("is independent of NESTED key order", () => {
    // The case that would slip through a top-level-only implementation, and the
    // reason hashing goes through .parse() rather than straight to stringify.
    const brief = fixture.payload.brief as Record<string, unknown>;
    const nestedShuffled = {
      ...fixture.payload,
      brief: Object.fromEntries(Object.entries(brief).reverse())
    };
    expect(hashApprovalPayload(nestedShuffled)).toBe(hashApprovalPayload(fixture.payload));
  });

  it("changes when the content changes", () => {
    const edited = { ...fixture.payload, title: "Approve ICP: something else" };
    expect(hashApprovalPayload(edited)).not.toBe(hashApprovalPayload(fixture.payload));
  });

  it("is stable across repeated calls with identical content", () => {
    // Identical content revised twice MUST hash the same — that is how the
    // revision chain answers "did the content actually change?".
    const copy = JSON.parse(JSON.stringify(fixture.payload));
    expect(hashApprovalPayload(copy)).toBe(hashApprovalPayload(fixture.payload));
  });

  it("refuses to hash a payload that does not parse", () => {
    // An unparseable payload has no canonical form and must never acquire a hash.
    expect(() => hashApprovalPayload({ type: "NOT_A_GATE" })).toThrow();
    expect(() => hashApprovalPayload({ ...fixture.payload, type: undefined })).toThrow();
  });
});

describe("approvalHashMatches", () => {
  it("matches identical digests and rejects different ones", () => {
    const h = hashApprovalPayload(fixture.payload);
    expect(approvalHashMatches(h, h)).toBe(true);
    expect(approvalHashMatches(h, h.replace(/.$/, "0"))).toBe(false);
  });

  it("rejects a length mismatch without throwing", () => {
    // timingSafeEqual throws on unequal lengths; the guard must come first.
    expect(approvalHashMatches(hashApprovalPayload(fixture.payload), "short")).toBe(false);
  });
});

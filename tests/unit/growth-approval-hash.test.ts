import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  approvalHashMatches,
  canonicalApprovalPayloadJson,
  hashApprovalPayload
} from "@/lib/growth/approval-hash";

const require = createRequire(import.meta.url);
const fixture = JSON.parse(
  readFileSync(require.resolve("@syncore/contracts/fixtures/approvals/approval-record.json"), "utf8")
) as { payload: Record<string, unknown>; payloadSha256: string };

describe("approval payload canonicalization", () => {
  it("reproduces the canonical hash of the contracts fixture payload", () => {
    expect(hashApprovalPayload(fixture.payload)).toBe(fixture.payloadSha256);
  });

  it("consumes the corrected Contracts v0.2.1 fixture digest", () => {
    expect(fixture.payloadSha256).toBe(
      "fa965db8128f718235afef87fc7d2ffcfddaa4e833e1af3cccb87a1f2c1dbd13"
    );
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

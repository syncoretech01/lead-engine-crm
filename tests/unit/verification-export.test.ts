import { describe, expect, it } from "vitest";
import { findExportRule, recordIdsForExport } from "@/lib/phase1/exporting";
import { createSeedState } from "@/lib/phase1/seed";
import { latestVerificationForContact, runWorkspaceVerification } from "@/lib/phase1/verification";

describe("verification and export gates", () => {
  it("assigns verification grades and stores provider, raw response, and TTL", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;

    const result = runWorkspaceVerification(state, workspaceId);

    expect(result.verified + result.risky + result.invalid + result.suppressed).toBe(state.contacts.length);
    for (const contact of state.contacts) {
      expect(["A", "B", "C", "D", "S"]).toContain(contact.grade);
      const latest = latestVerificationForContact(state, contact.id);
      expect(latest.provider).toBe("Syncore Local");
      expect(latest.rawResponse).toMatchObject({ checks: expect.any(Array) });
      expect(Date.parse(latest.expiresAt)).toBeGreaterThan(Date.parse(latest.verifiedAt));
    }
  });

  it("exports verified email leads with only approved grades and no suppressed contacts", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const eligible = state.contacts.find((contact) => !contact.isSuppressed && (contact.grade === "A" || contact.grade === "B"));

    expect(eligible).toBeDefined();
    if (!eligible) return;

    eligible.status = "Ready for SDR";
    eligible.score = Math.max(eligible.score, 70);

    const rule = findExportRule(state, workspaceId, "verified_email_leads");
    const exportedIds = recordIdsForExport(state, workspaceId, "verified_email_leads", rule);

    expect(exportedIds.length).toBeGreaterThan(0);
    for (const contact of state.contacts.filter((item) => exportedIds.includes(item.id))) {
      expect(["A", "B"]).toContain(contact.grade);
      expect(contact.isSuppressed).toBe(false);
    }

    const blocked = state.contacts.filter((contact) => contact.grade === "D" || contact.grade === "S" || contact.isSuppressed);
    expect(blocked.some((contact) => exportedIds.includes(contact.id))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { dedupeTimelineActivities } from "@/lib/phase1/crm-display";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import type { Activity } from "@/lib/phase1/types";

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: overrides.id ?? `activity-${Math.random().toString(36).slice(2)}`,
    workspaceId: overrides.workspaceId ?? "workspace-1",
    companyId: overrides.companyId,
    contactId: overrides.contactId,
    opportunityId: overrides.opportunityId,
    type: overrides.type ?? "Note",
    title: overrides.title ?? "Assigned to Sam Carter",
    body: overrides.body,
    actorUserId: overrides.actorUserId ?? "user-bobby",
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? "2026-06-27T12:00:00.000Z"
  };
}

describe("CRM display helpers", () => {
  it("keeps meaningful contact names", () => {
    expect(displayContactName({ name: "Usama Ahmed Khan", email: "fallback@example.com" })).toBe(
      "Usama Ahmed Khan"
    );
  });

  it("falls back from placeholder or email-like names to a readable email label", () => {
    expect(displayContactName({ name: "Unknown contact", email: "muneeb_000@hotmail.com" })).toBe("Muneeb");
    expect(displayContactName({ name: "skills.essential@gmail.com", email: "skills.essential@gmail.com" })).toBe(
      "Skills Essential"
    );
  });

  it("uses the fallback when neither name nor email can produce a person label", () => {
    expect(displayContactName({ name: "Unknown contact", email: "hello@syncoretech.com" })).toBe("Unknown contact");
    expect(displayContactName(undefined, "No contact")).toBe("No contact");
  });

  it("deduplicates repeated timeline entries from the same record on the same day", () => {
    const entries = [
      activity({ id: "a1", contactId: "contact-1", title: "Reassigned to Sam Carter" }),
      activity({ id: "a2", contactId: "contact-1", title: "Reassigned to Sam Carter" }),
      activity({ id: "a3", contactId: "contact-1", title: "Reassigned to Sam Carter", body: "Manual manager reassignment." }),
      activity({
        id: "a4",
        contactId: "contact-1",
        title: "Reassigned to Sam Carter",
        createdAt: "2026-06-28T12:00:00.000Z"
      })
    ];

    expect(dedupeTimelineActivities(entries).map((entry) => entry.id)).toEqual(["a1", "a3", "a4"]);
  });
});

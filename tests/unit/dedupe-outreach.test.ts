import { describe, expect, it } from "vitest";
import { detectWorkspaceDuplicates, mergeDedupeMatch } from "@/lib/phase1/dedupe";
import { createEmailEvent } from "@/lib/phase1/outreach";
import { createSeedState } from "@/lib/phase1/seed";

describe("dedupe and outreach suppression", () => {
  it("detects and merges duplicate contacts by email", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const source = state.contacts.find((contact) => !contact.isSuppressed && contact.email);

    expect(source).toBeDefined();
    if (!source) return;

    const duplicate = {
      ...source,
      id: "contact-duplicate-test",
      score: Math.max(source.score - 10, 1),
      sourceLineage: [...source.sourceLineage, "Unit test duplicate"]
    };
    state.contacts.push(duplicate);

    const beforeCount = state.contacts.length;
    const result = detectWorkspaceDuplicates(state, workspaceId);
    const match = state.dedupeMatches.find(
      (item) => item.status === "Open" && item.objectType === "contact" && item.duplicateId === duplicate.id
    );

    expect(result.open).toBeGreaterThan(0);
    expect(match?.reason).toBe("Email address match");
    expect(match && mergeDedupeMatch(state, match.id)).toBe(true);
    expect(state.contacts.length).toBe(beforeCount - 1);
    expect(state.contacts.some((contact) => contact.id === duplicate.id)).toBe(false);
  });

  it("hard bounces immediately suppress the contact and add a suppression record", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const contact = state.contacts.find((item) => !item.isSuppressed && item.email);

    expect(contact).toBeDefined();
    if (!contact) return;

    const event = createEmailEvent(state, {
      workspaceId,
      contactId: contact.id,
      eventType: "Bounced",
      subject: "Unit test bounce",
      bodySnapshot: "Hard bounce webhook from test.",
      actorUserId: state.users[0].id,
      bounceType: "Hard",
      smtpCode: "550"
    });
    const updatedContact = state.contacts.find((item) => item.id === contact.id);

    expect(event.eventType).toBe("Bounced");
    expect(updatedContact?.isSuppressed).toBe(true);
    expect(updatedContact?.grade).toBe("S");
    expect(state.suppressionRecords.some((record) => record.type === "Hard bounce" && record.email === contact.email)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { updateContactDetailsForWorkspace } from "@/lib/phase1/contact-details";
import { createSeedState } from "@/lib/phase1/seed";

describe("contact detail editing", () => {
  it("updates canonical contact details and matching normalized lead rows", () => {
    const state = createSeedState();
    const contact = state.contacts[0];
    const workspaceId = contact.workspaceId;
    const normalized = state.normalizedRecords[0];
    normalized.workspaceId = workspaceId;
    normalized.duplicateContactId = contact.id;
    normalized.contactName = contact.name;
    normalized.email = contact.email;
    normalized.phone = contact.phone;

    const result = updateContactDetailsForWorkspace(state, {
      workspaceId,
      contactId: contact.id,
      name: "Updated Buyer",
      email: "Updated.Buyer@Example.com",
      phone: "(816) 704-5551",
      now: "2026-06-30T12:00:00.000Z"
    });

    expect(contact.name).toBe("Updated Buyer");
    expect(contact.email).toBe("updated.buyer@example.com");
    expect(contact.phone).toBe("+1 816 704 5551");
    expect(contact.updatedAt).toBe("2026-06-30T12:00:00.000Z");
    expect(normalized.contactName).toBe("Updated Buyer");
    expect(normalized.email).toBe("updated.buyer@example.com");
    expect(normalized.phone).toBe("+1 816 704 5551");
    expect(result.changedFields).toEqual(["name", "email", "phone"]);
    expect(result.normalizedRecordsUpdated).toBeGreaterThanOrEqual(1);
  });

  it("requires a real contact name", () => {
    const state = createSeedState();
    const contact = state.contacts[0];

    expect(() =>
      updateContactDetailsForWorkspace(state, {
        workspaceId: contact.workspaceId,
        contactId: contact.id,
        name: "   "
      })
    ).toThrow("Contact name is required.");
  });

  it("rejects invalid email and very short phone values", () => {
    const state = createSeedState();
    const contact = state.contacts[0];

    expect(() =>
      updateContactDetailsForWorkspace(state, {
        workspaceId: contact.workspaceId,
        contactId: contact.id,
        name: contact.name,
        email: "not-an-email"
      })
    ).toThrow("Enter a valid email address.");

    expect(() =>
      updateContactDetailsForWorkspace(state, {
        workspaceId: contact.workspaceId,
        contactId: contact.id,
        name: contact.name,
        phone: "12345"
      })
    ).toThrow("Enter a valid phone number.");
  });
});

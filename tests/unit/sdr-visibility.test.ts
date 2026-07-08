import { describe, expect, it } from "vitest";
import { resolveSession, restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { ownedCrmRecordScope } from "@/lib/phase1/queries";
import { createSeedState } from "@/lib/phase1/seed";
import { assignContactToSdr, assignWorkspaceLeads } from "@/lib/phase1/sdr";

describe("SDR record visibility", () => {
  it("flags only the SDR role for owned-record scoping", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const sdrMember = state.workspaceMembers.find((member) => member.workspaceId === workspaceId && member.role === "SDR");
    const adminMember = state.workspaceMembers.find((member) => member.workspaceId === workspaceId && member.role === "Admin");

    if (!sdrMember || !adminMember) {
      throw new Error("Expected seeded SDR and Admin members.");
    }

    expect(restrictsToOwnedRecords(resolveSession(state, { userId: sdrMember.userId, workspaceId }))).toBe(true);
    expect(restrictsToOwnedRecords(resolveSession(state, { userId: adminMember.userId, workspaceId }))).toBe(false);
  });

  it("scopes CRM records to the SDR they are assigned to", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    assignWorkspaceLeads(state, workspaceId, state.users[0].id);

    const memberIds = new Set(
      state.workspaceMembers.filter((member) => member.workspaceId === workspaceId).map((member) => member.userId)
    );
    const ownedAssignment = state.sdrAssignments.find(
      (assignment) =>
        assignment.workspaceId === workspaceId &&
        Boolean(assignment.contactId) &&
        memberIds.has(assignment.assignedSdrId)
    );

    if (!ownedAssignment?.contactId) {
      throw new Error("Expected at least one SDR assignment with a contact for a workspace member.");
    }

    const session = resolveSession(state, { userId: ownedAssignment.assignedSdrId, workspaceId });
    const scope = ownedCrmRecordScope(state, session);

    expect(scope.contactIds.has(ownedAssignment.contactId)).toBe(true);
    if (ownedAssignment.companyId) {
      expect(scope.companyIds.has(ownedAssignment.companyId)).toBe(true);
    }

    const foreignAssignment = state.sdrAssignments.find(
      (assignment) =>
        assignment.workspaceId === workspaceId &&
        Boolean(assignment.contactId) &&
        assignment.assignedSdrId !== ownedAssignment.assignedSdrId
    );

    if (foreignAssignment?.contactId) {
      expect(scope.contactIds.has(foreignAssignment.contactId)).toBe(false);
    }
  });

  it("creates assignments in the requested ordered contact sequence", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    state.sdrAssignments = [];
    const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId).slice(0, 3);
    for (const contact of contacts) {
      contact.owner = "Unassigned";
      contact.status = "Ready for SDR";
      contact.priority = "P2";
      contact.isSuppressed = false;
    }
    const orderedContactIds = contacts.map((contact) => contact.id).reverse();

    const result = assignWorkspaceLeads(state, workspaceId, state.users[0].id, "2026-01-01T00:00:00.000Z", {
      orderedContactIds,
      eligibleContactIds: new Set(orderedContactIds)
    });

    expect(result.created).toBe(3);
    expect(state.sdrAssignments.map((assignment) => assignment.contactId)).toEqual(orderedContactIds);
  });

  it("keeps multiple contacts from the same account with the first assigned SDR", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    state.sdrAssignments = [];
    state.followUpReminders = [];

    const accountContacts = state.contacts
      .filter((contact) => contact.workspaceId === workspaceId && contact.companyId === "company-lone-star")
      .slice(0, 2);
    if (accountContacts.length < 2) {
      throw new Error("Expected seeded account contacts.");
    }

    const [firstContact, secondContact] = accountContacts;
    firstContact.owner = "Mina Brooks";
    secondContact.owner = "Unassigned";
    for (const contact of accountContacts) {
      contact.status = "Ready for SDR";
      contact.priority = "P2";
      contact.isSuppressed = false;
    }

    const result = assignWorkspaceLeads(state, workspaceId, state.users[0].id, "2026-01-01T00:00:00.000Z", {
      orderedContactIds: accountContacts.map((contact) => contact.id),
      eligibleContactIds: new Set(accountContacts.map((contact) => contact.id))
    });

    expect(result.created).toBe(2);
    const assignments = state.sdrAssignments.filter((assignment) =>
      accountContacts.some((contact) => contact.id === assignment.contactId)
    );
    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((assignment) => assignment.assignedSdrId))).toEqual(new Set(["user-mina"]));
    expect(assignments[1].assignmentMethod).toBe("Account ownership");
    expect(assignments[1].assignmentReason).toContain("all contacts stay with one owner");
  });

  it("keeps direct contact assignments on the existing account SDR", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    state.sdrAssignments = [];
    state.followUpReminders = [];

    const accountContacts = state.contacts
      .filter((contact) => contact.workspaceId === workspaceId && contact.companyId === "company-lone-star")
      .slice(0, 2);
    if (accountContacts.length < 2) {
      throw new Error("Expected seeded account contacts.");
    }

    for (const contact of accountContacts) {
      contact.owner = "Unassigned";
      contact.status = "Ready for SDR";
      contact.priority = "P2";
      contact.isSuppressed = false;
    }

    assignContactToSdr(state, {
      workspaceId,
      contactId: accountContacts[0].id,
      sdrId: "user-ari",
      actorUserId: "user-nora",
      reason: "Seed account owner.",
      method: "Round robin"
    });
    assignContactToSdr(state, {
      workspaceId,
      contactId: accountContacts[1].id,
      sdrId: "user-mina",
      actorUserId: "user-nora",
      reason: "Attempted split.",
      method: "Round robin"
    });

    const assignments = state.sdrAssignments.filter((assignment) =>
      accountContacts.some((contact) => contact.id === assignment.contactId)
    );
    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((assignment) => assignment.assignedSdrId))).toEqual(new Set(["user-ari"]));
    expect(assignments[1].assignmentReason).toContain("all contacts stay with one owner");
  });
});

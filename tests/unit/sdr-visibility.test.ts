import { describe, expect, it } from "vitest";
import { resolveSession, restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { ownedCrmRecordScope } from "@/lib/phase1/queries";
import { createSeedState } from "@/lib/phase1/seed";
import { assignWorkspaceLeads } from "@/lib/phase1/sdr";

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
});

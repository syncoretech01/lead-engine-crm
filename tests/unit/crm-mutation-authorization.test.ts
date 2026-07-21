import { describe, expect, it } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import {
  assertCanManageCrmConfiguration,
  assertCanMutateAssignment,
  assertCanMutateCrmTarget,
  assertCanMutateReminder,
  assertCanMutateTask,
  resolveCrmMutationUserId
} from "@/lib/phase1/crm-mutation-authorization";
import { createSeedState } from "@/lib/phase1/seed";

function authorizationFixture() {
  const state = createSeedState();
  const ownAssignment = state.sdrAssignments.find((item) => item.assignedSdrId === "user-ari")!;
  const sourceCompany = state.companies.find((item) => item.id === ownAssignment.companyId)!;
  const sourceContact = state.contacts.find((item) => item.id === ownAssignment.contactId)!;
  const now = "2026-07-20T12:00:00.000Z";

  state.users.push({
    id: "user-sam",
    name: "Sam Carter",
    email: "sam@example.com",
    timezone: "Asia/Karachi",
    createdAt: now
  });
  state.workspaceMembers.push({
    id: "member-sam",
    workspaceId: "workspace-syncore",
    userId: "user-sam",
    role: "SDR"
  });
  state.companies.push({ ...sourceCompany, id: "company-sam", name: "Sam Account" });
  state.contacts.push({
    ...sourceContact,
    id: "contact-sam",
    companyId: "company-sam",
    name: "Sam Contact",
    owner: "Sam Carter"
  });
  state.sdrAssignments.push({
    ...ownAssignment,
    id: "assignment-sam",
    companyId: "company-sam",
    contactId: "contact-sam",
    assignedSdrId: "user-sam"
  });
  state.opportunities.push({
    id: "opportunity-sam",
    workspaceId: "workspace-syncore",
    companyId: "company-sam",
    contactId: "contact-sam",
    name: "Sam Opportunity",
    stage: "Prospecting",
    amount: 0,
    probability: 10,
    ownerUserId: "user-sam",
    source: "Test",
    createdAt: now,
    updatedAt: now
  });

  return {
    state,
    ownAssignment,
    sdr: resolveSession(state, { userId: "user-ari", workspaceId: "workspace-syncore" }),
    manager: resolveSession(state, { userId: "user-mina", workspaceId: "workspace-syncore" })
  };
}

describe("CRM mutation authorization", () => {
  it("allows SDRs to mutate their assigned records and blocks another SDR's records", () => {
    const { state, ownAssignment, sdr } = authorizationFixture();

    expect(() =>
      assertCanMutateCrmTarget(
        state,
        sdr,
        { contactId: ownAssignment.contactId, companyId: ownAssignment.companyId },
        "contacts"
      )
    ).not.toThrow();
    expect(() =>
      assertCanMutateCrmTarget(state, sdr, { contactId: "contact-sam" }, "contacts")
    ).toThrow(/assigned to you/);
    expect(() =>
      assertCanMutateCrmTarget(state, sdr, { companyId: "company-sam" }, "accounts")
    ).toThrow(/assigned to you/);
    expect(() =>
      assertCanMutateCrmTarget(state, sdr, { opportunityId: "opportunity-sam" }, "opportunities")
    ).toThrow(/assigned to you/);
  });

  it("allows managers to mutate workspace records", () => {
    const { state, manager } = authorizationFixture();

    expect(() =>
      assertCanMutateCrmTarget(
        state,
        manager,
        { contactId: "contact-sam", opportunityId: "opportunity-sam" },
        "records"
      )
    ).not.toThrow();
    expect(() => assertCanManageCrmConfiguration(manager)).not.toThrow();
  });

  it("guards assignments, reminders, and tasks with the SDR ownership boundary", () => {
    const { state, ownAssignment, sdr } = authorizationFixture();
    const foreignAssignment = state.sdrAssignments.find((item) => item.id === "assignment-sam")!;

    expect(() => assertCanMutateAssignment(sdr, ownAssignment)).not.toThrow();
    expect(() => assertCanMutateAssignment(sdr, foreignAssignment)).toThrow(/assigned to you/);
    expect(() =>
      assertCanMutateReminder(state, sdr, {
        assignmentId: foreignAssignment.id
      })
    ).toThrow(/assigned to you/);
    expect(() =>
      assertCanMutateTask(state, sdr, {
        id: "task-sam",
        workspaceId: "workspace-syncore",
        contactId: "contact-sam",
        companyId: "company-sam",
        title: "Foreign task",
        status: "Open",
        priority: "Normal",
        ownerUserId: "user-sam",
        createdById: "user-sam",
        createdAt: "2026-07-20T12:00:00.000Z",
        updatedAt: "2026-07-20T12:00:00.000Z"
      })
    ).toThrow(/assigned to you/);
  });

  it("prevents SDR identity impersonation and manager selection of non-members", () => {
    const { state, sdr, manager } = authorizationFixture();

    expect(resolveCrmMutationUserId(state, sdr, "user-sam")).toBe("user-ari");
    expect(resolveCrmMutationUserId(state, manager, "user-sam")).toBe("user-sam");
    expect(() => resolveCrmMutationUserId(state, manager, "user-not-a-member")).toThrow(/member/);
    expect(() => assertCanManageCrmConfiguration(sdr)).toThrow(/managers and admins/);
  });
});

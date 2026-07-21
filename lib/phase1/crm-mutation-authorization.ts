import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { ownedCrmRecordScope } from "@/lib/phase1/queries";
import { assertWorkspaceMember } from "@/lib/phase1/tenant-isolation";
import type {
  AppState,
  CrmTask,
  FollowUpReminder,
  SdrAssignment,
  Session
} from "@/lib/phase1/types";

type CrmMutationTarget = {
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
};

/**
 * Enforce the same assigned-record boundary on writes that CRM read models use
 * for SDRs. Roles with view-all access (managers/admins) retain workspace-wide
 * mutation access; cross-workspace lookup remains the caller's responsibility.
 */
export function assertCanMutateCrmTarget(
  state: AppState,
  session: Session,
  target: CrmMutationTarget,
  label = "CRM record"
) {
  if (!restrictsToOwnedRecords(session)) return;

  const scope = ownedCrmRecordScope(state, session);
  const checks: boolean[] = [];

  if (target.contactId) checks.push(scope.contactIds.has(target.contactId));
  if (target.companyId) checks.push(scope.companyIds.has(target.companyId));
  if (target.opportunityId) {
    const opportunity = state.opportunities.find(
      (item) => item.id === target.opportunityId && item.workspaceId === session.workspace.id
    );
    checks.push(
      Boolean(
        opportunity &&
          (opportunity.ownerUserId === session.user.id ||
            (opportunity.contactId && scope.contactIds.has(opportunity.contactId)) ||
            scope.companyIds.has(opportunity.companyId))
      )
    );
  }

  if (checks.length === 0 || checks.some((allowed) => !allowed)) {
    throw new Error(`You can only modify ${label.toLowerCase()} assigned to you.`);
  }
}

export function assertCanMutateTask(state: AppState, session: Session, task: CrmTask) {
  if (!restrictsToOwnedRecords(session) || task.ownerUserId === session.user.id) return;
  assertCanMutateCrmTarget(
    state,
    session,
    { contactId: task.contactId, companyId: task.companyId },
    "task"
  );
}

export function assertCanMutateAssignment(
  session: Session,
  assignment: Pick<SdrAssignment, "assignedSdrId">
) {
  if (restrictsToOwnedRecords(session) && assignment.assignedSdrId !== session.user.id) {
    throw new Error("You can only modify assignments assigned to you.");
  }
}

export function assertCanMutateReminder(
  state: AppState,
  session: Session,
  reminder: Pick<FollowUpReminder, "assignmentId">
) {
  if (!restrictsToOwnedRecords(session)) return;
  const assignment = state.sdrAssignments.find(
    (item) => item.id === reminder.assignmentId && item.workspaceId === session.workspace.id
  );
  if (!assignment || assignment.assignedSdrId !== session.user.id) {
    throw new Error("You can only complete follow-ups assigned to you.");
  }
}

/** SDRs always write as themselves. Managers may select another workspace member. */
export function resolveCrmMutationUserId(
  state: AppState,
  session: Session,
  requestedUserId?: string
) {
  if (restrictsToOwnedRecords(session)) return session.user.id;
  const userId = requestedUserId?.trim() || session.user.id;
  assertWorkspaceMember(state, session.workspace.id, userId);
  if (!state.users.some((user) => user.id === userId)) {
    throw new Error("Selected user was not found.");
  }
  return userId;
}

export function assertCanManageCrmConfiguration(session: Session) {
  if (restrictsToOwnedRecords(session)) {
    throw new Error("Only managers and admins can change CRM configuration.");
  }
}

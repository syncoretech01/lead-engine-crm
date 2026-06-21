import type { AppState, Permission, Session, WorkspaceRole } from "@/lib/phase1/types";

export type SessionSelection = {
  userId?: string;
  workspaceId?: string;
  authSessionId?: string;
};

const permissionsByRole: Record<WorkspaceRole, Permission[]> = {
  Admin: [
    "manage_workspace",
    "manage_profiles",
    "run_jobs",
    "import_csv",
    "view_all_records",
    "view_records",
    "manage_crm",
    "manage_sdr",
    "manage_sdr_team",
    "manage_outreach",
    "send_direct_outreach",
    "manage_waterfalls",
    "export_csv",
    "manage_export_rules",
    "manage_enrichment",
    "manage_compliance",
    "view_reports",
    "manage_retention",
    "manage_ai_automation"
  ],
  Manager: [
    "view_all_records",
    "view_records",
    "manage_profiles",
    "run_jobs",
    "import_csv",
    "manage_crm",
    "manage_sdr",
    "manage_sdr_team",
    "manage_outreach",
    "send_direct_outreach",
    "manage_waterfalls",
    "export_csv",
    "manage_export_rules",
    "manage_enrichment"
  ],
  SDR: ["view_records", "manage_crm", "manage_sdr", "send_direct_outreach"],
  "Data Operator": [
    "manage_profiles",
    "run_jobs",
    "import_csv",
    "view_all_records",
    "view_records",
    "export_csv",
    "manage_export_rules",
    "manage_enrichment"
  ],
  Viewer: ["view_all_records", "view_records", "view_reports"],
  "Compliance Admin": ["view_all_records", "view_records", "export_csv", "manage_compliance", "view_reports", "manage_retention"]
};

export function getDemoSession(state: AppState): Session {
  return resolveSession(state, {});
}

export function resolveSession(state: AppState, selection: SessionSelection): Session {
  const workspace = selection.workspaceId
    ? state.workspaces.find((item) => item.id === selection.workspaceId)
    : state.workspaces[0];
  const user = selection.userId ? state.users.find((item) => item.id === selection.userId) : state.users[0];

  if (!workspace) {
    throw new Error("Workspace session could not be resolved.");
  }

  if (!user) {
    throw new Error("User session could not be resolved.");
  }

  const membership = state.workspaceMembers.find(
    (member) => member.workspaceId === workspace.id && member.userId === user.id
  );

  if (!membership) {
    throw new Error(`${user.email} is not a member of ${workspace.name}.`);
  }

  const role = membership.role;

  return {
    user,
    workspace,
    role,
    permissions: permissionsByRole[role],
    authSessionId: selection.authSessionId,
    superadmin: state.authAccounts?.find((account) => account.userId === user.id)?.superadmin ?? false
  };
}

export function assertPermission(session: Session, permission: Permission) {
  if (!hasPermission(session, permission)) {
    throw new Error(`${session.role} does not have ${permission} permission.`);
  }
}

export function hasPermission(session: Session, permission: Permission) {
  return session.permissions.includes(permission);
}

export function canUseLeadGenerationWorkspace(session: Session) {
  return session.role === "Admin" || session.role === "Manager" || session.role === "Data Operator";
}

export function canUseCrmWorkspace(session: Session) {
  return session.role === "Admin" || session.role === "Manager" || session.role === "SDR";
}

export function canUseDeveloperWorkspace(session: Session) {
  return session.permissions.includes("manage_workspace");
}

/**
 * Roles that can view CRM records but lack the "view all" grant (i.e. SDRs) are
 * scoped to the records assigned to them. Roles with view_all_records (managers,
 * admins, data operators, etc.) keep the full workspace view. Row-level scoping
 * is applied in the CRM read paths (see ownedCrmRecordScope).
 */
export function restrictsToOwnedRecords(session: Session) {
  return session.permissions.includes("view_records") && !session.permissions.includes("view_all_records");
}

export function defaultWorkspacePath(session: Session) {
  if (canUseLeadGenerationWorkspace(session)) return "/";
  if (canUseCrmWorkspace(session)) return "/crm";
  if (canUseDeveloperWorkspace(session)) return "/integrations";
  return "/";
}

export function rolePermissions(role: WorkspaceRole) {
  return permissionsByRole[role];
}

export function workspaceRoleLabel(role: WorkspaceRole) {
  if (role === "Admin") return "Owner / Developer";
  if (role === "Data Operator") return "Lead Engine Specialist";
  return role;
}

import type { AppState, Permission, Session, WorkspaceRole } from "@/lib/phase1/types";

export type SessionSelection = {
  userId?: string;
  workspaceId?: string;
};

const permissionsByRole: Record<WorkspaceRole, Permission[]> = {
  Admin: [
    "manage_workspace",
    "manage_profiles",
    "run_jobs",
    "import_csv",
    "view_all_records",
    "manage_crm",
    "manage_sdr",
    "manage_outreach",
    "export_csv",
    "manage_export_rules",
    "manage_enrichment",
    "manage_compliance",
    "view_reports",
    "manage_retention",
    "manage_ai_automation"
  ],
  Manager: [
    "manage_profiles",
    "run_jobs",
    "view_all_records",
    "manage_crm",
    "manage_sdr",
    "manage_outreach",
    "export_csv",
    "manage_enrichment",
    "view_reports",
    "manage_ai_automation"
  ],
  SDR: ["view_all_records", "manage_crm", "manage_sdr", "manage_outreach", "manage_ai_automation"],
  "Data Operator": [
    "manage_profiles",
    "run_jobs",
    "import_csv",
    "view_all_records",
    "manage_crm",
    "manage_sdr",
    "manage_outreach",
    "export_csv",
    "manage_export_rules",
    "manage_enrichment",
    "view_reports",
    "manage_ai_automation"
  ],
  Viewer: ["view_all_records", "view_reports"],
  "Compliance Admin": ["view_all_records", "export_csv", "manage_compliance", "view_reports", "manage_retention"]
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
    permissions: permissionsByRole[role]
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

export function rolePermissions(role: WorkspaceRole) {
  return permissionsByRole[role];
}

import { randomUUID } from "node:crypto";
import type { AppState, AuditLog, Session, User } from "@/lib/phase1/types";

type WorkspaceScopedRecord = {
  id: string;
  workspaceId: string;
};

export function assertWorkspaceExists(state: AppState, workspaceId: string) {
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new Error("Workspace not found.");
  }
}

export function assertSessionWorkspace(session: Session, workspaceId: string) {
  if (session.workspace.id !== workspaceId) {
    throw new Error("Current session is not scoped to this workspace.");
  }
}

export function assertWorkspaceMember(state: AppState, workspaceId: string, userId: string) {
  assertWorkspaceExists(state, workspaceId);
  if (!state.workspaceMembers.some((member) => member.workspaceId === workspaceId && member.userId === userId)) {
    throw new Error("User is not a member of this workspace.");
  }
}

export function requireWorkspaceScopedRecord<T extends WorkspaceScopedRecord>(
  record: T | undefined,
  workspaceId: string,
  label: string
): T {
  if (!record || record.workspaceId !== workspaceId) {
    throw new Error(`${label} not found in workspace.`);
  }

  return record;
}

export function systemActorForWorkspace(state: AppState, workspaceId: string): User {
  assertWorkspaceExists(state, workspaceId);
  const member =
    state.workspaceMembers.find((item) => item.workspaceId === workspaceId && item.role === "Admin") ??
    state.workspaceMembers.find((item) => item.workspaceId === workspaceId);
  const user = member ? state.users.find((item) => item.id === member.userId) : undefined;

  if (!user) {
    throw new Error("Workspace system actor could not be resolved.");
  }

  return user;
}

export function appendWorkspaceAudit(
  state: AppState,
  input: Omit<AuditLog, "id" | "createdAt">
) {
  state.auditLogs.unshift({
    id: `audit-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...input
  });
}

export function resolveSignedWebhookWorkspaceId(state: AppState, payload: { workspaceId?: unknown }) {
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId.trim() : "";
  if (!workspaceId) {
    throw new Error("Signed webhook payload must include workspaceId.");
  }

  assertWorkspaceExists(state, workspaceId);
  return workspaceId;
}

export function workspaceStoragePath(workspaceId: string, ...segments: string[]) {
  return ["workspaces", sanitizePathSegment(workspaceId), ...segments.map(sanitizePathSegment)].join("/");
}

function sanitizePathSegment(value: string) {
  const clean = value.replace(/[\\/]+/g, "-").replace(/[^a-zA-Z0-9._=-]/g, "");
  return clean && clean !== "." && clean !== ".." ? clean : "item";
}

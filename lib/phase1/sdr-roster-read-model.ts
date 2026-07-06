import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

export type SdrRosterEntry = { id: string; name: string };

/**
 * Cheap workspace SDR/Manager roster for the bulk "Assign SDR" picker. Uses the
 * [workspaceId, role] index; returns undefined on the file store so callers fall
 * back to computing it from in-memory state.
 */
export async function readWorkspaceSdrRoster(
  workspaceId: string
): Promise<SdrRosterEntry[] | undefined> {
  if (resolveStorageDriver() !== "prisma") return undefined;
  const { prisma } = await import("@/lib/prisma");
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: { in: ["SDR", "MANAGER"] } },
    select: { user: { select: { id: true, name: true } } }
  });
  return members
    .map((member) => ({ id: member.user.id, name: member.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

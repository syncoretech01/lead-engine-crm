export type UserWorkspaceOption = { id: string; name: string };

/**
 * The workspaces a user is a member of, for the in-app workspace switcher. Cheap
 * native query on the small WorkspaceMember table; the switcher only renders when
 * this returns more than one.
 */
export async function workspacesForUser(userId: string): Promise<UserWorkspaceOption[]> {
  const { prisma } = await import("@/lib/prisma");
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspace: { select: { id: true, name: true } } },
    orderBy: { workspace: { name: "asc" } }
  });
  return memberships.map((membership) => membership.workspace);
}

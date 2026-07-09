import { assertPermission } from "@/lib/phase1/auth";
import { resolveUserTelephonyIdentity } from "@/lib/phase1/telephony-identities";
import { getSession, readState } from "@/lib/phase1/store";

export async function GET() {
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "send_direct_outreach");

  const activeUserIds = new Set(
    state.authAccounts
      .filter((account) => account.status === "Active")
      .map((account) => account.userId)
  );
  const managerMembers = state.workspaceMembers.filter(
    (member) =>
      member.workspaceId === session.workspace.id &&
      member.userId !== session.user.id &&
      (member.role === "Manager" || member.role === "Admin") &&
      (!activeUserIds.size || activeUserIds.has(member.userId))
  );
  const targets = managerMembers
    .map((member) => {
      const user = state.users.find((item) => item.id === member.userId);
      if (!user) {
        return undefined;
      }

      const identity = resolveUserTelephonyIdentity(user);
      if (!identity) {
        return undefined;
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
        phoneNumber: identity.phoneNumber,
        label: `${user.name} - ${identity.phoneNumber}`
      };
    })
    .filter((target): target is NonNullable<typeof target> => Boolean(target))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ targets });
}

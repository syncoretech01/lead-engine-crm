import { KeyRound, Link2, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import {
  createUserInviteAction,
  deactivateUserAction,
  updateMemberRoleAction
} from "@/app/auth/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getDeveloperWorkspaceContext } from "@/lib/phase1/store";
import type { WorkspaceRole } from "@/lib/phase1/types";

export const dynamic = "force-dynamic";

type AccessPageProps = {
  searchParams?: Promise<{ invite?: string; invited?: string }>;
};

const roles: WorkspaceRole[] = ["Admin", "Manager", "SDR", "Data Operator", "Viewer", "Compliance Admin"];

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const { state, session, workspaceId } = await getDeveloperWorkspaceContext();
  const params = await searchParams;
  const members = state.workspaceMembers
    .filter((member) => member.workspaceId === workspaceId)
    .map((member) => ({
      ...member,
      user: state.users.find((user) => user.id === member.userId),
      account: state.authAccounts.find((account) => account.userId === member.userId),
      activeSessions: state.authSessions.filter(
        (authSession) =>
          authSession.userId === member.userId &&
          authSession.workspaceId === workspaceId &&
          !authSession.revokedAt &&
          Date.parse(authSession.expiresAt) > Date.now()
      ).length
    }));
  const pendingInvites = state.userInvites.filter(
    (invite) => invite.workspaceId === workspaceId && invite.status === "Pending"
  );

  return (
    <>
      <PageHeader
        kicker="Identity and access"
        title="User access"
        copy="Production auth controls for verified accounts, workspace roles, invite links, active sessions, and deactivation."
        actions={
          params?.invite ? (
            <a className="button secondary" href={params.invite}>
              <Link2 size={17} aria-hidden="true" />
              Open invite
            </a>
          ) : undefined
        }
      />

      {params?.invited && !params?.invite ? (
        <section className="panel">
          <div className="panel-body">
            <p className="surface-note">Invite created and emailed to the user — it&apos;s listed under pending invites below.</p>
          </div>
        </section>
      ) : null}

      {params?.invite ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="section-title">Invite created</h2>
              <p className="section-subtitle">Share this invite path with the new user through your approved secure channel.</p>
            </div>
            <StatusPill label="Pending" tone="warning" />
          </div>
          <div className="panel-body">
            <code className="copy-token">{params.invite}</code>
          </div>
        </section>
      ) : null}

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2 className="section-title">Invite user</h2>
              <p className="section-subtitle">Creates a hashed invite token and assigns a workspace role before first login.</p>
            </div>
            <UserPlus size={20} aria-hidden="true" />
          </div>
          <form action={createUserInviteAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="inviteEmail">Email</label>
              <input id="inviteEmail" name="email" type="email" required />
            </div>
            <div className="field">
              <label htmlFor="inviteRole">Role</label>
              <select id="inviteRole" name="role" defaultValue="SDR">
                {roles.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Create invite
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2 className="section-title">Auth posture</h2>
              <p className="section-subtitle">Signed sessions, secure cookies, hashed passwords, and role-scoped workspace access.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stat-list">
            <div className="mini-stat">
              <span>Active accounts</span>
              <strong>{members.filter((member) => member.account?.status === "Active").length}</strong>
            </div>
            <div className="mini-stat">
              <span>Pending invites</span>
              <strong>{pendingInvites.length}</strong>
            </div>
            <div className="mini-stat">
              <span>Active sessions</span>
              <strong>{members.reduce((total, member) => total + member.activeSessions, 0)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="section-title">Workspace members</h2>
            <p className="section-subtitle">Update roles, inspect verification state, and disable access for departed users.</p>
          </div>
          <KeyRound size={20} aria-hidden="true" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="entity">
                      <strong>{member.user?.name}</strong>
                      <span>{member.user?.email}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill
                      label={member.account?.status ?? "Missing"}
                      tone={member.account?.status === "Active" ? "success" : "warning"}
                    />
                  </td>
                  <td>
                    <form action={updateMemberRoleAction} className="inline-form">
                      <input type="hidden" name="userId" value={member.userId} />
                      <select name="role" defaultValue={member.role} disabled={member.userId === session.user.id}>
                        {roles.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                      <button className="button subtle" type="submit" disabled={member.userId === session.user.id}>
                        Save
                      </button>
                    </form>
                  </td>
                  <td>{member.activeSessions}</td>
                  <td>{member.account?.lastLoginAt ? new Date(member.account.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td>
                    <form action={deactivateUserAction}>
                      <input type="hidden" name="userId" value={member.userId} />
                      <button className="button danger" type="submit" disabled={member.userId === session.user.id || member.account?.status === "Disabled"}>
                        <UserMinus size={16} aria-hidden="true" />
                        Disable
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="section-title">Pending invites</h2>
            <p className="section-subtitle">Invite tokens are stored as hashes and expire automatically.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td>{invite.role}</td>
                  <td><StatusPill label={invite.status} tone="warning" /></td>
                  <td>{new Date(invite.expiresAt).toLocaleString()}</td>
                </tr>
              ))}
              {pendingInvites.length === 0 ? (
                <tr>
                  <td colSpan={4}>No pending invites.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

import { KeyRound, Link2, Phone, ShieldCheck, Trash2, UserMinus, UserPlus } from "lucide-react";
import {
  createUserInviteAction,
  deactivateUserAction,
  removeWorkspaceMemberAction,
  updateMemberRoleAction,
  updateUserTelephonyAction
} from "@/app/auth/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { readFastDevSettingsState } from "@/lib/phase1/dev-dashboard-read-model";
import { getDeveloperWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { WorkspaceRole } from "@/lib/phase1/types";

export const dynamic = "force-dynamic";

type AccessPageProps = {
  searchParams?: Promise<{ invite?: string; invited?: string }>;
};

const roles: WorkspaceRole[] = ["Admin", "Manager", "SDR", "Data Operator", "Viewer", "Compliance Admin"];

export default async function AccessPage({ searchParams }: AccessPageProps) {
  let { session, workspaceId } = await getWorkspaceSessionContext("manage_workspace");
  let state = await readFastDevSettingsState(session, workspaceId);
  if (!state) {
    const context = await getDeveloperWorkspaceContext();
    state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
  }
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
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <form action={deactivateUserAction}>
                        <input type="hidden" name="userId" value={member.userId} />
                        <button className="button danger" type="submit" disabled={member.userId === session.user.id || member.account?.status === "Disabled"}>
                          <UserMinus size={16} aria-hidden="true" />
                          Disable
                        </button>
                      </form>
                      <form action={removeWorkspaceMemberAction}>
                        <input type="hidden" name="userId" value={member.userId} />
                        <button className="button danger" type="submit" disabled={member.userId === session.user.id}>
                          <Trash2 size={16} aria-hidden="true" />
                          Remove
                        </button>
                      </form>
                    </div>
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
            <h2 className="section-title">RingCentral lines</h2>
            <p className="section-subtitle">
              Three fields per SDR (E.164, e.g. +18165551234). <strong>Phone to ring</strong> — the
              SDR&apos;s real cell/desk phone; RingCentral calls it first, they answer, then it
              bridges to the lead (must be a real phone, not a RingCentral DID). <strong>Caller ID</strong>
              — the RingCentral number the lead sees; only applied when you also add that SDR&apos;s JWT.
              <strong>RingCentral JWT</strong> — created by signing into RingCentral as that SDR →
              Credentials → Create JWT; stored encrypted, paste to set or replace (leave blank to keep
              the current one). With a JWT the call is placed as that SDR so their own number shows to
              the lead; without one, calls use the shared company caller ID. Leave the phone blank to
              disable calling. <strong>App Client ID / Client Secret</strong> — only for an SDR whose
              RingCentral number lives in their <em>own</em> RingCentral account (not Syncore&apos;s):
              create a JWT-auth app in that account and paste its Client ID + Secret alongside the JWT,
              so their calls and SMS run through their own account. Leave both blank for SDRs on the
              shared Syncore account.
            </p>
          </div>
          <Phone size={20} aria-hidden="true" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>RingCentral line</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={`tel-${member.id}`}>
                  <td>
                    <div className="entity">
                      <strong>{member.user?.name}</strong>
                      <span>{member.user?.email}</span>
                    </div>
                  </td>
                  <td>
                    <form action={updateUserTelephonyAction} className="inline-form">
                      <input type="hidden" name="userId" value={member.userId} />
                      <input
                        name="phoneNumber"
                        type="tel"
                        placeholder="Phone to ring (cell) +1816…"
                        defaultValue={member.user?.ringCentralPhoneNumber ?? ""}
                        aria-label={`Phone to ring for ${member.user?.name ?? "user"}`}
                      />
                      <input
                        name="callerId"
                        type="tel"
                        placeholder="Caller ID to leads +1816…"
                        defaultValue={member.user?.ringCentralCallerId ?? ""}
                        aria-label={`Caller ID for ${member.user?.name ?? "user"}`}
                      />
                      <input
                        name="jwt"
                        type="password"
                        autoComplete="off"
                        placeholder={member.user?.ringCentralJwt ? "JWT set — paste to replace" : "Paste RingCentral JWT"}
                        aria-label={`RingCentral JWT for ${member.user?.name ?? "user"}`}
                      />
                      <input
                        name="clientId"
                        type="text"
                        autoComplete="off"
                        placeholder="App Client ID (own RC account only)"
                        aria-label={`RingCentral app Client ID for ${member.user?.name ?? "user"}`}
                      />
                      <input
                        name="clientSecret"
                        type="password"
                        autoComplete="off"
                        placeholder="App Client Secret (own RC account only)"
                        aria-label={`RingCentral app Client Secret for ${member.user?.name ?? "user"}`}
                      />
                      <button className="button subtle" type="submit">
                        Save
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

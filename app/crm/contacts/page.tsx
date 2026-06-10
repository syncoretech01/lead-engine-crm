import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, Calendar, Mail, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { contactViewsForWorkspace } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { state, workspaceId } = await getWorkspaceContext("view_all_records");
  const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
  const contacts = await contactViewsForWorkspace(readState, workspaceId);
  const verified = contacts.filter((contact) => contact.grade === "A" || contact.grade === "B").length;
  const suppressed = contacts.filter((contact) => contact.isSuppressed).length;
  const openTasks = readState.tasks.filter((task) => task.workspaceId === workspaceId && task.status !== "Completed").length;

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title="Contacts"
        copy="Contact records carry account context, verification grades, enrichment coverage, tasks, notes, calls, and timeline history."
        actions={
          <>
            <Link href="/crm/accounts" className="button secondary">
              <Building2 size={17} aria-hidden="true" />
              Accounts
            </Link>
            <Link href="/crm/opportunities" className="button primary">
              <ArrowRight size={17} aria-hidden="true" />
              Pipeline
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Contacts</span>
            <Users size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(contacts.length)}</div>
          <span className="metric-note">Golden contacts linked to accounts.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Verified A/B</span>
            <BadgeCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(verified)}</div>
          <span className="metric-note">Ready for controlled SDR execution.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Open tasks</span>
            <Calendar size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(openTasks)}</div>
          <span className="metric-note">Account and contact work items.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Suppressed</span>
            <Mail size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(suppressed)}</div>
          <span className="metric-note">Blocked by compliance rules.</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Contact table</h2>
            <p className="section-subtitle">Verification, owner, segment, task, and account context in one view.</p>
          </div>
          <StatusPill label={`${contacts.length} records`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Account</th>
                <th>Grade</th>
                <th>Score</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Tasks</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <Link href={`/crm/contacts/${contact.id}`} className="entity">
                      <strong>{contact.name}</strong>
                      <span>{contact.title}</span>
                      <span>{contact.email}</span>
                    </Link>
                  </td>
                  <td>
                    <Link href={`/crm/accounts/${contact.companyId}`} className="entity">
                      <strong>{contact.companyName}</strong>
                      <span>{contact.domain}</span>
                    </Link>
                  </td>
                  <td>
                    <span className={`grade ${contact.grade.toLowerCase()}`}>{contact.grade}</span>
                  </td>
                  <td>{contact.score}</td>
                  <td>
                    <StatusPill label={contact.status} tone={statusTone(contact.status)} />
                  </td>
                  <td>{contact.owner}</td>
                  <td>{contact.openTasks}</td>
                  <td>{contact.lastActivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Calendar,
  Mail,
  Phone,
  ShieldCheck,
  Users
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { contactViewsForWorkspace } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

const metricIcons = [Users, BadgeCheck, Phone, Calendar];

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_crm");
  const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
  const contacts = await contactViewsForWorkspace(readState, workspaceId);
  const verified = contacts.filter((contact) => contact.grade === "A" || contact.grade === "B");
  const callReady = contacts.filter((contact) => Boolean(contact.phone) && !contact.isSuppressed);
  const needsAttention = contacts.filter(
    (contact) => contact.isSuppressed || contact.grade === "C" || contact.grade === "D" || contact.openTasks > 0
  );
  const openTasks = readState.tasks.filter((task) => task.workspaceId === workspaceId && task.status !== "Completed").length;
  const priorityContacts = [...contacts]
    .sort((a, b) => b.openTasks - a.openTasks || priorityWeight(a.priority) - priorityWeight(b.priority) || b.score - a.score)
    .slice(0, 8);
  const ownerRows = ownerSummary(contacts).slice(0, 6);

  const metrics = [
    {
      label: "CRM contacts",
      value: contacts.length,
      note: "People linked to account records",
      tone: "info" as const
    },
    {
      label: "Verified A/B",
      value: verified.length,
      note: "Email-ready for controlled outreach",
      tone: "success" as const
    },
    {
      label: "Call-ready",
      value: callReady.length,
      note: "Phone-present contacts not suppressed",
      tone: "info" as const
    },
    {
      label: "Open tasks",
      value: openTasks,
      note: `${formatNumber(needsAttention.length)} contacts need review`,
      tone: openTasks ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title="Contacts"
        copy="A focused people workspace for SDRs and managers: find who to contact, see verification and channel readiness, and keep each person tied to account context."
        actions={
          <>
            <Link href="/crm/accounts" className="button secondary">
              <Building2 size={17} aria-hidden="true" />
              Accounts
            </Link>
            <Link href="/sdr/queue" className="button primary">
              <ArrowRight size={17} aria-hidden="true" />
              SDR queue
            </Link>
          </>
        }
      />

      <section className="grid metrics" aria-label="Contact metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? Users;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Priority contacts</h2>
              <p className="section-subtitle">Contacts with open tasks, high priority, or strong score appear first.</p>
            </div>
            <StatusPill label={`${priorityContacts.length} focus`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Account</th>
                  <th>Grade</th>
                  <th>Status</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {priorityContacts.map((contact) => (
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
                    <td>
                      <StatusPill label={contact.status} tone={statusTone(contact.status)} />
                    </td>
                    <td>{contact.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Channel readiness</h2>
              <p className="section-subtitle">How the contact database breaks down for email, phone, review, and compliance blocks.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            <ReadinessRow label="Email-ready" count={verified.length} total={contacts.length} tone="success" />
            <ReadinessRow label="Call-ready" count={callReady.length} total={contacts.length} tone="info" />
            <ReadinessRow label="Needs review" count={needsAttention.length} total={contacts.length} tone="warning" />
            <ReadinessRow
              label="Suppressed"
              count={contacts.filter((contact) => contact.isSuppressed).length}
              total={contacts.length}
              tone="danger"
            />
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Owner coverage</h2>
              <p className="section-subtitle">Contact load and quality by owner.</p>
            </div>
            <Users size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {ownerRows.map((row) => (
              <div className="list-row" key={row.owner}>
                <div className="row-meta">
                  <strong>{row.owner}</strong>
                  <StatusPill label={`${formatNumber(row.contacts)} contacts`} tone="info" />
                </div>
                <p className="section-subtitle">
                  {formatNumber(row.verified)} verified, {formatNumber(row.tasks)} open tasks, average score {row.averageScore}.
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Contact actions</h2>
              <p className="section-subtitle">Common places SDRs and managers go from the contact list.</p>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
          </div>
          <div className="panel-body grid three">
            <Link href="/sdr/queue" className="item-card compact-profile-card">
              <Calendar size={22} aria-hidden="true" />
              <h3 className="card-title">Queue</h3>
              <p className="section-subtitle">Work first touches and follow-ups.</p>
            </Link>
            <Link href="/outreach/campaigns" className="item-card compact-profile-card">
              <Mail size={22} aria-hidden="true" />
              <h3 className="card-title">Campaigns</h3>
              <p className="section-subtitle">Open sequences and campaign setup.</p>
            </Link>
            <Link href="/crm/accounts" className="item-card compact-profile-card">
              <Building2 size={22} aria-hidden="true" />
              <h3 className="card-title">Accounts</h3>
              <p className="section-subtitle">Review company context.</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Contact directory</h2>
            <p className="section-subtitle">A compact contact table for account context, channel readiness, owner, and activity.</p>
          </div>
          <StatusPill label={`${formatNumber(contacts.length)} contacts`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Account</th>
                <th>Channel</th>
                <th>Score</th>
                <th>Status</th>
                <th>Owner</th>
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
                    <div className="chip-row">
                      <span className={`grade ${contact.grade.toLowerCase()}`}>{contact.grade}</span>
                      {contact.email ? (
                        <span className="pill success">
                          <Mail size={13} aria-hidden="true" />
                          Email
                        </span>
                      ) : null}
                      {contact.phone ? (
                        <span className="pill info">
                          <Phone size={13} aria-hidden="true" />
                          Phone
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>{contact.score}</td>
                  <td>
                    <StatusPill label={contact.status} tone={statusTone(contact.status)} />
                  </td>
                  <td>{contact.owner}</td>
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

type ContactView = Awaited<ReturnType<typeof contactViewsForWorkspace>>[number];

function ReadinessRow({
  label,
  count,
  total,
  tone
}: {
  label: string;
  count: number;
  total: number;
  tone: "success" | "info" | "warning" | "danger";
}) {
  const percent = total ? Math.round((count / total) * 100) : 0;

  return (
    <div className="stage-row">
      <div className="stage-meta">
        <strong>{label}</strong>
        <StatusPill label={`${formatNumber(count)} contacts`} tone={tone} />
      </div>
      <ProgressBar value={percent} />
      <span className="section-subtitle">{percent}% of CRM contacts</span>
    </div>
  );
}

function ownerSummary(contacts: ContactView[]) {
  const rows = new Map<string, { owner: string; contacts: number; verified: number; tasks: number; score: number }>();

  for (const contact of contacts) {
    const existing = rows.get(contact.owner) ?? { owner: contact.owner, contacts: 0, verified: 0, tasks: 0, score: 0 };
    existing.contacts += 1;
    existing.verified += contact.grade === "A" || contact.grade === "B" ? 1 : 0;
    existing.tasks += contact.openTasks;
    existing.score += contact.score;
    rows.set(contact.owner, existing);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      averageScore: row.contacts ? Math.round(row.score / row.contacts) : 0
    }))
    .sort((a, b) => b.tasks - a.tasks || b.verified - a.verified || b.contacts - a.contacts);
}

function priorityWeight(priority: string) {
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  if (priority === "P3") return 3;
  if (priority === "P4") return 4;
  return 5;
}

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
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { readFastCrmContactsModel, type CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { contactViewsForWorkspace, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const sessionContext = await getWorkspaceSessionContext("manage_crm");
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let contacts: ContactView[];
  let openTasks = 0;
  const fastModel = await readFastCrmContactsModel(session, workspaceId);

  if (fastModel) {
    contacts = fastModel.contacts;
    openTasks = fastModel.openTaskCount;
  } else {
    const { state, session: fallbackSession, workspaceId: fallbackWorkspaceId } = await getWorkspaceContext("manage_crm");
    session = fallbackSession;
    workspaceId = fallbackWorkspaceId;
    const ownedScope = restrictsToOwnedRecords(session) ? ownedCrmRecordScope(state, session) : null;
    const allContacts = await contactViewsForWorkspace(state, workspaceId);
    contacts = ownedScope ? allContacts.filter((contact) => ownedScope.contactIds.has(contact.id)) : allContacts;
    openTasks = state.tasks.filter((task) => task.workspaceId === workspaceId && task.status !== "Completed").length;
  }
  const isSdr = session.role === "SDR";
  const verified = contacts.filter((contact) => contact.grade === "A" || contact.grade === "B");
  const emailAvailable = contacts.filter((contact) => contactEmailAvailable(contact));
  const callReady = contacts.filter((contact) => Boolean(contact.phone) && !contact.isSuppressed);
  const needsAttention = contacts.filter(
    (contact) => contact.isSuppressed || contact.grade === "C" || contact.grade === "D" || contact.openTasks > 0
  );
  const priorityContacts = [...contacts]
    .sort((a, b) => b.openTasks - a.openTasks || priorityWeight(a.priority) - priorityWeight(b.priority) || b.score - a.score)
    .slice(0, 8);
  const ownerRows = ownerSummary(contacts).slice(0, 6);

  const metrics = [
    {
      label: isSdr ? "My contacts" : "CRM contacts",
      value: formatNumber(contacts.length),
      note: isSdr ? "Assigned people in scope" : "People linked to account records",
      icon: Users,
      tone: "info" as const
    },
    {
      label: isSdr ? "Email available" : "Verified A/B",
      value: formatNumber(isSdr ? emailAvailable.length : verified.length),
      note: isSdr ? "Contacts you can email now" : "Email-ready for controlled outreach",
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Call-ready",
      value: formatNumber(callReady.length),
      note: "Phone-present contacts not suppressed",
      icon: Phone,
      tone: "info" as const
    },
    {
      label: isSdr ? "Needs action" : "Open tasks",
      value: formatNumber(openTasks),
      note: `${formatNumber(needsAttention.length)} contacts need review`,
      icon: Calendar,
      tone: openTasks ? "warning" as const : "success" as const
    }
  ];

  const lanes = [
    {
      label: isSdr ? "Email available" : "Email-ready",
      value: isSdr ? emailAvailable.length : verified.length,
      note: isSdr ? "Not suppressed" : "A/B grade contacts",
      icon: Mail,
      tone: "success" as const
    },
    {
      label: "Call-ready",
      value: callReady.length,
      note: "Phone present",
      icon: Phone,
      tone: "info" as const
    },
    {
      label: "Needs review",
      value: needsAttention.length,
      note: "Tasks or quality flags",
      icon: ShieldCheck,
      tone: needsAttention.length ? "warning" as const : "success" as const
    },
    {
      label: isSdr ? "Queued focus" : "Owners",
      value: isSdr ? priorityContacts.length : ownerRows.length,
      note: isSdr ? "Visible next contacts" : "Active contact owners",
      icon: Users,
      tone: "info" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title={isSdr ? "My contacts" : "Contacts"}
        copy={
          isSdr
            ? "Assigned people with account context, channel readiness, and the next practical action."
            : "A focused people workspace for SDRs and managers: find who to contact, see verification and channel readiness, and keep each person tied to account context."
        }
        actions={
          <>
            <Link href="/crm/accounts" className="button secondary">
              <Building2 size={17} aria-hidden="true" />
              Accounts
            </Link>
            <Link href="/sdr/queue" className="button primary">
              <ArrowRight size={17} aria-hidden="true" />
              {isSdr ? "My queue" : "SDR queue"}
            </Link>
          </>
        }
      />

      <section className="stat-grid" aria-label="Contact metrics">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="Contact readiness lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">{isSdr ? "Next contacts" : "Priority contacts"}</h2>
              <p className="section-subtitle">
                {isSdr
                  ? "Start with active tasks, priority records, then contacts with a reachable channel."
                  : "Contacts with open tasks, high priority, or strong score appear first."}
              </p>
            </div>
            <StatusPill label={`${priorityContacts.length} focus`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Account</th>
                  <th>{isSdr ? "Priority" : "Grade"}</th>
                  <th>{isSdr ? "Next action" : "Status"}</th>
                  {!isSdr ? <th>Owner</th> : null}
                </tr>
              </thead>
              <tbody>
                {priorityContacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <Link href={`/crm/contacts/${contact.id}`} className="entity">
                        <strong>{contactDisplayName(contact)}</strong>
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
                      {isSdr ? (
                        <StatusPill label={contact.priority} tone={statusTone(contact.priority)} />
                      ) : (
                        <span className={`grade ${contact.grade.toLowerCase()}`}>{contact.grade}</span>
                      )}
                    </td>
                    <td>
                      {isSdr ? (
                        <StatusPill
                          label={contactNextAction(contact).label}
                          tone={contactNextAction(contact).tone}
                        />
                      ) : (
                        <StatusPill label={contact.status} tone={statusTone(contact.status)} />
                      )}
                    </td>
                    {!isSdr ? <td>{contact.owner}</td> : null}
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
        {isSdr ? (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Work focus</h2>
                <p className="section-subtitle">Queue items, account context, and reachable contacts stay in one path.</p>
              </div>
              <Calendar size={20} aria-hidden="true" />
            </div>
            <div className="panel-body stage-list">
              <div className="list-row">
                <div className="row-meta">
                  <strong>My queue</strong>
                  <StatusPill label={`${formatNumber(priorityContacts.length)} visible`} tone="info" />
                </div>
                <p className="section-subtitle">First touches, follow-ups, and bulk email start there.</p>
              </div>
              <div className="list-row">
                <div className="row-meta">
                  <strong>Reachable contacts</strong>
                  <StatusPill label={`${formatNumber(emailAvailable.length + callReady.length)} channels`} tone="success" />
                </div>
                <p className="section-subtitle">Email and phone availability are visible before opening a record.</p>
              </div>
              <div className="list-row">
                <div className="row-meta">
                  <strong>Account context</strong>
                  <StatusPill label={`${formatNumber(new Set(contacts.map((contact) => contact.companyId)).size)} accounts`} tone="info" />
                </div>
                <p className="section-subtitle">Open an account when company context matters for the message.</p>
              </div>
            </div>
          </div>
        ) : (
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
        )}

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Contact actions</h2>
              <p className="section-subtitle">
                {isSdr ? "The SDR path stays focused on active work and account context." : "Common places SDRs and managers go from the contact list."}
              </p>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
          </div>
          <div className={`panel-body grid ${isSdr ? "two" : "three"}`}>
            <Link href="/sdr/queue" className="item-card compact-profile-card">
              <Calendar size={22} aria-hidden="true" />
              <h3 className="card-title">{isSdr ? "My queue" : "Queue"}</h3>
              <p className="section-subtitle">Work first touches and follow-ups.</p>
            </Link>
            {!isSdr ? (
              <Link href="/outreach/campaigns" className="item-card compact-profile-card">
                <Mail size={22} aria-hidden="true" />
                <h3 className="card-title">Campaigns</h3>
                <p className="section-subtitle">Open sequences and campaign setup.</p>
              </Link>
            ) : null}
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
            <p className="section-subtitle">
              {isSdr
                ? "Assigned people with channel readiness and the next recommended action."
                : "A compact contact table for account context, channel readiness, owner, and activity."}
            </p>
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
                <th>{isSdr ? "Next action" : "Status"}</th>
                {!isSdr ? <th>Owner</th> : null}
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <Link href={`/crm/contacts/${contact.id}`} className="entity">
                      <strong>{contactDisplayName(contact)}</strong>
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
                    {isSdr ? (
                      <StatusPill label={contactNextAction(contact).label} tone={contactNextAction(contact).tone} />
                    ) : (
                      <StatusPill label={contact.status} tone={statusTone(contact.status)} />
                    )}
                  </td>
                  {!isSdr ? <td>{contact.owner}</td> : null}
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

type ContactView = CrmContactListRow;

function contactDisplayName(contact: Pick<ContactView, "name" | "email">) {
  const name = contact.name?.trim();

  if (name && name.toLowerCase() !== "unknown contact") {
    return name;
  }

  const localPart = contact.email?.split("@")[0]?.trim();

  if (!localPart) {
    return "Unknown contact";
  }

  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contactEmailAvailable(contact: Pick<ContactView, "email" | "isSuppressed">) {
  return Boolean(contact.email && !contact.isSuppressed);
}

function contactNextAction(contact: ContactView): { label: string; tone: "success" | "info" | "warning" | "danger" } {
  if (contact.isSuppressed || contact.grade === "S") {
    return { label: "Suppressed", tone: "danger" };
  }

  if (contact.openTasks > 0) {
    return { label: "Work task", tone: "warning" };
  }

  if (contactEmailAvailable(contact)) {
    return { label: "Email", tone: "success" };
  }

  if (contact.phone) {
    return { label: "Call", tone: "info" };
  }

  return { label: "Review", tone: "warning" };
}


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

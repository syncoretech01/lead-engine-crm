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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MeterBar } from "@/components/ui/meter-bar";
import { Panel } from "@/components/ui/panel";
import { StatCard, ToneIcon } from "@/components/ui/stat-card";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { readFastCrmContactsModel, type CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import { contactViewsForWorkspace, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

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
  const suppressed = contacts.filter((contact) => contact.isSuppressed);

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
            <Button asChild variant="outline">
              <Link href="/crm/accounts">
                <Building2 aria-hidden="true" />
                Accounts
              </Link>
            </Button>
            <Button asChild>
              <Link href="/sdr/queue">
                <ArrowRight aria-hidden="true" />
                {isSdr ? "My queue" : "SDR queue"}
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Contact metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard
            key={metric.label}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
            note={metric.note}
            tone={metric.tone}
          />
        ))}
      </section>

      <section aria-label="Contact lanes" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {lanes.map((lane) => (
          <div key={lane.label} className="bg-card flex items-center gap-3 rounded-xl border p-4 shadow-sm">
            <ToneIcon icon={lane.icon} tone={lane.tone} />
            <div className="min-w-0">
              <div className="text-lg font-semibold text-foreground">{formatNumber(lane.value)}</div>
              <div className="truncate text-xs text-muted-foreground">
                {lane.label} · {lane.note}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[7fr_5fr]">
        <Panel
          title={isSdr ? "Next contacts" : "Priority contacts"}
          subtitle={
            isSdr
              ? "Start with active tasks, priority records, then contacts with a reachable channel."
              : "Contacts with open tasks, high priority, or strong score appear first."
          }
          action={<StatusBadge label={`${priorityContacts.length} focus`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>{isSdr ? "Priority" : "Grade"}</TableHead>
                <TableHead>{isSdr ? "Next action" : "Status"}</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {priorityContacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Link href={`/crm/contacts/${contact.id}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{contactDisplayName(contact)}</span>
                      <span className="text-xs text-muted-foreground">{contact.title}</span>
                      <span className="text-xs text-muted-foreground">{contact.email}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/crm/accounts/${contact.companyId}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{contact.companyName}</span>
                      <span className="text-xs text-muted-foreground">{contact.domain}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {isSdr ? (
                      <StatusBadge label={contact.priority} />
                    ) : (
                      <StatusBadge label={contact.grade} tone={gradeTone(contact.grade)} />
                    )}
                  </TableCell>
                  <TableCell>
                    {isSdr ? (
                      <StatusBadge label={contactNextAction(contact).label} tone={contactNextAction(contact).tone} />
                    ) : (
                      <StatusBadge label={contact.status} />
                    )}
                  </TableCell>
                  {!isSdr ? <TableCell className="text-muted-foreground">{contact.owner}</TableCell> : null}
                </TableRow>
              ))}
              {priorityContacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSdr ? 4 : 5} className="text-muted-foreground">
                    No contacts to prioritize right now.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Channel readiness"
          subtitle="How the contact database breaks down for email, phone, review, and compliance blocks."
          action={<ToneIcon icon={ShieldCheck} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            <ReadinessRow
              label={isSdr ? "Email available" : "Email-ready"}
              count={isSdr ? emailAvailable.length : verified.length}
              total={contacts.length}
              tone="success"
            />
            <ReadinessRow label="Call-ready" count={callReady.length} total={contacts.length} tone="info" />
            <ReadinessRow label="Needs review" count={needsAttention.length} total={contacts.length} tone="warning" />
            <ReadinessRow label="Suppressed" count={suppressed.length} total={contacts.length} tone="danger" />
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[7fr_5fr]">
        {isSdr ? (
          <Panel
            title="Work focus"
            subtitle="Queue items, account context, and reachable contacts stay in one path."
            action={<ToneIcon icon={Calendar} tone="info" />}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 border-b pb-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">My queue</span>
                  <StatusBadge label={`${formatNumber(priorityContacts.length)} visible`} tone="info" />
                </div>
                <p className="text-xs text-muted-foreground">First touches, follow-ups, and bulk email start there.</p>
              </div>
              <div className="flex flex-col gap-1.5 border-b pb-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">Reachable contacts</span>
                  <StatusBadge label={`${formatNumber(emailAvailable.length + callReady.length)} channels`} tone="success" />
                </div>
                <p className="text-xs text-muted-foreground">Email and phone availability are visible before opening a record.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">Account context</span>
                  <StatusBadge label={`${formatNumber(new Set(contacts.map((contact) => contact.companyId)).size)} accounts`} tone="info" />
                </div>
                <p className="text-xs text-muted-foreground">Open an account when company context matters for the message.</p>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel
            title="Owner coverage"
            subtitle="Contact load and quality by owner."
            action={<ToneIcon icon={Users} tone="info" />}
          >
            <div className="flex flex-col gap-4">
              {ownerRows.map((row) => (
                <div key={row.owner} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{row.owner}</span>
                    <StatusBadge label={`${formatNumber(row.contacts)} contacts`} tone="info" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(row.verified)} verified, {formatNumber(row.tasks)} open tasks, average score {row.averageScore}.
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel
          title="Contact actions"
          subtitle={
            isSdr
              ? "The SDR path stays focused on active work and account context."
              : "Common places SDRs and managers go from the contact list."
          }
          action={<ToneIcon icon={ArrowRight} tone="info" />}
        >
          <div className={`grid grid-cols-1 gap-4 ${isSdr ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            <Link
              href="/sdr/queue"
              className="group bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
            >
              <ToneIcon icon={Calendar} tone="info" />
              <h3 className="text-sm font-semibold text-foreground">{isSdr ? "My queue" : "Queue"}</h3>
              <p className="text-xs text-muted-foreground">Work first touches and follow-ups.</p>
            </Link>
            {!isSdr ? (
              <Link
                href="/outreach/campaigns"
                className="group bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
              >
                <ToneIcon icon={Mail} tone="info" />
                <h3 className="text-sm font-semibold text-foreground">Campaigns</h3>
                <p className="text-xs text-muted-foreground">Open sequences and campaign setup.</p>
              </Link>
            ) : null}
            <Link
              href="/crm/accounts"
              className="group bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
            >
              <ToneIcon icon={Building2} tone="info" />
              <h3 className="text-sm font-semibold text-foreground">Accounts</h3>
              <p className="text-xs text-muted-foreground">Review company context.</p>
            </Link>
          </div>
        </Panel>
      </section>

      <section aria-label="Contact directory">
        <Panel
          title="Contact directory"
          subtitle={
            isSdr
              ? "Assigned people with channel readiness and the next recommended action."
              : "A compact contact table for account context, channel readiness, owner, and activity."
          }
          action={<StatusBadge label={`${formatNumber(contacts.length)} contacts`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>{isSdr ? "Next action" : "Status"}</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Link href={`/crm/contacts/${contact.id}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{contactDisplayName(contact)}</span>
                      <span className="text-xs text-muted-foreground">{contact.title}</span>
                      <span className="text-xs text-muted-foreground">{contact.email}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/crm/accounts/${contact.companyId}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{contact.companyName}</span>
                      <span className="text-xs text-muted-foreground">{contact.domain}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge label={contact.grade} tone={gradeTone(contact.grade)} />
                      {contact.email ? <StatusBadge label="Email" tone="success" /> : null}
                      {contact.phone ? <StatusBadge label="Phone" tone="info" /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contact.score}</TableCell>
                  <TableCell>
                    {isSdr ? (
                      <StatusBadge label={contactNextAction(contact).label} tone={contactNextAction(contact).tone} />
                    ) : (
                      <StatusBadge label={contact.status} />
                    )}
                  </TableCell>
                  {!isSdr ? <TableCell className="text-muted-foreground">{contact.owner}</TableCell> : null}
                  <TableCell className="text-muted-foreground">{contact.lastActivity}</TableCell>
                </TableRow>
              ))}
              {contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSdr ? 6 : 7} className="text-muted-foreground">
                    No contacts in scope yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
      </section>
    </>
  );
}

type ContactView = CrmContactListRow;

function contactDisplayName(contact: Pick<ContactView, "name" | "email">) {
  return displayContactName(contact);
}

function contactEmailAvailable(contact: Pick<ContactView, "email" | "isSuppressed">) {
  return Boolean(contact.email && !contact.isSuppressed);
}

function gradeTone(grade: string): BadgeTone {
  const normalized = grade.toUpperCase();
  if (normalized === "A" || normalized === "B") return "success";
  if (normalized === "C" || normalized === "D") return "warning";
  if (normalized === "S") return "danger";
  return "default";
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">{label}</span>
        <StatusBadge label={`${formatNumber(count)} contacts`} tone={tone} />
      </div>
      <MeterBar value={percent} />
      <span className="text-xs text-muted-foreground">{percent}% of CRM contacts</span>
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

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Calendar, Mail } from "lucide-react";

import { CoPill, type CoTone } from "@/components/crm/cockpit/co-table";
import { priorityTone, statusTone } from "@/components/crm/cockpit/focus/focus-types";
import { readFastCrmContactsModel, type CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";
import { hasPermission, restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { readWorkspaceSdrRoster, type SdrRosterEntry } from "@/lib/phase1/sdr-roster-read-model";
import { assignedContactsSnapshot, sdrUsers } from "@/lib/phase1/sdr";
import { readAssignedContactsModel } from "@/lib/phase1/assigned-contacts-read-model";
import {
  resolveUserTelephonyIdentity,
  telephonyIdentityBlockReason
} from "@/lib/phase1/telephony-identities";
import { contactViewsForWorkspace, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";
import { ContactsTable } from "@/components/crm/contacts-table";
import {
  buildPeekAssignment,
  contactDisplayName,
  contactEmailAvailable,
  contactNextAction,
  priorityWeight,
  type PeekAssignment
} from "@/lib/crm-contact-presentation";

export const dynamic = "force-dynamic";

type ContactView = CrmContactListRow;

// The Contacts records page in the cockpit idiom (matches My Day / the contact &
// account records): a light `.cockpit` surface with a header, counter strip, the
// comprehensive directory table, and cockpit insight cards — no legacy TileGrid.
export default async function ContactsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const sessionContext = await getWorkspaceSessionContext("manage_crm");
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let contacts: ContactView[];
  let openTasks = 0;
  let totalContacts = 0;
  let roster: SdrRosterEntry[] = [];
  // SDR-assignment fields (SLA / assigned-ago / last touch) keyed by contact id,
  // so the peek matches the My Contacts peek for contacts that are assigned.
  const assignments: Record<string, PeekAssignment> = {};
  const fastModel = await readFastCrmContactsModel(session, workspaceId);

  if (fastModel) {
    contacts = fastModel.contacts;
    openTasks = fastModel.openTaskCount;
    totalContacts = fastModel.totalContacts;
    roster = (await readWorkspaceSdrRoster(workspaceId)) ?? [];
    const assigned = await readAssignedContactsModel(session, workspaceId, {});
    for (const row of assigned?.rows ?? []) {
      assignments[row.contactId] = buildPeekAssignment(row);
    }
  } else {
    const { state, session: fallbackSession, workspaceId: fallbackWorkspaceId } = await getWorkspaceContext("manage_crm");
    session = fallbackSession;
    workspaceId = fallbackWorkspaceId;
    const ownedScope = restrictsToOwnedRecords(session) ? ownedCrmRecordScope(state, session) : null;
    const allContacts = await contactViewsForWorkspace(state, workspaceId);
    contacts = ownedScope ? allContacts.filter((contact) => ownedScope.contactIds.has(contact.id)) : allContacts;
    totalContacts = contacts.length;
    openTasks = state.tasks.filter((task) => task.workspaceId === workspaceId && task.status !== "Completed").length;
    roster = sdrUsers(state, workspaceId).map((user) => ({ id: user.id, name: user.name }));
    for (const row of assignedContactsSnapshot(state, workspaceId)) {
      assignments[row.contactId] = buildPeekAssignment(row);
    }
  }

  const isSdr = session.role === "SDR";
  const canManageBulk = hasPermission(session, "manage_sdr_team");

  // Caller line for the peek's in-line dialer: the current user's own RC number.
  const callerIdentity = resolveUserTelephonyIdentity(session.user);
  const callerLabel = callerIdentity ? `${callerIdentity.displayName} · ${callerIdentity.phoneNumber}` : undefined;
  const callBlockReason = callerIdentity ? undefined : telephonyIdentityBlockReason(session.user);

  const verified = contacts.filter((contact) => contact.grade === "A" || contact.grade === "B");
  const emailAvailable = contacts.filter((contact) => contactEmailAvailable(contact));
  const callReady = contacts.filter((contact) => Boolean(contact.phone) && !contact.isSuppressed);
  const needsAttention = contacts.filter(
    (contact) => contact.isSuppressed || contact.grade === "C" || contact.grade === "D" || contact.openTasks > 0
  );
  const suppressed = contacts.filter((contact) => contact.isSuppressed);
  const priorityContacts = [...contacts]
    .sort((a, b) => b.openTasks - a.openTasks || priorityWeight(a.priority) - priorityWeight(b.priority) || b.score - a.score)
    .slice(0, 8);
  const ownerRows = ownerSummary(contacts).slice(0, 6);
  const accountCount = new Set(contacts.map((contact) => contact.companyId)).size;

  const counters: Array<{ tone: CounterTone; label: string; value: number }> = [
    { tone: "blue", label: isSdr ? "My contacts" : "Total contacts", value: isSdr ? contacts.length : totalContacts },
    { tone: "teal", label: isSdr ? "Email available" : "Verified A/B", value: isSdr ? emailAvailable.length : verified.length },
    { tone: "blue", label: "Call-ready", value: callReady.length },
    { tone: needsAttention.length ? "amber" : "teal", label: isSdr ? "Needs review" : "Open tasks", value: isSdr ? needsAttention.length : openTasks }
  ];

  return (
    <div className="cockpit min-h-full bg-co-page">
      <div className="mx-auto w-full max-w-[1280px] px-6 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-co-blue">CRM · Records</div>
            <h1 className="mt-0.5 text-[22px] font-extrabold text-co-ink">Contacts</h1>
            <p className="mt-0.5 max-w-[660px] text-[12.5px] text-co-text-3">
              {isSdr
                ? "Your contacts with account context, channel readiness, and the next practical action. Click a contact to open its record."
                : "Every contact in the workspace — assigned or unassigned. Search, sort, and filter the full directory; click a contact to open its record."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/crm/accounts"
              className="flex h-[38px] items-center gap-2 rounded-[9px] border border-co-control bg-white px-4 text-[13px] font-bold text-co-text-3 transition-colors hover:bg-co-sunken"
            >
              <Building2 className="size-4" aria-hidden="true" />
              Accounts
            </Link>
            <Link
              href="/sdr/queue"
              className="flex h-[38px] items-center gap-2 rounded-[9px] bg-co-blue px-4 text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover"
            >
              <ArrowRight className="size-4" aria-hidden="true" />
              {isSdr ? "My queue" : "SDR queue"}
            </Link>
          </div>
        </div>

        {/* Counter strip */}
        <div className="mt-4 grid grid-cols-2 divide-y divide-co-divider rounded-[10px] border border-co-border bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {counters.map((counter) => (
            <Counter key={counter.label} tone={counter.tone} label={counter.label} value={counter.value} />
          ))}
        </div>

        {/* Contact directory */}
        <section className="mt-5 overflow-hidden rounded-[10px] border border-co-border bg-white">
          <div className="flex items-start justify-between gap-3 border-b border-co-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-extrabold text-co-ink">Contact directory</h2>
              <p className="mt-0.5 text-[11.5px] text-co-text-3">
                {isSdr
                  ? "Assigned people with channel readiness and the next recommended action. Search, sort, and page through your book."
                  : "Search, sort, and page the full contact book — account context, channel readiness, owner, and activity in one table."}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-co-sunken px-2.5 py-1 text-[11px] font-bold text-co-text-3 ring-1 ring-inset ring-co-border">
              {formatNumber(contacts.length)} contacts
            </span>
          </div>
          <ContactsTable
            rows={contacts}
            isSdr={isSdr}
            canManage={canManageBulk}
            roster={roster}
            callerLabel={callerLabel}
            callBlockReason={callBlockReason}
            assignments={assignments}
            initialQuery={sp.q}
            initialSort={sp.sort}
            initialPage={sp.page ? Math.max(0, Number(sp.page) - 1) : 0}
          />
        </section>

        {/* Insights */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <CockpitCard
            title={isSdr ? "Next contacts" : "Priority contacts"}
            subtitle={
              isSdr
                ? "Start with active tasks, priority records, then contacts with a reachable channel."
                : "Contacts with open tasks, high priority, or strong score appear first."
            }
            badge={<CoPill tone="info">{priorityContacts.length} focus</CoPill>}
          >
            {priorityContacts.length ? (
              <div>
                {priorityContacts.map((contact) => (
                  <Link
                    key={contact.id}
                    href={`/crm/contacts/${contact.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-co-divider py-2.5 last:border-0 hover:bg-[#f6faff]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-bold text-co-ink">{contactDisplayName(contact)}</span>
                      <span className="block truncate text-[11px] text-co-muted-2">
                        {[contact.companyName, contact.domain].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CoPill tone={priorityTone(contact.priority)}>{contact.priority}</CoPill>
                      {isSdr ? (
                        <CoPill tone="info">{contactNextAction(contact).label}</CoPill>
                      ) : (
                        <CoPill tone={gradeToCoTone(contact.grade)}>{contact.grade}</CoPill>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-[12px] text-co-muted-2">No contacts to prioritize right now.</p>
            )}
          </CockpitCard>

          <CockpitCard
            title="Channel readiness"
            subtitle="How the contact database breaks down for email, phone, review, and compliance blocks."
          >
            <div className="flex flex-col gap-3.5">
              <ReadinessBar
                label={isSdr ? "Email available" : "Email-ready"}
                count={isSdr ? emailAvailable.length : verified.length}
                total={contacts.length}
                tone="teal"
              />
              <ReadinessBar label="Call-ready" count={callReady.length} total={contacts.length} tone="blue" />
              <ReadinessBar label="Needs review" count={needsAttention.length} total={contacts.length} tone="amber" />
              <ReadinessBar label="Suppressed" count={suppressed.length} total={contacts.length} tone="red" />
            </div>
          </CockpitCard>
        </div>

        {/* Work focus + actions */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {isSdr ? (
            <CockpitCard title="Work focus" subtitle="Queue items, account context, and reachable contacts stay in one path.">
              <div className="flex flex-col gap-3">
                <FocusRow
                  title="My queue"
                  badge={`${formatNumber(priorityContacts.length)} visible`}
                  tone="info"
                  desc="First touches, follow-ups, and bulk email start there."
                />
                <FocusRow
                  title="Reachable contacts"
                  badge={`${formatNumber(emailAvailable.length + callReady.length)} channels`}
                  tone="teal"
                  desc="Email and phone availability are visible before opening a record."
                />
                <FocusRow
                  title="Account context"
                  badge={`${formatNumber(accountCount)} accounts`}
                  tone="info"
                  desc="Open an account when company context matters for the message."
                />
              </div>
            </CockpitCard>
          ) : (
            <CockpitCard title="Owner coverage" subtitle="Contact load and quality by owner.">
              <div className="flex flex-col gap-3">
                {ownerRows.map((row) => (
                  <FocusRow
                    key={row.owner}
                    title={row.owner}
                    badge={`${formatNumber(row.contacts)} contacts`}
                    tone="info"
                    desc={`${formatNumber(row.verified)} verified · ${formatNumber(row.tasks)} open tasks · avg score ${row.averageScore}`}
                  />
                ))}
                {ownerRows.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-co-muted-2">No owners to summarize.</p>
                ) : null}
              </div>
            </CockpitCard>
          )}

          <CockpitCard
            title="Contact actions"
            subtitle={
              isSdr
                ? "The SDR path stays focused on active work and account context."
                : "Common places SDRs and managers go from the contact list."
            }
          >
            <div className={`grid gap-3 ${isSdr ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
              <QuickLink href="/sdr/queue" icon={Calendar} title={isSdr ? "My queue" : "Queue"} desc="Work first touches and follow-ups." />
              {!isSdr ? <QuickLink href="/outreach/campaigns" icon={Mail} title="Campaigns" desc="Open sequences and campaign setup." /> : null}
              <QuickLink href="/crm/accounts" icon={Building2} title="Accounts" desc="Review company context." />
            </div>
          </CockpitCard>
        </div>
      </div>
    </div>
  );
}

type CounterTone = "blue" | "teal" | "amber" | "red";

const dotTone: Record<CounterTone, string> = {
  blue: "bg-co-blue",
  teal: "bg-co-teal",
  amber: "bg-co-amber-dot",
  red: "bg-co-red"
};

function Counter({ tone, label, value }: { tone: CounterTone; label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className={`size-2 rounded-full ${dotTone[tone]}`} aria-hidden="true" />
        <span className="text-[11px] font-bold text-co-text-3">{label}</span>
      </div>
      <span className="text-[22px] font-extrabold tabular-nums text-co-ink">{formatNumber(value)}</span>
    </div>
  );
}

function CockpitCard({
  title,
  subtitle,
  badge,
  children
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-co-border bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-co-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-extrabold text-co-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[11.5px] text-co-text-3">{subtitle}</p> : null}
        </div>
        {badge ? <span className="shrink-0">{badge}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ReadinessBar({
  label,
  count,
  total,
  tone
}: {
  label: string;
  count: number;
  total: number;
  tone: CounterTone;
}) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-bold text-co-ink">{label}</span>
        <span className="text-[11px] font-bold text-co-text-3">{formatNumber(count)} contacts</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-co-sunken-2">
        <div className={`h-full rounded-full ${dotTone[tone]}`} style={{ width: `${percent}%` }} aria-hidden="true" />
      </div>
      <span className="mt-1 block text-[10.5px] text-co-muted-2">{percent}% of CRM contacts</span>
    </div>
  );
}

function FocusRow({ title, badge, tone, desc }: { title: string; badge: string; tone: CoTone; desc: string }) {
  return (
    <div className="border-b border-co-divider pb-3 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-bold text-co-ink">{title}</span>
        <CoPill tone={tone}>{badge}</CoPill>
      </div>
      <p className="mt-0.5 text-[11.5px] text-co-text-3">{desc}</p>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  desc
}: {
  href: string;
  icon: typeof Building2;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-[10px] border border-co-border bg-co-sunken p-3.5 transition-colors hover:border-co-blue hover:bg-[#f6faff]"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-[#eaf3ff] text-co-blue">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="text-[12.5px] font-bold text-co-ink">{title}</span>
      <span className="text-[11px] text-co-text-3">{desc}</span>
    </Link>
  );
}

function gradeToCoTone(grade: string): CoTone {
  if (grade === "A" || grade === "B") return "teal";
  if (grade === "C") return "amber";
  if (grade === "D" || grade === "S") return "red";
  return "neutral";
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

import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";

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
import { buildPeekAssignment, contactEmailAvailable, type PeekAssignment } from "@/lib/crm-contact-presentation";

export const dynamic = "force-dynamic";

type ContactView = CrmContactListRow;

// The Contacts records page in the cockpit idiom (matches My Day / the contact &
// account records): a light `.cockpit` surface with a header, a compact counter
// strip, and the comprehensive directory table. The page fits the viewport width
// (`min-w-0` lets the wide table scroll horizontally inside its own card rather
// than pushing the page past 100% zoom).
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
  let truncated = false;
  // Tracked apart from `truncated` because the two mean different things to the
  // reader: the contact list being cut short hides whole rows, whereas the
  // assignment fetch being cut short leaves the rows present but strips the
  // assigned-ago / last-touch detail out of their peek. Saying "older contacts
  // are not listed" for the second case would be wrong.
  let assignmentsTruncated = false;
  let roster: SdrRosterEntry[] = [];
  // SDR-assignment fields (assigned-ago / last touch) keyed by contact id,
  // so the peek matches the My Contacts peek for contacts that are assigned.
  const assignments: Record<string, PeekAssignment> = {};
  const fastModel = await readFastCrmContactsModel(session, workspaceId);

  if (fastModel) {
    contacts = fastModel.contacts;
    openTasks = fastModel.openTaskCount;
    totalContacts = fastModel.totalContacts;
    truncated = fastModel.truncated;
    roster = (await readWorkspaceSdrRoster(workspaceId)) ?? [];
    const assigned = await readAssignedContactsModel(session, workspaceId, {});
    assignmentsTruncated = assigned?.truncated ?? false;
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

  const counters: Array<{ tone: CounterTone; label: string; value: number }> = [
    { tone: "blue", label: isSdr ? "My contacts" : "Total contacts", value: isSdr ? contacts.length : totalContacts },
    { tone: "teal", label: isSdr ? "Email available" : "Verified A/B", value: isSdr ? emailAvailable.length : verified.length },
    { tone: "blue", label: "Call-ready", value: callReady.length },
    { tone: needsAttention.length ? "amber" : "teal", label: isSdr ? "Needs review" : "Open tasks", value: isSdr ? needsAttention.length : openTasks }
  ];

  return (
    <div className="cockpit min-h-full min-w-0 bg-co-page">
      <div className="mx-auto w-full min-w-0 max-w-[1280px] px-6 py-6">
        {truncated || assignmentsTruncated ? (
          <div
            role="status"
            className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            {truncated ? (
              <>
                <strong>Showing the {formatNumber(contacts.length)} most recent contacts</strong> of{" "}
                {formatNumber(totalContacts)}. Older contacts are not listed here — search and filters only
                apply to the contacts shown. Narrow the list from a saved view, or open a contact directly.
              </>
            ) : null}
            {assignmentsTruncated ? (
              <>
                {truncated ? " Assignment details are also incomplete" : "Assignment details are incomplete"} —
                the oldest assignments are not loaded, so some contacts show no owner or last touch in their
                preview.
              </>
            ) : null}
          </div>
        ) : null}
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-co-blue">CRM · Records</div>
            <h1 className="mt-0.5 text-[22px] font-extrabold text-co-ink">Contacts</h1>
            <p className="mt-0.5 max-w-[660px] text-[12.5px] text-co-text-3">
              {isSdr
                ? "Your contacts with account context, channel readiness, and the next practical action. Click a contact to open its record."
                : "Every contact in the workspace — assigned or unassigned. Search, sort, and filter the full directory; click a contact to open its record."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/crm/accounts"
              className="flex h-[38px] items-center gap-2 rounded-[9px] border border-co-control bg-co-surface px-4 text-[13px] font-bold text-co-text-3 transition-colors hover:bg-co-sunken"
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
        <div className="mt-4 grid grid-cols-2 divide-y divide-co-divider rounded-[10px] border border-co-border bg-co-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {counters.map((counter) => (
            <Counter key={counter.label} tone={counter.tone} label={counter.label} value={counter.value} />
          ))}
        </div>

        {/* Contact directory — the wide table scrolls horizontally inside this card. */}
        <section className="mt-5 min-w-0 overflow-hidden rounded-[10px] border border-co-border bg-co-surface">
          <div className="flex items-start justify-between gap-3 border-b border-co-border px-4 py-3">
            <div className="min-w-0">
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

import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import type { FollowUpOrigin, Session } from "@/lib/phase1/types";

/**
 * One open follow-up, flattened with just enough contact/account context to be
 * grouped by contact. Both the prisma fast path and the file-store fallback
 * build these, so `groupFollowUpsByContact` is the one grouping implementation.
 */
export type FollowUpSourceRow = {
  id: string;
  contactId: string;
  companyId: string;
  ownerUserId: string;
  ownerName: string;
  title: string;
  channel: string;
  dueAt: string;
  status: string;
  origin?: FollowUpOrigin;
  createdAt: string;
  contactName: string;
  contactTitle: string;
  email: string;
  phone: string;
  grade: string;
  priority: string;
  leadStatus: string;
  doNotContact: boolean;
  isSuppressed: boolean;
  companyName: string;
};

/** One contact that has at least one open SDR-scheduled follow-up. */
export type FollowUpContactRow = {
  contactId: string;
  contactName: string;
  contactTitle: string;
  email: string;
  phone: string;
  grade: string;
  priority: string;
  leadStatus: string;
  doNotContact: boolean;
  isSuppressed: boolean;
  companyId: string;
  companyName: string;
  ownerUserId: string;
  ownerName: string;
  openFollowUps: number;
  overdueFollowUps: number;
  /** The soonest-due open follow-up — what the SDR actually has to do next. */
  nextFollowUpId: string;
  nextTitle: string;
  nextChannel: string;
  nextDueAt: string;
  nextStatus: string;
  nextDueLabel: string;
  nextDueDateLabel: string;
};

export type FollowUpsReadModel = {
  rows: FollowUpContactRow[];
  /** Total open SDR-scheduled follow-ups across the returned contacts. */
  totalFollowUps: number;
  /** True when the bounded fetch hit its cap, so the page can say so out loud. */
  truncated: boolean;
  /** SDR/Manager roster for the owner filter (empty for an SDR's own view). */
  roster: Array<{ id: string; name: string }>;
};

// The table paginates client-side, so fetch the whole open-follow-up set rather
// than a page of it. Open follow-ups are a small fraction of the assigned book,
// so this ceiling sits far above any real workspace — it exists only so that a
// pathological one degrades visibly (see `truncated`) instead of silently.
export const FOLLOW_UP_FETCH_LIMIT = 2_000;

/**
 * Collapses open follow-ups into one row per contact, ordered by the soonest
 * thing due.
 *
 * Only `origin === "sdr"` survives — a follow-up the SDR explicitly scheduled in
 * the touch form or call wrap-up. Everything the platform invents is dropped:
 * first-touch SLA reminders, bulk-assign reminders, and touches where the SDR
 * left the date blank and `defaultFollowUpDueAt` chose one for them. Title text
 * is deliberately NOT consulted — "Follow up with ..." is used by both the
 * SDR-scheduled and the auto-defaulted path, so it cannot tell them apart.
 *
 * Legacy rows (`origin` undefined) are excluded too. Nothing in the old data
 * records who chose the date, and guessing would put invented follow-ups back on
 * a page whose whole purpose is to exclude them.
 */
export function groupFollowUpsByContact(rows: FollowUpSourceRow[]): FollowUpContactRow[] {
  const byContact = new Map<string, FollowUpContactRow>();

  for (const row of rows) {
    if (!row.contactId) continue;
    if (row.status === "Completed") continue;
    if (row.origin !== "sdr") continue;

    const existing = byContact.get(row.contactId);
    if (!existing) {
      byContact.set(row.contactId, {
        contactId: row.contactId,
        contactName: row.contactName,
        contactTitle: row.contactTitle,
        email: row.email,
        phone: row.phone,
        grade: row.grade,
        priority: row.priority,
        leadStatus: row.leadStatus,
        doNotContact: row.doNotContact,
        isSuppressed: row.isSuppressed,
        companyId: row.companyId,
        companyName: row.companyName,
        ownerUserId: row.ownerUserId,
        ownerName: row.ownerName,
        openFollowUps: 1,
        overdueFollowUps: row.status === "Overdue" ? 1 : 0,
        nextFollowUpId: row.id,
        nextTitle: row.title,
        nextChannel: row.channel,
        nextDueAt: row.dueAt,
        nextStatus: row.status,
        nextDueLabel: followUpDueLabel(row.dueAt),
        nextDueDateLabel: followUpDueDateLabel(row.dueAt)
      });
      continue;
    }

    existing.openFollowUps += 1;
    if (row.status === "Overdue") existing.overdueFollowUps += 1;
    // Ties break on id so "next" stays stable across renders and drivers.
    const sooner =
      Date.parse(row.dueAt) - Date.parse(existing.nextDueAt) ||
      row.id.localeCompare(existing.nextFollowUpId);
    if (sooner < 0) {
      existing.nextFollowUpId = row.id;
      existing.nextTitle = row.title;
      existing.nextChannel = row.channel;
      existing.nextDueAt = row.dueAt;
      existing.nextStatus = row.status;
      existing.nextDueLabel = followUpDueLabel(row.dueAt);
      existing.nextDueDateLabel = followUpDueDateLabel(row.dueAt);
    }
  }

  return [...byContact.values()].sort(
    (left, right) =>
      Date.parse(left.nextDueAt) - Date.parse(right.nextDueAt) ||
      left.contactId.localeCompare(right.contactId)
  );
}

/**
 * Prisma-only fast path for the Follow-ups directory: every open SDR-scheduled
 * follow-up in the workspace (or, for an SDR, only their own — any `sdrId` is
 * ignored for them), collapsed to one row per contact. Returns undefined on the
 * file-store driver so the page falls back to the snapshot path.
 */
export async function readFastFollowUpsModel(
  session: Session,
  workspaceId: string,
  opts?: { sdrId?: string }
): Promise<FollowUpsReadModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const isSdr = session.role === "SDR";
  // SDRs are always locked to their own id; any ?sdr= param is ignored for them.
  const ownerId = isSdr ? session.user.id : opts?.sdrId;

  const [reminders, members] = await Promise.all([
    prisma.followUpReminder.findMany({
      where: {
        workspaceId,
        status: { not: "Completed" },
        contactId: { not: null },
        // SDR-scheduled only. Pushed into the query rather than filtered in
        // memory so the row cap is spent on rows that can actually be shown.
        origin: "sdr",
        ...(ownerId ? { ownerUserId: ownerId } : {})
      },
      include: {
        account: true,
        contact: { include: { account: true, contact: true } },
        owner: true
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: FOLLOW_UP_FETCH_LIMIT
    }),
    isSdr
      ? Promise.resolve([])
      : prisma.workspaceMember.findMany({
          where: { workspaceId, role: { in: ["SDR", "MANAGER"] } },
          include: { user: true },
          orderBy: [{ role: "asc" }, { id: "asc" }]
        })
  ]);

  const sourceRows = reminders.map((reminder) => {
    const crmContact = reminder.contact;
    const leadContact = crmContact?.contact;
    const account = reminder.account ?? crmContact?.account;
    const email = leadContact?.email ?? crmContact?.email ?? "";

    return {
      id: reminder.id,
      contactId: reminder.contactId ?? crmContact?.id ?? "",
      companyId: reminder.accountId ?? account?.id ?? "",
      ownerUserId: reminder.ownerUserId ?? "",
      ownerName: reminder.owner?.name ?? "Unassigned",
      title: reminder.title,
      channel: reminder.channel,
      dueAt: reminder.dueAt.toISOString(),
      status: reminder.status,
      origin: reminder.origin === "sdr" || reminder.origin === "system" ? reminder.origin : undefined,
      createdAt: reminder.createdAt.toISOString(),
      contactName: displayContactName({
        name: leadContact?.fullName ?? crmContact?.fullName,
        email
      }),
      contactTitle: leadContact?.title ?? crmContact?.title ?? "",
      email,
      phone: leadContact?.phone ?? crmContact?.phone ?? "",
      grade: leadContact?.grade ?? "D",
      priority: leadContact?.priority ?? "P4",
      leadStatus: leadContact?.status ?? crmContact?.status ?? "New",
      doNotContact: leadContact?.doNotContact ?? false,
      isSuppressed: leadContact?.isSuppressed ?? false,
      companyName: account?.name ?? "Unknown account"
    } satisfies FollowUpSourceRow;
  });

  const rows = groupFollowUpsByContact(sourceRows);

  return {
    rows,
    totalFollowUps: rows.reduce((total, row) => total + row.openFollowUps, 0),
    truncated: reminders.length >= FOLLOW_UP_FETCH_LIMIT,
    roster: members.map((member) => ({ id: member.user.id, name: member.user.name }))
  };
}

// Both labels are produced here, on the server, so the client table renders
// plain strings and never touches Date.now() (no hydration drift).
function followUpDueDateLabel(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "No due date";
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function followUpDueLabel(value: string) {
  const diffMs = Date.parse(value) - Date.now();
  if (!Number.isFinite(diffMs)) return "No due date";
  const absHours = Math.max(1, Math.round(Math.abs(diffMs) / (60 * 60 * 1000)));
  if (diffMs < 0) return `${absHours}h overdue`;
  if (absHours < 24) return `${absHours}h left`;
  return `${Math.round(absHours / 24)}d left`;
}

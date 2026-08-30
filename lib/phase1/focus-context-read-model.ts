import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

// Fills the dossier's Opportunity scan cell + "Open opportunity"/"Open work" rows
// AND the Tasks / Opportunities tabs (SDR Cockpit §38, §42) with real per-contact
// data. One opportunity + one task query for the whole queue, grouped by contact.
export type FocusTask = { title: string; dueLabel: string; overdue: boolean };
export type FocusOpp = { name: string; stage: string; amountLabel: string; closeLabel: string };
export type FocusContextItem = {
  openOpportunity: string; // "" when none
  openWork: string; // "" when none
  tasks: FocusTask[];
  opportunities: FocusOpp[];
};

// How many tasks / opportunities the dossier shows for one contact. Also the
// per-contact multiplier for the queries' row bound, so the two cannot drift
// into fetching rows nothing can render.
const DOSSIER_ROWS_PER_CONTACT = 8;

const STAGE_LABEL: Record<string, string> = {
  PROSPECTING: "Prospecting",
  QUALIFIED: "Qualified",
  DISCOVERY: "Discovery",
  PROPOSAL: "Proposal",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost"
};
const CLOSED = new Set(["CLOSED_WON", "CLOSED_LOST"]);

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function dayLabel(date: Date | null): string {
  if (!date) return "No due date";
  const iso = date.toISOString().slice(0, 10);
  const overdue = date.getTime() < Date.now();
  return `${iso}${overdue ? " · overdue" : ""}`;
}

export async function readFocusContext(
  workspaceId: string,
  contactIds: string[]
): Promise<Map<string, FocusContextItem>> {
  const map = new Map<string, FocusContextItem>();
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (resolveStorageDriver() !== "prisma" || ids.length === 0) {
    return map;
  }

  const { prisma } = await import("@/lib/prisma");
  // Both reads are fed every contact on the page, so with the directory bound at
  // 5,000 they were the largest unbounded queries in a /sdr/focus render. The
  // dossier keeps DOSSIER_ROWS_PER_CONTACT of each per contact (see the slices
  // below), so that many times the contact count is the most that can ever be
  // displayed. The bound is global while the cap is per contact, so in principle
  // one contact with thousands of tasks could crowd out later ones — it would
  // take DOSSIER_ROWS_PER_CONTACT × the whole page's contacts on a single
  // record, and the alternative is no bound at all.
  const rowBound = ids.length * DOSSIER_ROWS_PER_CONTACT;
  const [opportunities, tasks] = await Promise.all([
    prisma.opportunity.findMany({
      where: { workspaceId, contactId: { in: ids } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { contactId: true, name: true, stage: true, amountCents: true, expectedCloseDate: true },
      take: rowBound
    }),
    prisma.task.findMany({
      // The app writes "Open"/"Overdue" (crm.ts taskStatuses) and Prisma string
      // equality is case-sensitive — a bare lowercase match returns zero rows.
      // Match like the CRM overview does: case-insensitive, and overdue counts
      // as open work for the dossier.
      where: {
        workspaceId,
        contactId: { in: ids },
        OR: [
          { status: { equals: "open", mode: "insensitive" } },
          { status: { equals: "overdue", mode: "insensitive" } }
        ]
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: { contactId: true, title: true, dueAt: true },
      take: rowBound
    })
  ]);

  const oppsByContact = new Map<string, FocusOpp[]>();
  for (const opp of opportunities) {
    if (!opp.contactId) continue;
    const list = oppsByContact.get(opp.contactId) ?? [];
    list.push({
      name: opp.name,
      stage: STAGE_LABEL[opp.stage] ?? opp.stage,
      amountLabel: money(opp.amountCents),
      closeLabel: opp.expectedCloseDate ? opp.expectedCloseDate.toISOString().slice(0, 10) : "No close date"
    });
    oppsByContact.set(opp.contactId, list);
  }
  const tasksByContact = new Map<string, FocusTask[]>();
  for (const task of tasks) {
    if (!task.contactId) continue;
    const list = tasksByContact.get(task.contactId) ?? [];
    list.push({ title: task.title, dueLabel: dayLabel(task.dueAt), overdue: Boolean(task.dueAt && task.dueAt.getTime() < Date.now()) });
    tasksByContact.set(task.contactId, list);
  }

  for (const id of ids) {
    const opps = oppsByContact.get(id) ?? [];
    const contactTasks = tasksByContact.get(id) ?? [];
    const openOpp = opportunities.find((opp) => opp.contactId === id && !CLOSED.has(opp.stage));
    const firstTask = contactTasks[0];
    map.set(id, {
      openOpportunity: openOpp ? `${openOpp.name} · ${STAGE_LABEL[openOpp.stage] ?? openOpp.stage} · ${money(openOpp.amountCents)}` : "",
      openWork: firstTask ? `${firstTask.title} · ${firstTask.dueLabel}` : "",
      tasks: contactTasks.slice(0, DOSSIER_ROWS_PER_CONTACT),
      opportunities: opps.slice(0, DOSSIER_ROWS_PER_CONTACT)
    });
  }

  return map;
}

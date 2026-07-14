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
  const [opportunities, tasks] = await Promise.all([
    prisma.opportunity.findMany({
      where: { workspaceId, contactId: { in: ids } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { contactId: true, name: true, stage: true, amountCents: true, expectedCloseDate: true }
    }),
    prisma.task.findMany({
      where: { workspaceId, contactId: { in: ids }, status: "open" },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: { contactId: true, title: true, dueAt: true }
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
      tasks: contactTasks.slice(0, 8),
      opportunities: opps.slice(0, 8)
    });
  }

  return map;
}

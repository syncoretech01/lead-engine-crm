import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

// Fills the dossier's "Opportunity" scan cell + "Open opportunity" / "Open work"
// rows with real per-contact data (SDR Cockpit §38, §42). One opportunity + one
// task query for the whole queue, grouped by contact.
export type FocusContextItem = {
  openOpportunity: string; // "" when none
  openWork: string; // "" when none
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
      select: { contactId: true, name: true, stage: true, amountCents: true }
    }),
    prisma.task.findMany({
      where: { workspaceId, contactId: { in: ids }, status: "open" },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: { contactId: true, title: true, dueAt: true }
    })
  ]);

  const oppByContact = new Map<string, (typeof opportunities)[number]>();
  for (const opp of opportunities) {
    if (!opp.contactId || CLOSED.has(opp.stage)) continue;
    if (!oppByContact.has(opp.contactId)) oppByContact.set(opp.contactId, opp);
  }
  const taskByContact = new Map<string, (typeof tasks)[number]>();
  for (const task of tasks) {
    if (!task.contactId) continue;
    if (!taskByContact.has(task.contactId)) taskByContact.set(task.contactId, task);
  }

  for (const id of ids) {
    const opp = oppByContact.get(id);
    const task = taskByContact.get(id);
    map.set(id, {
      openOpportunity: opp
        ? `${opp.name} · ${STAGE_LABEL[opp.stage] ?? opp.stage} · $${Math.round(opp.amountCents / 100).toLocaleString("en-US")}`
        : "",
      openWork: task ? `${task.title}${task.dueAt ? ` · due ${task.dueAt.toISOString().slice(0, 10)}` : ""}` : ""
    });
  }

  return map;
}

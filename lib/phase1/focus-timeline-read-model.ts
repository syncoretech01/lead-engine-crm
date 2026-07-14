import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { activityTypeValue } from "@/lib/phase1/fast-read-utils";
import type { ActivityType } from "@/lib/phase1/types";

// The dossier "Recent engagement" mini-timeline (SDR Cockpit §41): the last few
// activities for a contact. Fetched per Focus queue load and grouped by contact.
export type FocusTimelineItem = {
  id: string;
  type: ActivityType;
  title: string;
  body?: string;
  meta: string; // precomputed relative time (server-side; never reaches the client as Date.now)
};

export async function readFocusTimelines(
  workspaceId: string,
  contactIds: string[]
): Promise<Map<string, FocusTimelineItem[]>> {
  const map = new Map<string, FocusTimelineItem[]>();
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (resolveStorageDriver() !== "prisma" || ids.length === 0) {
    return map;
  }

  const { prisma } = await import("@/lib/prisma");
  const activities = await prisma.activity.findMany({
    where: { workspaceId, contactId: { in: ids } },
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    take: 600,
    select: { id: true, type: true, title: true, body: true, occurredAt: true, contactId: true }
  });

  for (const activity of activities) {
    const contactId = activity.contactId;
    if (!contactId) continue;
    const existing = map.get(contactId);
    const item: FocusTimelineItem = {
      id: activity.id,
      type: activityTypeValue(activity.type),
      title: activity.title,
      body: activity.body ?? undefined,
      meta: relativeLabel(activity.occurredAt)
    };
    if (existing) {
      if (existing.length < 3) existing.push(item);
    } else {
      map.set(contactId, [item]);
    }
  }

  return map;
}

function relativeLabel(occurredAt: Date): string {
  const minutes = Math.round((Date.now() - occurredAt.getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)}d ago`;
  return `${Math.round(minutes / 43200)}mo ago`;
}

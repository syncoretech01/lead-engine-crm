import type { Activity } from "@/lib/phase1/types";

export function dedupeTimelineActivities(activities: Activity[]) {
  const seen = new Set<string>();
  const deduped: Activity[] = [];

  for (const activity of activities) {
    const key = [
      activity.type,
      activity.title,
      activity.body ?? "",
      activity.actorUserId,
      activity.companyId ?? "",
      activity.contactId ?? "",
      activity.opportunityId ?? "",
      activity.createdAt.slice(0, 10)
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(activity);
  }

  return deduped;
}

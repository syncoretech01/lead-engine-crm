import type { ActivityType } from "@/lib/phase1/types";

export type MyDayActivityKind =
  | "call"
  | "email"
  | "sms"
  | "followup"
  | "opportunity"
  | "meeting"
  | "note"
  | "task"
  | "other";

export function myDayActivityPresentation(activity: { type: ActivityType; title: string }): {
  kind: MyDayActivityKind;
  verb: string;
} {
  const title = activity.title.toLowerCase();

  switch (activity.type) {
    case "Call":
      return { kind: "call", verb: title.includes("failed") ? "Call failed for" : "Called" };
    case "Email":
      return { kind: "email", verb: title.includes("failed") ? "Email failed for" : "Emailed" };
    case "SMS":
      return { kind: "sms", verb: title.includes("failed") ? "Text failed for" : "Texted" };
    case "Opportunity":
      return {
        kind: "opportunity",
        verb: title.includes("created") ? "Created opportunity for" : "Updated opportunity for"
      };
    case "Meeting":
      return { kind: "meeting", verb: title.includes("book") ? "Booked meeting with" : "Meeting activity with" };
    case "Note":
      return { kind: "note", verb: "Added note for" };
    case "Task":
      if (title.includes("reminder completed") || title.includes("follow-up completed")) {
        return { kind: "followup", verb: "Completed follow-up for" };
      }
      if (title.includes("follow up") || title.includes("follow-up")) {
        return { kind: "followup", verb: "Added follow-up for" };
      }
      return {
        kind: "task",
        verb: title.includes("completed") ? "Completed task for" : "Created task for"
      };
    case "Verification":
      return { kind: "other", verb: "Verified" };
    case "Status change":
      return { kind: "other", verb: "Updated" };
  }
}

export function myDayActivityTimeLabel(value: string, now = new Date()) {
  const occurredAt = new Date(value);
  if (Number.isNaN(occurredAt.getTime())) return "";

  const elapsedMs = Math.max(0, now.getTime() - occurredAt.getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

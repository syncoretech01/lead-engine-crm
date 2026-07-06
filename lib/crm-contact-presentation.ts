import type { BadgeTone } from "@/components/ui/status-badge";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import type { CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";

/** Pure cell-presentation helpers shared by the server page and the client
 * contacts table, so both render identical badges without duplicating logic. */

export function contactDisplayName(contact: Pick<CrmContactListRow, "name" | "email">) {
  return displayContactName(contact);
}

export function contactEmailAvailable(contact: Pick<CrmContactListRow, "email" | "isSuppressed">) {
  return Boolean(contact.email && !contact.isSuppressed);
}

export function gradeTone(grade: string): BadgeTone {
  const normalized = grade.toUpperCase();
  if (normalized === "A" || normalized === "B") return "success";
  if (normalized === "C" || normalized === "D") return "warning";
  if (normalized === "S") return "danger";
  return "default";
}

export function priorityTone(priority: string): BadgeTone {
  if (priority === "P1") return "danger";
  if (priority === "P2") return "warning";
  return "info";
}

export function slaTone(sla: string): BadgeTone {
  if (sla === "Overdue") return "danger";
  if (sla === "Due soon") return "warning";
  if (sla === "On track") return "success";
  return "default";
}

/** SDR-assignment fields shared by the contact peek across both tables. */
export type PeekAssignment = {
  slaStatus: string;
  slaTone: BadgeTone;
  assignedRelative: string;
  lastTouchLabel: string;
};

function relativeSince(iso?: string): string {
  if (!iso) return "—";
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "—";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Format raw assignment fields into the peek's display strings (server-side). */
export function buildPeekAssignment(input: {
  slaStatus: string;
  assignedAt?: string;
  lastTouchAt?: string;
  touchCount: number;
}): PeekAssignment {
  return {
    slaStatus: input.slaStatus,
    slaTone: slaTone(input.slaStatus),
    assignedRelative: relativeSince(input.assignedAt),
    lastTouchLabel: `${input.lastTouchAt ? relativeSince(input.lastTouchAt) : "No touches"}${
      input.touchCount > 0 ? ` · ${input.touchCount}` : ""
    }`
  };
}

export type NextAction = { label: string; tone: "success" | "info" | "warning" | "danger" };

export function contactNextAction(contact: CrmContactListRow): NextAction {
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

export function priorityWeight(priority: string) {
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  if (priority === "P3") return 3;
  if (priority === "P4") return 4;
  return 5;
}

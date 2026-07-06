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

import type { CallTarget } from "@/components/call/call-context";
import type { CoTone } from "@/components/crm/cockpit/co-table";

// The lead shape the Focus cockpit renders — a flattened SDR queue row plus the
// ids the unified wrap-up needs (assignmentId, companyId). Shared by the queue
// rail, dossier, and execution dock.
export type FocusLead = {
  id: string; // contactId
  assignmentId: string; // SdrAssignment id — the wrap-up keys off this
  name: string;
  title: string;
  email: string;
  phone: string;
  hasPhone: boolean;
  priority: string;
  status: string; // SdrLeadStatus
  slaStatus: string;
  dueLabel: string;
  dueAtMs: number;
  overdue: boolean;
  grade: string;
  fitReason: string;
  companyId: string;
  companyName: string;
  companyDomain: string;
  companyIndustry: string;
  companyLocation: string;
  lastTouchLabel: string;
  owner: string;
  emailEligible: boolean;
};

export function priorityTone(priority: string): CoTone {
  if (priority === "P1") return "red";
  if (priority === "P2") return "amber";
  if (priority === "P3") return "sky";
  return "neutral";
}

export function slaTone(sla: string): CoTone {
  if (sla === "Overdue") return "red";
  if (sla === "Due soon") return "amber";
  if (sla === "On track") return "teal";
  return "neutral";
}

export function statusTone(status: string): CoTone {
  if (status === "Replied" || status === "Meeting Booked" || status === "Interested" || status === "Qualified")
    return "teal";
  if (status === "Suppressed" || status === "Unsubscribed" || status === "Disqualified" || status === "Invalid")
    return "red";
  if (status === "New" || status === "Nurture" || status === "Assigned") return "neutral";
  return "info";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// Why placing a call to this lead is blocked (the SDR has no usable line, or the
// contact can't be dialed), or null when it's callable.
export function leadBlockReason(lead: FocusLead, lineBlockReason: string | null): string | null {
  if (!lead.hasPhone) return "No phone number on file";
  if (lead.status === "Suppressed") return "Contact is suppressed";
  if (lead.status === "Unsubscribed") return "Contact has unsubscribed";
  if (lineBlockReason) return lineBlockReason;
  return null;
}

export function leadCallTarget(
  lead: FocusLead,
  callerLabel: string | null,
  lineBlockReason: string | null
): CallTarget {
  return {
    contactId: lead.id,
    contactName: lead.name,
    phone: lead.phone,
    callerLabel: callerLabel ?? undefined,
    blockReason: leadBlockReason(lead, lineBlockReason) ?? undefined
  };
}

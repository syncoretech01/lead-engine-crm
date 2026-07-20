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
  /** The current due date falls on today (UTC) — matches My Day's "Due today". */
  dueToday: boolean;
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
  localTimeLabel: string; // "" when the timezone can't be derived
  outsideWindow: boolean;
  openOpportunity: string; // "" when none
  openWork: string; // "" when none
  keyAccountFields: KeyAccountFieldRow[];
  timeline: FocusTimelineItem[];
  tasks: FocusTaskRow[];
  opportunities: FocusOppRow[];
};

export type KeyAccountFieldRow = { label: string; value: string };
export type FocusTaskRow = { title: string; dueLabel: string; overdue: boolean };
export type FocusOppRow = { name: string; stage: string; amountLabel: string; closeLabel: string };

// Mirror of lib/phase1/focus-timeline-read-model's item (client-safe: `type` is a
// plain string so this file stays free of server imports).
export type FocusTimelineItem = {
  id: string;
  type: string;
  title: string;
  body?: string;
  meta: string;
};

export function priorityTone(priority: string): CoTone {
  if (priority === "P1") return "red";
  if (priority === "P2") return "amber";
  if (priority === "P3") return "sky";
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

// The compliance guardrail band shown across the top of the dossier (SDR Cockpit
// §37): the current contactability state + who resolves it. Derived from the data
// the queue row carries (status + phone availability).
export type LeadCompliance = {
  clear: boolean;
  tone: "teal" | "red" | "amber" | "gray";
  title: string;
  copy: string;
};

// The "Recommended action" cell of the dossier pre-call scan strip (SDR Cockpit
// §38) — derived from the lead's state, never invented.
export function recommendedAction(lead: FocusLead, blocked: boolean): string {
  if (blocked) return "Blocked — review the guardrail";
  if (lead.overdue) return "Call now — follow-up overdue";
  if (lead.status === "Replied" || lead.status === "Interested") return "Reply, then call";
  if (lead.status === "Meeting Booked") return "Prep the meeting";
  if (!lead.hasPhone) return "Send a 1:1 email";
  return "Call — first touch";
}

export function leadCompliance(lead: FocusLead): LeadCompliance {
  if (lead.status === "Suppressed") {
    return {
      clear: false,
      tone: "red",
      title: "Suppressed — do not contact",
      copy: "This contact is on the workspace suppression list. A workspace admin can review or lift the suppression."
    };
  }
  if (lead.status === "Unsubscribed") {
    return {
      clear: false,
      tone: "red",
      title: "Do not contact",
      copy: "This contact has opted out. Outreach stays blocked until they opt back in."
    };
  }
  if (lead.status === "Invalid") {
    return {
      clear: false,
      tone: "amber",
      title: "Phone flagged invalid",
      copy: "The number on file didn't validate. Confirm a correct number on the record before calling."
    };
  }
  if (!lead.hasPhone) {
    return {
      clear: false,
      tone: "gray",
      title: "No phone on file",
      copy: "There's no phone number for this contact. Add one on the record, or reach out by email."
    };
  }
  return {
    clear: true,
    tone: "teal",
    title: "Clear to contact",
    copy: "No compliance blocks on file — good to call."
  };
}

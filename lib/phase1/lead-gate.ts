import { contactQualityBlockers } from "@/lib/phase1/lead-engine-metrics";
import { domainFromEmail, isMeaningfulPersonName, isPersonalEmailDomain } from "@/lib/phase1/lead-data-quality";
import type { AppState, Contact } from "@/lib/phase1/types";

export type LeadGateResult = {
  ready: Contact[];
  held: Contact[];
  reasons: { reason: string; count: number }[];
};

/**
 * Partition contacts into the ones ready for SDR assignment and the ones held
 * back, so the guided flow never drops low-quality leads into reps' queues.
 * By default "ready" means A/B verified, unsuppressed, non-personal email, and
 * named enough for SDR ownership. When an AppState is provided, the company
 * record is checked too.
 */
export function partitionLeadsForAssignment(input: {
  contacts: Contact[];
  state?: AppState;
  requiredFields?: string[];
}): LeadGateResult {
  const required = (input.requiredFields ?? []).map((field) => field.toLowerCase());
  const needsPhone = required.some((field) => field.includes("phone"));

  const ready: Contact[] = [];
  const held: Contact[] = [];
  const counts = new Map<string, number>();

  for (const contact of input.contacts) {
    const blockers = input.state ? contactQualityBlockers(input.state, contact, required) : localContactBlockers(contact, needsPhone);
    if (blockers.length) {
      for (const blocker of blockers) {
        counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
      }
      held.push(contact);
    } else {
      ready.push(contact);
    }
  }

  const reasons = Array.from(counts.entries()).map(([reason, count]) => ({ reason, count }));
  return { ready, held, reasons };
}

function localContactBlockers(contact: Contact, needsPhone: boolean) {
  const blockers: string[] = [];

  if (contact.isSuppressed || contact.priority === "S" || contact.grade === "S") blockers.push("Suppressed");
  if (contact.grade === "D") blockers.push("Invalid email");
  if (contact.grade === "C") blockers.push("Needs enrichment");
  if (contact.grade !== "A" && contact.grade !== "B") blockers.push("Not A/B verified");
  if (!contact.email) blockers.push("Missing email");
  if (needsPhone && !contact.phone) blockers.push("Missing phone");
  if (isPersonalEmailDomain(domainFromEmail(contact.email))) blockers.push("Personal email domain");
  if (!isMeaningfulPersonName(contact.name)) blockers.push("Missing contact name");

  return Array.from(new Set(blockers));
}

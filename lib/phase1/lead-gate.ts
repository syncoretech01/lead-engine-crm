import type { Contact } from "@/lib/phase1/types";

export type LeadGateResult = {
  ready: Contact[];
  held: Contact[];
  reasons: { reason: string; count: number }[];
};

/**
 * Partition contacts into the ones ready for SDR assignment and the ones held
 * back, so the guided flow never drops low-quality leads into reps' queues. A
 * lead is held when it is suppressed, priority "S", a low grade (D/S), or missing
 * a field the profile marks required (email/phone). This mirrors the assignment
 * skip rules and adds the grade + required-field bar on top.
 */
export function partitionLeadsForAssignment(input: {
  contacts: Contact[];
  requiredFields?: string[];
}): LeadGateResult {
  const required = (input.requiredFields ?? []).map((field) => field.toLowerCase());
  const needsEmail = required.some((field) => field.includes("email"));
  const needsPhone = required.some((field) => field.includes("phone"));

  const ready: Contact[] = [];
  const held: Contact[] = [];
  const counts = new Map<string, number>();
  const hold = (contact: Contact, reason: string) => {
    held.push(contact);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  };

  for (const contact of input.contacts) {
    if (contact.isSuppressed) hold(contact, "Suppressed");
    else if (contact.priority === "S") hold(contact, "Priority S");
    else if (contact.grade === "D" || contact.grade === "S") hold(contact, "Low grade");
    else if (needsEmail && !contact.email) hold(contact, "Missing email");
    else if (needsPhone && !contact.phone) hold(contact, "Missing phone");
    else ready.push(contact);
  }

  const reasons = Array.from(counts.entries()).map(([reason, count]) => ({ reason, count }));
  return { ready, held, reasons };
}

import type { AppState, Contact } from "@/lib/phase1/types";

const testAssignmentSource = "manual-email-send-test";

export type EmailTestAssignmentPreparation = {
  contactIds: string[];
  gradeOverrides: number;
};

export function emailTestAssignmentCandidates(state: AppState, workspaceId: string): Contact[] {
  const assignedContactIds = new Set(
    state.sdrAssignments
      .filter((assignment) => assignment.workspaceId === workspaceId)
      .map((assignment) => assignment.contactId)
  );

  return state.contacts.filter((contact) => {
    if (contact.workspaceId !== workspaceId) return false;
    if (assignedContactIds.has(contact.id)) return false;
    if (!state.companies.some((company) => company.id === contact.companyId && company.workspaceId === workspaceId)) {
      return false;
    }
    return isEmailTestAssignableContact(contact);
  });
}

export function prepareEmailTestAssignmentContacts(
  state: AppState,
  workspaceId: string,
  now = new Date().toISOString()
): EmailTestAssignmentPreparation {
  const candidates = emailTestAssignmentCandidates(state, workspaceId);
  let gradeOverrides = 0;

  for (const contact of candidates) {
    if (contact.grade === "D") {
      contact.grade = "C";
      gradeOverrides += 1;
    }
    if (contact.priority === "P4") {
      contact.priority = "P3";
    }
    contact.status = "Ready for SDR";
    contact.verification = "Manual email-send test override; enrichment skipped";
    contact.fitReason = "Manual email-send test assignment; not export-ready until standard quality gates pass";
    contact.sourceLineage = Array.from(new Set([...contact.sourceLineage, testAssignmentSource]));
    contact.updatedAt = now;
  }

  return {
    contactIds: candidates.map((contact) => contact.id),
    gradeOverrides
  };
}

function isEmailTestAssignableContact(contact: Contact) {
  return Boolean(
    contact.name.trim() &&
      contact.email.trim() &&
      !contact.isSuppressed &&
      !contact.doNotContact &&
      contact.grade !== "S" &&
      contact.priority !== "S"
  );
}

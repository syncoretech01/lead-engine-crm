import { randomUUID } from "node:crypto";
import type {
  AppState,
  ConsentStatus,
  Contact,
  DataSubjectRequest,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  LawfulBasis,
  RecordingConsentStatus,
  SequenceComplianceStatus,
  SequenceStep,
  SuppressionRecord
} from "@/lib/phase1/types";

export const lawfulBases: LawfulBasis[] = [
  "Legitimate interest",
  "Consent",
  "Contract",
  "Legal obligation",
  "Do not contact"
];
export const consentStatuses: ConsentStatus[] = ["Not required", "Granted", "Revoked", "Unknown"];
export const recordingConsentStatuses: RecordingConsentStatus[] = ["Granted", "Denied", "Unknown", "Not recorded"];
export const dataSubjectRequestTypes: DataSubjectRequestType[] = [
  "Access",
  "Deletion",
  "Suppression",
  "Correction",
  "Export"
];
export const dataSubjectRequestStatuses: DataSubjectRequestStatus[] = ["Open", "Verified", "Completed", "Rejected"];
export const defaultPhysicalAddress =
  process.env.SYNCORE_MAILING_ADDRESS?.trim() || "Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA";
export const defaultUnsubscribeUrl = "https://syncore.local/unsubscribe/{{contact_id}}";

type ContactComplianceDefaults = Pick<
  Contact,
  "lawfulBasis" | "consentStatus" | "consentSource" | "consentCapturedAt" | "doNotContact"
>;

export function defaultContactCompliance({
  source = "Lead source lineage",
  suppressed = false,
  capturedAt = new Date().toISOString()
}: {
  source?: string;
  suppressed?: boolean;
  capturedAt?: string;
} = {}): ContactComplianceDefaults {
  return {
    lawfulBasis: suppressed ? "Do not contact" : "Legitimate interest",
    consentStatus: suppressed ? "Revoked" : "Not required",
    consentSource: suppressed ? `Suppression: ${source}` : source,
    consentCapturedAt: capturedAt,
    doNotContact: suppressed
  };
}

export function ensureComplianceDefaults(state: AppState, workspaceId: string) {
  let changed = false;

  if (!Array.isArray(state.dataSubjectRequests)) {
    state.dataSubjectRequests = [];
    changed = true;
  }

  for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId)) {
    const defaults = defaultContactCompliance({
      source: contact.sourceLineage[0] ?? "Migration default",
      suppressed: contact.isSuppressed,
      capturedAt: contact.updatedAt
    });

    if (!contact.lawfulBasis) {
      contact.lawfulBasis = defaults.lawfulBasis;
      changed = true;
    }
    if (!contact.consentStatus) {
      contact.consentStatus = defaults.consentStatus;
      changed = true;
    }
    if (!contact.consentSource) {
      contact.consentSource = defaults.consentSource;
      changed = true;
    }
    if (!contact.consentCapturedAt) {
      contact.consentCapturedAt = defaults.consentCapturedAt;
      changed = true;
    }
    if (typeof contact.doNotContact !== "boolean") {
      contact.doNotContact = defaults.doNotContact;
      changed = true;
    }
  }

  for (const step of state.sequenceSteps.filter((item) => item.workspaceId === workspaceId)) {
    const before = complianceFingerprint(step);
    enforceSequenceStepCompliance(step);
    changed = complianceFingerprint(step) !== before || changed;
  }

  for (const call of state.trackedCalls.filter((item) => item.workspaceId === workspaceId)) {
    if (!call.recordingConsent) {
      call.recordingConsent = call.recordingUrl || call.transcript ? "Unknown" : "Not recorded";
      changed = true;
    }
    if (!call.recordingConsentCapturedAt) {
      call.recordingConsentCapturedAt = call.createdAt;
      changed = true;
    }
    if (!call.recordingConsentSource) {
      call.recordingConsentSource = call.recordingConsent === "Not recorded" ? "No recording captured" : "Migration default";
      changed = true;
    }
    if (call.recordingConsent !== "Granted" && (call.recordingUrl || call.recordingStoragePath || call.transcript)) {
      call.recordingUrl = undefined;
      call.recordingStoragePath = undefined;
      call.transcript = undefined;
      changed = true;
    }
  }

  return { changed };
}

export function enforceSequenceStepCompliance<T extends Partial<SequenceStep> & Pick<SequenceStep, "channel">>(
  step: T
): T & Pick<SequenceStep, "unsubscribeFooterRequired" | "physicalAddress" | "complianceStatus" | "complianceNotes"> {
  if (step.channel === "Email") {
    const physicalAddress = step.physicalAddress?.trim() || defaultPhysicalAddress;
    let bodyTemplate = step.bodyTemplate?.trim() || "Hi {{first_name}}, quick note from Syncore.";
    const missingUnsubscribe = !hasUnsubscribeMechanism(bodyTemplate);
    const missingAddress = !hasPhysicalAddress(bodyTemplate, physicalAddress);

    if (missingUnsubscribe || missingAddress) {
      bodyTemplate = appendEmailFooter(bodyTemplate, physicalAddress);
    }

    step.bodyTemplate = bodyTemplate;
    step.unsubscribeFooterRequired = true;
    step.physicalAddress = physicalAddress;
    step.complianceStatus = "Compliant";
    step.complianceNotes = missingUnsubscribe || missingAddress
      ? "Syncore appended unsubscribe and physical address footer."
      : "Email footer requirements present.";
    return step as T & Pick<SequenceStep, "unsubscribeFooterRequired" | "physicalAddress" | "complianceStatus" | "complianceNotes">;
  }

  if (step.channel === "SMS") {
    const smsTemplate = step.smsTemplate?.trim() || "Quick Syncore follow-up for {{company}}.";
    const missingStop = !/\bSTOP\b/i.test(smsTemplate);
    step.smsTemplate = missingStop ? `${smsTemplate} Reply STOP to opt out.` : smsTemplate;
    step.unsubscribeFooterRequired = false;
    step.physicalAddress = undefined;
    step.complianceStatus = "Compliant";
    step.complianceNotes = missingStop ? "Syncore appended STOP language." : "SMS STOP language present.";
    return step as T & Pick<SequenceStep, "unsubscribeFooterRequired" | "physicalAddress" | "complianceStatus" | "complianceNotes">;
  }

  step.unsubscribeFooterRequired = false;
  step.physicalAddress = undefined;
  step.complianceStatus = "Compliant";
  step.complianceNotes = "No outbound footer requirement for this channel.";
  return step as T & Pick<SequenceStep, "unsubscribeFooterRequired" | "physicalAddress" | "complianceStatus" | "complianceNotes">;
}

export function resolveSequenceComplianceStatus(step: Pick<SequenceStep, "channel"> & Partial<SequenceStep>): SequenceComplianceStatus {
  if (step.channel === "Email") {
    if (!hasUnsubscribeMechanism(step.bodyTemplate ?? "")) return "Needs footer";
    if (!hasPhysicalAddress(step.bodyTemplate ?? "", step.physicalAddress ?? "")) return "Needs address";
    return "Compliant";
  }

  if (step.channel === "SMS") {
    return /\bSTOP\b/i.test(step.smsTemplate ?? "") ? "Compliant" : "Needs STOP";
  }

  return "Compliant";
}

export function createDataSubjectRequest(
  state: AppState,
  input: {
    workspaceId: string;
    requestType: DataSubjectRequestType;
    email?: string;
    phone?: string;
    notes?: string;
    requestedAt?: string;
  }
) {
  const now = input.requestedAt ?? new Date().toISOString();
  const email = normalizeEmail(input.email ?? "") || undefined;
  const phone = normalizePhone(input.phone ?? "") || undefined;
  const contact = findRequestContact(state, input.workspaceId, email, phone);
  const dueAt = new Date(now);
  dueAt.setUTCDate(dueAt.getUTCDate() + 30);

  const request: DataSubjectRequest = {
    id: `dsr-${randomUUID()}`,
    workspaceId: input.workspaceId,
    requestType: input.requestType,
    status: "Open",
    email,
    phone,
    contactId: contact?.id,
    requestedAt: now,
    dueAt: dueAt.toISOString(),
    notes: input.notes?.trim() || `${input.requestType} request opened from compliance workflow.`
  };

  state.dataSubjectRequests.unshift(request);
  return request;
}

export function completeDataSubjectRequest(
  state: AppState,
  input: {
    workspaceId: string;
    requestId: string;
    actorUserId: string;
    evidence?: string;
    completedAt?: string;
  }
) {
  const request = state.dataSubjectRequests.find(
    (item) => item.id === input.requestId && item.workspaceId === input.workspaceId
  );

  if (!request) {
    throw new Error("Data subject request not found.");
  }

  const now = input.completedAt ?? new Date().toISOString();
  const contact = request.contactId
    ? state.contacts.find((item) => item.id === request.contactId && item.workspaceId === input.workspaceId)
    : findRequestContact(state, input.workspaceId, request.email, request.phone);
  let affectedContacts = 0;
  let suppression: SuppressionRecord | undefined;

  if ((request.requestType === "Deletion" || request.requestType === "Suppression") && contact) {
    const original = { email: contact.email, phone: contact.phone };
    const suppressionType = request.requestType === "Deletion"
      ? "Deletion request"
      : original.phone && !original.email
        ? "Do not call"
        : "Unsubscribe";
    suppression = upsertSuppressionRecord(state, {
      workspaceId: input.workspaceId,
      type: suppressionType,
      email: original.email || request.email,
      phone: original.phone || request.phone,
      reason: `Data subject ${request.requestType.toLowerCase()} request`,
      source: "Data subject request"
    });

    if (request.requestType === "Deletion") {
      anonymizeContact(contact, now);
    } else {
      suppressContact(contact, `Data subject ${request.requestType.toLowerCase()} request`, now);
    }

    affectedContacts = 1;
  }

  request.status = "Completed";
  request.completedAt = now;
  request.handledById = input.actorUserId;
  request.evidence = input.evidence?.trim() ||
    (contact ? `${request.requestType} request completed for ${contact.id}.` : `${request.requestType} request completed with no linked contact.`);

  return { request, affectedContacts, suppression };
}

export function suppressContact(contact: Contact, reason: string, now = new Date().toISOString()) {
  contact.isSuppressed = true;
  contact.doNotContact = true;
  contact.lawfulBasis = "Do not contact";
  contact.consentStatus = "Revoked";
  contact.consentSource = reason;
  contact.consentCapturedAt = now;
  contact.grade = "S";
  contact.priority = "S";
  contact.status = "Suppressed";
  contact.verification = `Suppressed: ${reason}`;
  contact.updatedAt = now;
}

function anonymizeContact(contact: Contact, now: string) {
  suppressContact(contact, "Data subject deletion request", now);
  contact.name = `Anonymized contact ${contact.id.slice(-6)}`;
  contact.title = "Anonymized";
  contact.email = "";
  contact.phone = "";
  contact.owner = "Unassigned";
  contact.seniority = undefined;
  contact.department = undefined;
  contact.fitReason = undefined;
  contact.enrichedAt = undefined;
  contact.enrichmentCoverage = 0;
}

function findRequestContact(state: AppState, workspaceId: string, email?: string, phone?: string) {
  return state.contacts.find((contact) => {
    if (contact.workspaceId !== workspaceId) return false;
    return Boolean((email && contact.email.toLowerCase() === email.toLowerCase()) || (phone && contact.phone === phone));
  });
}

function upsertSuppressionRecord(
  state: AppState,
  input: {
    workspaceId: string;
    type: SuppressionRecord["type"];
    email?: string;
    phone?: string;
    reason: string;
    source: string;
  }
) {
  const existing = state.suppressionRecords.find(
    (record) =>
      record.workspaceId === input.workspaceId &&
      record.type === input.type &&
      ((input.email && record.email?.toLowerCase() === input.email.toLowerCase()) ||
        (input.phone && record.phone === input.phone))
  );

  if (existing) {
    return existing;
  }

  const record: SuppressionRecord = {
    id: `supp-${randomUUID()}`,
    workspaceId: input.workspaceId,
    type: input.type,
    email: input.email,
    phone: input.phone,
    reason: input.reason,
    source: input.source,
    createdAt: new Date().toISOString()
  };
  state.suppressionRecords.unshift(record);
  return record;
}

function appendEmailFooter(bodyTemplate: string, physicalAddress: string) {
  const parts = [bodyTemplate.trim()];
  if (!hasUnsubscribeMechanism(bodyTemplate)) {
    parts.push("Unsubscribe: {{unsubscribe_url}}");
  }
  if (!hasPhysicalAddress(bodyTemplate, physicalAddress)) {
    parts.push(`{{physical_address}}`);
  }
  return parts.join("\n\n");
}

function hasUnsubscribeMechanism(value: string) {
  return /unsubscribe|opt out|{{unsubscribe_url}}/i.test(value);
}

function hasPhysicalAddress(value: string, physicalAddress: string) {
  return /{{physical_address}}/i.test(value) || Boolean(physicalAddress && value.includes(physicalAddress));
}

function complianceFingerprint(step: Partial<SequenceStep>) {
  return [
    step.bodyTemplate,
    step.smsTemplate,
    step.unsubscribeFooterRequired,
    step.physicalAddress,
    step.complianceStatus,
    step.complianceNotes
  ].join("|");
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  return value.trim();
}

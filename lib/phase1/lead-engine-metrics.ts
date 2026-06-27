import { isActionableDedupeMatch } from "@/lib/phase1/dedupe";
import {
  domainFromEmail,
  isMeaningfulCompanyName,
  isMeaningfulPersonName,
  isPersonalEmailDomain,
  isPlaceholderCompanyName,
  isPlaceholderPersonName
} from "@/lib/phase1/lead-data-quality";
import type { AppState, Contact, DedupeMatch, LeadGrade, NormalizedRecord } from "@/lib/phase1/types";

export type LeadEngineMetrics = {
  rawCount: number;
  normalizedCount: number;
  stagedCount: number;
  companyCount: number;
  contactCount: number;
  verifiedCount: number;
  verifiedRate: number;
  riskCount: number;
  invalidCount: number;
  suppressedCount: number;
  needsReviewCount: number;
  exportReadyCount: number;
  readyForSdrCount: number;
  phoneReadyCount: number;
  enrichedCount: number;
  exportedCount: number;
  crmHandoffCount: number;
  activeJobCount: number;
  queuedJobCount: number;
  runningJobCount: number;
  completedJobCount: number;
  totalJobCount: number;
  totalActualCost: number;
  estimatedCostCents: number;
  duplicatePairCount: number;
  actionableDuplicatePairCount: number;
  duplicateGroupCount: number;
  hiddenDuplicatePairCount: number;
  personalEmailCount: number;
  missingCompanyCount: number;
  missingContactCount: number;
  missingPhoneCount: number;
  assignmentBlockedCount: number;
};

export type DedupeGroup = {
  id: string;
  objectType: DedupeMatch["objectType"];
  primaryId: string;
  primaryLabel: string;
  primaryDetail: string;
  duplicateIds: string[];
  duplicateLabels: string[];
  matchIds: string[];
  reason: string;
  confidence: number;
  matchType: string;
};

export function buildLeadEngineMetrics(state: AppState, workspaceId: string): LeadEngineMetrics {
  const rawLeads = state.rawLeads.filter((lead) => lead.workspaceId === workspaceId);
  const normalizedRecords = state.normalizedRecords.filter((record) => record.workspaceId === workspaceId);
  const companies = state.companies.filter((company) => company.workspaceId === workspaceId);
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const leadJobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const openMatches = state.dedupeMatches.filter((match) => match.workspaceId === workspaceId && match.status === "Open");
  const actionableMatches = openMatches.filter((match) => isActionableDedupeMatch(state, match));
  const duplicateGroups = groupOpenDedupeMatches(state, workspaceId);
  const nonSuppressedContacts = contacts.filter((contact) => !contact.isSuppressed && contact.grade !== "S");
  const verifiedContacts = contacts.filter((contact) => isStrictlyVerifiedContact(contact));
  const verifiedRecords = normalizedRecords.filter((record) => isStrictlyVerifiedRecord(record));
  const assignmentReadyContacts = contacts.filter((contact) => isSdrReadyContact(state, contact));
  const exportedIds = new Set(
    state.exports
      .filter((exportRecord) => exportRecord.workspaceId === workspaceId)
      .flatMap((exportRecord) => exportRecord.recordIds)
  );

  return {
    rawCount: rawLeads.length,
    normalizedCount: normalizedRecords.length,
    stagedCount: normalizedRecords.length || contacts.length,
    companyCount: companies.length,
    contactCount: contacts.length,
    verifiedCount: verifiedContacts.length || verifiedRecords.length,
    verifiedRate: nonSuppressedContacts.length ? Math.round((verifiedContacts.length / nonSuppressedContacts.length) * 100) : 0,
    riskCount: countByGrade(contacts, "C") || countRecordsByGrade(normalizedRecords, "C"),
    invalidCount: countByGrade(contacts, "D") || countRecordsByGrade(normalizedRecords, "D"),
    suppressedCount: contacts.filter((contact) => contact.isSuppressed || contact.grade === "S").length,
    needsReviewCount: normalizedRecords.filter(needsOperatorReview).length,
    exportReadyCount: verifiedContacts.length || verifiedRecords.length,
    readyForSdrCount: assignmentReadyContacts.length,
    phoneReadyCount: normalizedRecords.filter((record) => Boolean(record.phone)).length || contacts.filter((contact) => Boolean(contact.phone)).length,
    enrichedCount: contacts.filter((contact) => (contact.enrichmentCoverage ?? 0) > 0).length,
    exportedCount: exportedIds.size,
    crmHandoffCount: state.sdrAssignments.filter((assignment) => assignment.workspaceId === workspaceId).length,
    activeJobCount: leadJobs.filter((job) => job.status !== "Completed").length,
    queuedJobCount: leadJobs.filter((job) => job.status === "Queued").length,
    runningJobCount: leadJobs.filter((job) => job.status === "Running").length,
    completedJobCount: leadJobs.filter((job) => job.status === "Completed").length,
    totalJobCount: leadJobs.length,
    totalActualCost: leadJobs.reduce((total, job) => total + job.actualCost, 0),
    estimatedCostCents: leadJobs.reduce((total, job) => total + (job.estimatedCostCents ?? 0), 0),
    duplicatePairCount: openMatches.length,
    actionableDuplicatePairCount: actionableMatches.length,
    duplicateGroupCount: duplicateGroups.length,
    hiddenDuplicatePairCount: Math.max(openMatches.length - actionableMatches.length, 0),
    personalEmailCount:
      normalizedRecords.filter((record) => isPersonalEmailDomain(domainFromEmail(record.email))).length ||
      contacts.filter((contact) => isPersonalEmailDomain(domainFromEmail(contact.email))).length,
    missingCompanyCount:
      normalizedRecords.filter((record) => isPlaceholderCompanyName(record.companyName)).length ||
      contacts.filter((contact) => contactQualityBlockers(state, contact).includes("Missing company")).length,
    missingContactCount:
      normalizedRecords.filter((record) => isPlaceholderPersonName(record.contactName)).length ||
      contacts.filter((contact) => contactQualityBlockers(state, contact).includes("Missing contact name")).length,
    missingPhoneCount: normalizedRecords.filter((record) => !record.phone).length || contacts.filter((contact) => !contact.phone).length,
    assignmentBlockedCount: contacts.length - assignmentReadyContacts.length
  };
}

export function groupOpenDedupeMatches(state: AppState, workspaceId: string): DedupeGroup[] {
  const groups = new Map<string, DedupeGroup>();
  const openMatches = state.dedupeMatches
    .filter((match) => match.workspaceId === workspaceId && match.status === "Open")
    .filter((match) => isActionableDedupeMatch(state, match))
    .sort((a, b) => b.confidence - a.confidence || a.detectedAt.localeCompare(b.detectedAt));

  for (const match of openMatches) {
    const primary = entitySummary(state, match.objectType, match.primaryId);
    const duplicate = entitySummary(state, match.objectType, match.duplicateId);
    const matchType = matchTypeForReason(match.reason);
    const key = `${match.objectType}:${match.primaryId}:${matchType}`;
    const existing = groups.get(key);

    if (existing) {
      existing.matchIds.push(match.id);
      existing.duplicateIds.push(match.duplicateId);
      existing.duplicateLabels.push(duplicate.label);
      existing.confidence = Math.max(existing.confidence, match.confidence);
      continue;
    }

    groups.set(key, {
      id: key,
      objectType: match.objectType,
      primaryId: match.primaryId,
      primaryLabel: primary.label,
      primaryDetail: primary.detail,
      duplicateIds: [match.duplicateId],
      duplicateLabels: [duplicate.label],
      matchIds: [match.id],
      reason: match.reason,
      confidence: match.confidence,
      matchType
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.confidence - a.confidence || b.duplicateIds.length - a.duplicateIds.length
  );
}

export function leadReviewReason(record: NormalizedRecord) {
  if (record.status === "Suppressed" || record.grade === "S") return "Suppressed";
  if (record.grade === "D") return "Invalid email";
  if (isPersonalEmailDomain(domainFromEmail(record.email))) return "Personal email domain";
  if (isPlaceholderCompanyName(record.companyName)) return "Missing company";
  if (isPlaceholderPersonName(record.contactName)) return "Missing contact name";
  if (record.grade === "C") return "Needs enrichment";
  if (!record.phone) return "Missing phone";
  return "Ready";
}

export function needsOperatorReview(record: NormalizedRecord) {
  return (
    record.status === "In review" ||
    record.status === "Needs enrichment" ||
    record.grade === "C" ||
    record.grade === "D" ||
    isPlaceholderPersonName(record.contactName) ||
    isPlaceholderCompanyName(record.companyName) ||
    isPersonalEmailDomain(domainFromEmail(record.email))
  );
}

export function isStrictlyVerifiedContact(contact: Pick<Contact, "grade" | "isSuppressed">) {
  return isExportableGrade(contact.grade) && !contact.isSuppressed;
}

export function isStrictlyVerifiedRecord(record: Pick<NormalizedRecord, "grade" | "status">) {
  return isExportableGrade(record.grade) && record.status !== "Suppressed";
}

export function normalizedRecordQualityBlockers(record: NormalizedRecord) {
  const blockers: string[] = [];
  if (record.status === "Suppressed" || record.grade === "S") blockers.push("Suppressed");
  if (record.grade === "D") blockers.push("Invalid email");
  if (isPersonalEmailDomain(domainFromEmail(record.email))) blockers.push("Personal email domain");
  if (isPlaceholderCompanyName(record.companyName)) blockers.push("Missing company");
  if (isPlaceholderPersonName(record.contactName)) blockers.push("Missing contact name");
  if (record.grade === "C") blockers.push("Needs enrichment");
  if (!record.phone) blockers.push("Missing phone");
  return blockers;
}

export function contactQualityBlockers(state: AppState, contact: Contact, requiredFields: string[] = []) {
  const blockers: string[] = [];
  const required = requiredFields.map((field) => field.toLowerCase());
  const company = state.companies.find((item) => item.id === contact.companyId && item.workspaceId === contact.workspaceId);

  if (contact.isSuppressed || contact.grade === "S" || contact.priority === "S") blockers.push("Suppressed");
  if (contact.grade === "D") blockers.push("Invalid email");
  if (contact.grade === "C") blockers.push("Needs enrichment");
  if (!isExportableGrade(contact.grade)) blockers.push("Not A/B verified");
  if (!contact.email) blockers.push("Missing email");
  if (required.some((field) => field.includes("phone")) && !contact.phone) blockers.push("Missing phone");
  if (isPersonalEmailDomain(domainFromEmail(contact.email))) blockers.push("Personal email domain");
  if (!isMeaningfulPersonName(contact.name)) blockers.push("Missing contact name");
  if (!company || !isMeaningfulCompanyName(company.name)) blockers.push("Missing company");

  return Array.from(new Set(blockers));
}

export function isSdrReadyContact(state: AppState, contact: Contact, requiredFields: string[] = []) {
  return contactQualityBlockers(state, contact, requiredFields).length === 0;
}

export function displayContactLabel(contact: Pick<Contact, "name" | "email"> | undefined, fallback = "Unknown contact") {
  if (!contact) return fallback;
  if (isMeaningfulPersonName(contact.name)) return contact.name;
  return contact.email || fallback;
}

function entitySummary(state: AppState, objectType: DedupeMatch["objectType"], id: string) {
  if (objectType === "company") {
    const company = state.companies.find((item) => item.id === id);
    return {
      label: company?.name ?? id,
      detail: [company?.domain, company?.city, company?.state].filter(Boolean).join(" | ") || "No company detail"
    };
  }

  const contact = state.contacts.find((item) => item.id === id);
  const company = state.companies.find((item) => item.id === contact?.companyId);
  return {
    label: displayContactLabel(contact, id),
    detail: [contact?.email, company?.name].filter(Boolean).join(" | ") || "No contact detail"
  };
}

function matchTypeForReason(reason: string) {
  const normalized = reason.toLowerCase();
  if (normalized.includes("email")) return "Exact email";
  if (normalized.includes("domain")) return "Exact domain";
  if (normalized.includes("location")) return "Company + location";
  if (normalized.includes("fuzzy")) return "Fuzzy name";
  return "Name + company";
}

function countByGrade(contacts: AppState["contacts"], grade: LeadGrade) {
  return contacts.filter((contact) => contact.grade === grade).length;
}

function countRecordsByGrade(records: NormalizedRecord[], grade: LeadGrade) {
  return records.filter((record) => record.grade === grade).length;
}

function isExportableGrade(grade: LeadGrade) {
  return grade === "A" || grade === "B";
}

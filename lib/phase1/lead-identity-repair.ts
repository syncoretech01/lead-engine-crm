import {
  displayNameFromEmail,
  domainFromEmail,
  isEmailLikeValue,
  isMeaningfulPersonName,
  isPersonalEmailDomain,
  isPlaceholderCompanyName,
  isPlaceholderPersonName
} from "@/lib/phase1/lead-data-quality";
import { normalizeCompanyName, normalizeDomain } from "@/lib/phase1/normalization";
import type { AppState, Contact, NormalizedRecord, RawLead } from "@/lib/phase1/types";

export type LeadIdentityRepairResult = {
  normalizedRecordsRepaired: number;
  contactsRepaired: number;
  companiesRepaired: number;
  sharedEmailsCleared: number;
};

export function repairStagedLeadIdentities(state: AppState, workspaceId: string): LeadIdentityRepairResult {
  const records = state.normalizedRecords.filter((record) => record.workspaceId === workspaceId);
  const rawById = new Map(state.rawLeads.filter((lead) => lead.workspaceId === workspaceId).map((lead) => [lead.id, lead]));
  const sharedEmails = sharedWorkspaceEmails(records);
  const emailCounts = countRecordEmails(records);
  const contactsByEmail = contactsByEmailForWorkspace(state, workspaceId);
  const result: LeadIdentityRepairResult = {
    normalizedRecordsRepaired: 0,
    contactsRepaired: 0,
    companiesRepaired: 0,
    sharedEmailsCleared: 0
  };

  for (const record of records) {
    const rawLead = rawById.get(record.rawLeadId);
    const oldContactName = record.contactName;
    const oldCompanyName = record.companyName;
    const sharedEmail = sharedEmails.has(record.email);
    const identity = repairedIdentity(record, rawLead, sharedEmail);
    let recordChanged = false;

    if (identity.contactName && identity.contactName !== record.contactName) {
      record.contactName = identity.contactName;
      recordChanged = true;
    }

    if (identity.companyName && identity.companyName !== record.companyName) {
      record.companyName = identity.companyName;
      record.normalizedCompanyName = normalizeCompanyName(identity.companyName);
      recordChanged = true;
    }

    if (sharedEmail && record.email) {
      record.email = "";
      record.grade = "D";
      record.status = "In review";
      record.priority = "P4";
      record.verification = "Shared import email ignored; lead email missing";
      result.sharedEmailsCleared += 1;
      recordChanged = true;
    }

    if (recordChanged) {
      result.normalizedRecordsRepaired += 1;
    }

    if (!identity.contactName) {
      continue;
    }

    const contact = record.email && emailCounts.get(record.email) === 1 ? contactsByEmail.get(record.email) : undefined;
    if (!contact) {
      continue;
    }

    const contactChanged = repairContact(contact, identity.contactName, oldContactName);
    if (contactChanged) {
      result.contactsRepaired += 1;
    }

    const companyChanged = repairContactCompany(state, contact, oldCompanyName, identity.companyName);
    if (companyChanged) {
      result.companiesRepaired += 1;
    }
  }

  return result;
}

function repairedIdentity(record: NormalizedRecord, rawLead: RawLead | undefined, sharedEmail: boolean) {
  const rawPersonName = rawLead ? personNameFromRawPayload(rawLead.sourcePayload) : "";
  const sharedOrPersonalEmail = sharedEmail || isPersonalEmailDomain(domainFromEmail(record.email));
  const hasBusinessDomain = Boolean(record.domain && !isPersonalEmailDomain(normalizeDomain(record.domain)));
  const canPromoteCompany =
    sharedOrPersonalEmail &&
    !hasBusinessDomain &&
    isMeaningfulPersonName(record.companyName) &&
    !isPlaceholderCompanyName(record.companyName);
  const contactName = isUsableContactName(record.contactName)
    ? record.contactName
    : rawPersonName || (canPromoteCompany ? record.companyName : displayNameFromEmail(record.email));

  return {
    contactName,
    companyName: canPromoteCompany && contactName === record.companyName ? "Individual contact" : record.companyName
  };
}

function repairContact(contact: Contact, contactName: string, oldContactName: string) {
  if (!contactName || isUsableContactName(contact.name)) {
    return false;
  }

  if (contact.name && contact.name !== oldContactName && contact.name !== contact.email && !isPlaceholderPersonName(contact.name)) {
    return false;
  }

  contact.name = contactName;
  contact.updatedAt = new Date().toISOString();
  return true;
}

function repairContactCompany(
  state: AppState,
  contact: Contact,
  oldCompanyName: string,
  companyName: string
) {
  if (!companyName || companyName !== "Individual contact") {
    return false;
  }

  const company = state.companies.find((item) => item.id === contact.companyId && item.workspaceId === contact.workspaceId);
  if (!company) {
    return false;
  }

  if (company.name !== oldCompanyName && !isPlaceholderCompanyName(company.name)) {
    return false;
  }

  company.name = companyName;
  company.normalizedName = normalizeCompanyName(companyName);
  if (isPersonalEmailDomain(normalizeDomain(company.domain))) {
    company.domain = "";
  }
  if (isPersonalEmailDomain(domainFromWebsite(company.website))) {
    company.website = "";
  }
  company.updatedAt = new Date().toISOString();
  return true;
}

function personNameFromRawPayload(payload: Record<string, string>) {
  const direct = readMapped(payload, [
    "contact",
    "contact name",
    "full name",
    "person",
    "person name",
    "lead name",
    "customer name",
    "name"
  ]);
  if (isMeaningfulPersonName(direct)) {
    return direct;
  }

  const firstName = readMapped(payload, ["first name", "firstname", "first"]);
  const lastName = readMapped(payload, ["last name", "lastname", "last", "surname"]);
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return isMeaningfulPersonName(combined) ? combined : "";
}

function sharedWorkspaceEmails(records: NormalizedRecord[]) {
  const counts = countRecordEmails(records);
  return new Set(
    Array.from(counts.entries())
      .filter(([email, count]) => isPersonalEmailDomain(domainFromEmail(email)) && count >= 3 && count / Math.max(records.length, 1) >= 0.5)
      .map(([email]) => email)
  );
}

function countRecordEmails(records: NormalizedRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record.email) continue;
    const email = record.email.toLowerCase();
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  return counts;
}

function contactsByEmailForWorkspace(state: AppState, workspaceId: string) {
  const contactsByEmail = new Map<string, Contact>();
  for (const contact of state.contacts) {
    if (contact.workspaceId !== workspaceId || !contact.email) continue;
    contactsByEmail.set(contact.email.toLowerCase(), contact);
  }
  return contactsByEmail;
}

function isUsableContactName(value: string) {
  return isMeaningfulPersonName(value) && !isEmailLikeValue(value) && !isPlaceholderPersonName(value);
}

function readMapped(payload: Record<string, string>, headers: string[]) {
  const normalizedPayload = new Map(
    Object.entries(payload).map(([key, value]) => [normalizeHeader(key), value.trim()])
  );

  for (const header of headers) {
    const value = normalizedPayload.get(normalizeHeader(header));
    if (value) {
      return value;
    }
  }

  return "";
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
}

function domainFromWebsite(value: string) {
  return normalizeDomain(value);
}

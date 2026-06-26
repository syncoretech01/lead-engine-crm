import { randomUUID } from "node:crypto";
import { defaultContactCompliance, suppressContact } from "@/lib/phase1/compliance";
import {
  displayNameFromEmail,
  domainFromEmail,
  isPersonalEmailDomain,
  isPlaceholderCompanyName
} from "@/lib/phase1/lead-data-quality";
import type {
  AppState,
  Company,
  Contact,
  CustomField,
  CsvImportMapping,
  LeadGrade,
  LeadJob,
  LeadStatus,
  NormalizedRecord,
  Priority,
  RawLead
} from "@/lib/phase1/types";

const roleEmailPrefixes = new Set(["info", "sales", "support", "admin", "hello", "contact"]);

export function normalizeImportedRows({
  state,
  workspaceId,
  leadJob,
  rawLeads,
  mapping
}: {
  state: AppState;
  workspaceId: string;
  leadJob: LeadJob;
  rawLeads: RawLead[];
  mapping: CsvImportMapping;
}) {
  let duplicates = 0;
  let suppressed = 0;
  let companiesCreated = 0;
  let contactsCreated = 0;
  const now = new Date().toISOString();

  for (const rawLead of rawLeads) {
    const payload = rawLead.sourcePayload;
    // Per-row lead source: prefer the mapped CSV column (or common header names),
    // falling back to the import-wide source label already on the raw lead. This
    // flows into company/contact sourceLineage and the normalized record below.
    const mappedSource = readMapped(payload, mapping.source, ["source", "lead source", "channel"]);
    if (mappedSource) {
      rawLead.source = mappedSource;
    }
    const mappedCompanyName = readMapped(payload, mapping.companyName, [
      "company",
      "company name",
      "account",
      "business",
      "business name"
    ]);
    const contactName = readPersonName(payload, mapping.contactName);
    const title = readMapped(payload, mapping.title, ["title", "job title", "role"]);
    const email = normalizeEmail(readMapped(payload, mapping.email, ["email", "email address", "work email"]));
    const phone = normalizePhone(readMapped(payload, mapping.phone, ["phone", "phone number", "mobile"]));
    const website = normalizeWebsite(readMapped(payload, mapping.website, ["website", "url", "company website"]));
    const emailDomain = domainFromEmail(email);
    const personalEmailDomain = isPersonalEmailDomain(emailDomain);
    const domain = normalizeDomain(
      readMapped(payload, mapping.domain, ["domain", "root domain"]) ||
      website ||
      (personalEmailDomain ? "" : emailDomain)
    );
    const companyName = resolveCompanyName({
      mappedCompanyName,
      contactName,
      domain,
      personalEmailDomain
    });
    const city = readMapped(payload, mapping.city, ["city"]);
    const stateValue = readMapped(payload, mapping.state, ["state", "region", "province"]);
    const country = readMapped(payload, mapping.country, ["country"]) || "US";
    const industry = readMapped(payload, mapping.industry, ["industry", "category", "vertical"]);
    const normalizedCompanyName = normalizeCompanyName(companyName);
    const suppressionReason = findSuppressionReason(state, workspaceId, { email, phone, domain });
    const isSuppressed = Boolean(suppressionReason);
    const grade = suppressionReason ? "S" : gradeEmail(email, { personalEmailDomain });
    const score = scoreLead({ email, phone, domain, title, industry, grade, personalEmailDomain });
    const priority = priorityForScore(score, grade);
    const status = statusForGrade(grade);
    const segment = segmentForLead({ industry, title, domain, grade });
    const verification = verificationForGrade(grade, suppressionReason);

    let company = findMatchingCompany(state, workspaceId, { domain, normalizedCompanyName, city, state: stateValue });
    let duplicateCompanyId: string | undefined;

    if (company) {
      duplicateCompanyId = company.id;
      duplicates += 1;
      mergeCompany(company, {
        name: companyName,
        domain,
        website,
        phone,
        industry,
        city,
        state: stateValue,
        country,
        source: rawLead.source,
        score,
        priority
      });
    } else {
      company = {
        id: `company-${randomUUID()}`,
        workspaceId,
        name: companyName || domain || "Unknown company",
        normalizedName: normalizedCompanyName,
        domain,
        website,
        phone,
        industry,
        city,
        state: stateValue,
        country,
        sourceLineage: [rawLead.source],
        score,
        priority,
        createdAt: now,
        updatedAt: now
      };
      state.companies.push(company);
      companiesCreated += 1;
    }

    let contact = findMatchingContact(state, workspaceId, {
      companyId: company.id,
      email,
      contactName,
      domain
    });
    let duplicateContactId: string | undefined;

    if (contact) {
      duplicateContactId = contact.id;
      duplicates += 1;
      mergeContact(contact, {
        title,
        phone,
        source: rawLead.source,
        grade,
        score,
        priority,
        status,
        segment,
        verification,
        isSuppressed
      });
    } else {
      contact = {
        id: `contact-${randomUUID()}`,
        workspaceId,
        companyId: company.id,
        name: contactName || "Unknown contact",
        title,
        email,
        phone,
        grade,
        score,
        priority,
        status,
        segment,
        owner: ownerForPriority(priority),
        sourceLineage: [rawLead.source],
        verification,
        ...defaultContactCompliance({
          source: suppressionReason ?? rawLead.source,
          suppressed: isSuppressed,
          capturedAt: now
        }),
        isSuppressed,
        createdAt: now,
        updatedAt: now
      };
      state.contacts.push(contact);
      contactsCreated += 1;
    }

    if (suppressionReason) {
      suppressed += 1;
      rawLead.processingStatus = "Suppressed";
    } else {
      rawLead.processingStatus = "Normalized";
    }

    // Custom columns → contact custom fields (the field is created on first use
    // and reused thereafter, so the value shows on the contact record).
    for (const custom of mapping.customColumns ?? []) {
      const value = readMapped(payload, custom.column, []);
      if (!value) continue;
      const field = ensureContactCustomField(state, workspaceId, custom.fieldName, now);
      setContactCustomFieldValue(state, workspaceId, field.id, contact.id, value, now);
    }

    const normalizedRecord: NormalizedRecord = {
      id: `norm-${randomUUID()}`,
      workspaceId,
      rawLeadId: rawLead.id,
      leadJobId: leadJob.id,
      companyName: companyName || company.name,
      normalizedCompanyName,
      contactName: contactName || contact.name,
      title,
      email,
      phone,
      domain,
      website,
      city,
      state: stateValue,
      country,
      industry,
      source: rawLead.source,
      grade,
      score,
      priority,
      status,
      segment,
      owner: contact.owner,
      verification,
      duplicateCompanyId,
      duplicateContactId,
      suppressionReason,
      normalizedAt: now
    };

    state.normalizedRecords.push(normalizedRecord);
  }

  leadJob.status = "Completed";
  leadJob.progress = 100;
  leadJob.raw = rawLeads.length;
  leadJob.normalized = rawLeads.length - suppressed;
  leadJob.duplicates = duplicates;
  leadJob.suppressed = suppressed;
  leadJob.verified = state.normalizedRecords.filter(
    (record) => record.leadJobId === leadJob.id && (record.grade === "A" || record.grade === "B")
  ).length;
  leadJob.enriched = 0;
  leadJob.exported = 0;
  leadJob.pushedToCrm = contactsCreated;
  leadJob.actualCost = 0;
  leadJob.actualCostCents = 0;
  leadJob.actualCostSource = "Actual";
  leadJob.eta = "Done";
  leadJob.errorSummary = "No open failures";
  leadJob.completedAt = now;
  leadJob.updatedAt = now;

  return {
    raw: rawLeads.length,
    normalized: leadJob.normalized,
    duplicates,
    suppressed,
    companies: companiesCreated,
    contacts: contactsCreated
  };
}

function ensureContactCustomField(
  state: AppState,
  workspaceId: string,
  fieldName: string,
  now: string
): CustomField {
  const name = fieldName.trim();
  const existing = state.customFields.find(
    (field) =>
      field.workspaceId === workspaceId &&
      field.objectType === "contact" &&
      field.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    return existing;
  }

  const field: CustomField = {
    id: `field-${randomUUID()}`,
    workspaceId,
    objectType: "contact",
    name,
    fieldType: "text",
    createdAt: now
  };
  state.customFields.push(field);
  return field;
}

function setContactCustomFieldValue(
  state: AppState,
  workspaceId: string,
  customFieldId: string,
  objectId: string,
  value: string,
  now: string
) {
  const existing = state.customFieldValues.find(
    (item) => item.workspaceId === workspaceId && item.customFieldId === customFieldId && item.objectId === objectId
  );
  if (existing) {
    existing.value = value;
    existing.updatedAt = now;
    return;
  }

  state.customFieldValues.push({
    id: `cfv-${randomUUID()}`,
    workspaceId,
    customFieldId,
    objectId,
    value,
    updatedAt: now
  });
}

function readMapped(payload: Record<string, string>, preferred: string | undefined, fallbacks: string[]) {
  const normalizedPayload = new Map(
    Object.entries(payload).map(([key, value]) => [normalizeHeader(key), value.trim()])
  );

  if (preferred) {
    const preferredValue = normalizedPayload.get(normalizeHeader(preferred));
    if (preferredValue) {
      return preferredValue;
    }
  }

  for (const fallback of fallbacks) {
    const value = normalizedPayload.get(normalizeHeader(fallback));
    if (value) {
      return value;
    }
  }

  return "";
}

function readPersonName(payload: Record<string, string>, preferred: string | undefined) {
  const mapped = readMapped(payload, preferred, [
    "contact",
    "contact name",
    "name",
    "full name",
    "person",
    "person name",
    "lead name",
    "customer name"
  ]);
  if (mapped) {
    return mapped;
  }

  const firstName = readMapped(payload, undefined, ["first name", "firstname", "first"]);
  const lastName = readMapped(payload, undefined, ["last name", "lastname", "last", "surname"]);
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (combined) {
    return combined;
  }

  const email = normalizeEmail(readMapped(payload, undefined, ["email", "email address", "work email"]));
  return displayNameFromEmail(email);
}

function resolveCompanyName({
  mappedCompanyName,
  contactName,
  domain,
  personalEmailDomain
}: {
  mappedCompanyName: string;
  contactName: string;
  domain: string;
  personalEmailDomain: boolean;
}) {
  const companyLooksLikePerson =
    personalEmailDomain &&
    mappedCompanyName &&
    contactName &&
    mappedCompanyName.trim().toLowerCase() === contactName.trim().toLowerCase();

  if (mappedCompanyName && !companyLooksLikePerson && !isPlaceholderCompanyName(mappedCompanyName)) {
    return mappedCompanyName;
  }

  if (domain) {
    return companyNameFromDomain(domain);
  }

  return personalEmailDomain ? "Individual contact" : "Unknown company";
}

function companyNameFromDomain(domain: string) {
  const root = normalizeDomain(domain).split(".")[0] ?? "";
  if (!root) {
    return "Unknown company";
  }

  return root
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return withoutProtocol.split("/")[0].split("?")[0];
}

export function normalizeWebsite(value: string) {
  const domain = normalizeDomain(value);
  return domain ? `https://${domain}` : "";
}

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  return value.trim();
}

export function normalizeCompanyName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|corp|corporation|co|company)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function gradeEmail(email: string, options: { personalEmailDomain?: boolean } = {}): LeadGrade {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "D";
  }

  if (options.personalEmailDomain) {
    return "C";
  }

  const prefix = email.split("@")[0];
  if (roleEmailPrefixes.has(prefix)) {
    return "C";
  }

  return email.includes(".") ? "A" : "B";
}

function scoreLead({
  email,
  phone,
  domain,
  title,
  industry,
  grade,
  personalEmailDomain
}: {
  email: string;
  phone: string;
  domain: string;
  title: string;
  industry: string;
  grade: LeadGrade;
  personalEmailDomain?: boolean;
}) {
  if (grade === "S") {
    return 0;
  }

  let score = 25;
  if (grade === "A") score += 30;
  if (grade === "B") score += 24;
  if (grade === "C") score += 12;
  if (email) score += 8;
  if (phone) score += 8;
  if (domain) score += 8;
  if (title) score += 8;
  if (industry) score += 6;
  if (personalEmailDomain) score -= 12;

  return Math.max(0, Math.min(score, 100));
}

function priorityForScore(score: number, grade: LeadGrade): Priority {
  if (grade === "S") return "S";
  if (score >= 80) return "P1";
  if (score >= 65) return "P2";
  if (score >= 50) return "P3";
  return "P4";
}

function statusForGrade(grade: LeadGrade): LeadStatus {
  if (grade === "S") return "Suppressed";
  if (grade === "A" || grade === "B") return "Ready for SDR";
  if (grade === "C") return "Needs enrichment";
  return "In review";
}

function ownerForPriority(priority: Priority) {
  if (priority === "P1") return "Ari Patel";
  if (priority === "P2") return "Mina Brooks";
  if (priority === "S") return "Blocked";
  return "Unassigned";
}

function segmentForLead({ industry, title, domain, grade }: { industry: string; title: string; domain: string; grade: LeadGrade }) {
  const haystack = `${industry} ${title} ${domain}`.toLowerCase();
  if (grade === "S") return "Suppressed";
  if (haystack.includes("shopify") || haystack.includes("ecommerce") || haystack.includes("retail")) {
    return "Ecommerce";
  }
  if (haystack.includes("dealer") || haystack.includes("auto")) {
    return "Automotive local";
  }
  if (haystack.includes("architect") || haystack.includes("professional")) {
    return "Professional services";
  }
  if (title.toLowerCase().includes("owner") || title.toLowerCase().includes("founder")) {
    return "Owner-led business";
  }
  return "General outbound";
}

function verificationForGrade(grade: LeadGrade, suppressionReason?: string) {
  if (suppressionReason) return `Suppressed: ${suppressionReason}`;
  if (grade === "A") return "Email format valid; direct mailbox candidate";
  if (grade === "B") return "Email format valid; standard risk";
  if (grade === "C") return "Role or personal email; enrichment recommended";
  return "Invalid or missing email; do not export as verified";
}

function findSuppressionReason(
  state: AppState,
  workspaceId: string,
  values: { email: string; phone: string; domain: string }
) {
  const match = state.suppressionRecords.find((record) => {
    if (record.workspaceId !== workspaceId) {
      return false;
    }

    return (
      (values.email && record.email?.toLowerCase() === values.email.toLowerCase()) ||
      (values.phone && record.phone === values.phone) ||
      (values.domain && record.domain?.toLowerCase() === values.domain.toLowerCase())
    );
  });

  return match?.reason;
}

function findMatchingCompany(
  state: AppState,
  workspaceId: string,
  values: { domain: string; normalizedCompanyName: string; city: string; state: string }
) {
  return state.companies.find((company) => {
    if (company.workspaceId !== workspaceId) {
      return false;
    }

    if (values.domain && company.domain === values.domain) {
      return true;
    }

    return (
      values.normalizedCompanyName &&
      company.normalizedName === values.normalizedCompanyName &&
      company.city.toLowerCase() === values.city.toLowerCase() &&
      company.state.toLowerCase() === values.state.toLowerCase()
    );
  });
}

function findMatchingContact(
  state: AppState,
  workspaceId: string,
  values: { companyId: string; email: string; contactName: string; domain: string }
) {
  return state.contacts.find((contact) => {
    if (contact.workspaceId !== workspaceId) {
      return false;
    }

    if (values.email && contact.email === values.email) {
      return true;
    }

    return (
      values.contactName &&
      contact.companyId === values.companyId &&
      contact.name.toLowerCase() === values.contactName.toLowerCase()
    );
  });
}

function mergeCompany(
  company: Company,
  values: {
    name: string;
    domain: string;
    website: string;
    phone: string;
    industry: string;
    city: string;
    state: string;
    country: string;
    source: string;
    score: number;
    priority: Priority;
  }
) {
  company.name = company.name || values.name;
  company.domain = company.domain || values.domain;
  company.website = company.website || values.website;
  company.phone = company.phone || values.phone;
  company.industry = company.industry || values.industry;
  company.city = company.city || values.city;
  company.state = company.state || values.state;
  company.country = company.country || values.country;
  company.score = Math.max(company.score, values.score);
  company.priority = company.score >= 80 ? "P1" : company.score >= 65 ? "P2" : company.score >= 50 ? "P3" : "P4";
  company.sourceLineage = Array.from(new Set([...company.sourceLineage, values.source]));
  company.updatedAt = new Date().toISOString();
}

function mergeContact(
  contact: Contact,
  values: {
    title: string;
    phone: string;
    source: string;
    grade: LeadGrade;
    score: number;
    priority: Priority;
    status: LeadStatus;
    segment: string;
    verification: string;
    isSuppressed: boolean;
  }
) {
  contact.title = contact.title || values.title;
  contact.phone = contact.phone || values.phone;
  contact.grade = higherGrade(contact.grade, values.grade);
  contact.score = Math.max(contact.score, values.score);
  contact.priority = contact.isSuppressed || values.isSuppressed ? "S" : values.priority;
  contact.status = contact.isSuppressed || values.isSuppressed ? "Suppressed" : values.status;
  contact.segment = values.segment || contact.segment;
  contact.verification = values.verification;
  contact.isSuppressed = contact.isSuppressed || values.isSuppressed;
  if (values.isSuppressed) {
    suppressContact(contact, values.verification.replace(/^Suppressed:\s*/i, "") || "Suppression match");
  } else if (!contact.lawfulBasis || !contact.consentStatus || !contact.consentSource) {
    Object.assign(contact, defaultContactCompliance({ source: values.source, capturedAt: contact.updatedAt }));
  }
  contact.sourceLineage = Array.from(new Set([...contact.sourceLineage, values.source]));
  contact.updatedAt = new Date().toISOString();
}

function higherGrade(current: LeadGrade, incoming: LeadGrade): LeadGrade {
  const rank: Record<LeadGrade, number> = { A: 5, B: 4, C: 3, D: 2, S: 1 };
  return rank[incoming] > rank[current] ? incoming : current;
}

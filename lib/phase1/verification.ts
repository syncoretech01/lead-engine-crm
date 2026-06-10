import { randomUUID } from "node:crypto";
import { defaultContactCompliance, suppressContact } from "@/lib/phase1/compliance";
import type {
  AppState,
  Contact,
  LeadGrade,
  LeadStatus,
  Priority,
  VerificationResult
} from "@/lib/phase1/types";
import { normalizeDomain, normalizePhone } from "@/lib/phase1/normalization";

const roleEmailPrefixes = new Set(["info", "sales", "support", "admin", "hello", "contact", "team"]);
const disposableDomains = new Set(["mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com"]);
const catchAllHeuristicDomains = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"]);

export function runWorkspaceVerification(state: AppState, workspaceId: string) {
  let verified = 0;
  let risky = 0;
  let invalid = 0;
  let suppressed = 0;

  for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId)) {
    const result = verifyContact(state, contact);

    if (result.grade === "S") suppressed += 1;
    else if (result.grade === "D") invalid += 1;
    else if (result.grade === "C") risky += 1;
    else verified += 1;
  }

  return { verified, risky, invalid, suppressed };
}

export function verifyContact(state: AppState, contact: Contact) {
  const now = new Date();
  const company = state.companies.find((item) => item.id === contact.companyId);
  const email = contact.email.trim().toLowerCase();
  const emailDomain = normalizeDomain(email.split("@")[1] ?? "");
  const companyDomain = normalizeDomain(company?.domain ?? "");
  const phone = normalizePhone(contact.phone);
  const phoneStatus = phoneStatusFor(phone);
  const suppressionReason = contact.doNotContact
    ? contact.consentSource || "Do not contact"
    : findSuppressionReason(state, contact.workspaceId, {
        email,
        phone,
        domain: emailDomain || companyDomain
      });
  const syntaxValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const domainStatus = emailDomain ? "Mail-capable" : syntaxValid ? "Invalid" : "Missing";
  const prefix = email.split("@")[0] ?? "";
  const roleEmail = roleEmailPrefixes.has(prefix);
  const disposable = disposableDomains.has(emailDomain);
  const catchAll = catchAllHeuristicDomains.has(emailDomain);
  const domainMatchesCompany = Boolean(emailDomain && companyDomain && emailDomain === companyDomain);
  const checks: string[] = [];

  if (syntaxValid) checks.push("syntax_valid");
  else checks.push("syntax_invalid");
  if (emailDomain) checks.push("domain_present");
  if (domainMatchesCompany) checks.push("domain_matches_company");
  if (roleEmail) checks.push("role_email");
  if (disposable) checks.push("disposable_domain");
  if (catchAll) checks.push("catch_all_heuristic");
  if (phoneStatus === "Valid") checks.push("phone_valid");
  if (suppressionReason) checks.push("suppressed");

  const grade = gradeForVerification({
    syntaxValid,
    domainStatus,
    roleEmail,
    disposable,
    catchAll,
    domainMatchesCompany,
    suppressionReason
  });
  const emailStatus = emailStatusFor({ grade, roleEmail, catchAll, suppressionReason });
  const score = scoreForVerification(contact.score, {
    grade,
    phoneStatus,
    domainMatchesCompany,
    roleEmail,
    catchAll
  });
  const status = statusForGrade(grade);
  const verification = messageForVerification(grade, {
    suppressionReason,
    roleEmail,
    catchAll,
    disposable,
    domainMatchesCompany,
    phoneStatus
  });
  const result: VerificationResult = {
    id: `verification-${randomUUID()}`,
    workspaceId: contact.workspaceId,
    contactId: contact.id,
    provider: "Syncore Local",
    email,
    phone,
    grade,
    emailStatus,
    domainStatus,
    phoneStatus,
    roleEmail,
    disposable,
    catchAll,
    suppressionReason,
    checks,
    rawResponse: {
      syntaxValid,
      domainMatchesCompany,
      emailDomain,
      companyDomain,
      roleEmail,
      disposable,
      catchAll,
      phoneStatus,
      suppressionReason,
      checks
    },
    verifiedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
  };

  state.verificationResults.unshift(result);

  contact.email = email;
  contact.phone = phone;
  contact.grade = grade;
  contact.score = score;
  contact.priority = priorityForScore(score, grade);
  contact.status = status;
  contact.verification = verification;
  contact.isSuppressed = Boolean(suppressionReason);
  if (suppressionReason) {
    suppressContact(contact, suppressionReason, now.toISOString());
  } else if (!contact.lawfulBasis || !contact.consentStatus || !contact.consentSource) {
    Object.assign(contact, defaultContactCompliance({ source: contact.sourceLineage[0] ?? "Verification", capturedAt: now.toISOString() }));
  }
  contact.updatedAt = now.toISOString();

  for (const record of state.normalizedRecords.filter(
    (item) =>
      item.workspaceId === contact.workspaceId &&
      (item.email.toLowerCase() === email || item.contactName.toLowerCase() === contact.name.toLowerCase())
  )) {
    record.email = email;
    record.phone = phone;
    record.grade = grade;
    record.score = score;
    record.priority = contact.priority;
    record.status = status;
    record.verification = verification;
    record.suppressionReason = suppressionReason;
  }

  return result;
}

export function latestVerificationForContact(state: AppState, contactId: string) {
  return state.verificationResults
    .filter((result) => result.contactId === contactId)
    .sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt))[0];
}

function gradeForVerification({
  syntaxValid,
  domainStatus,
  roleEmail,
  disposable,
  catchAll,
  domainMatchesCompany,
  suppressionReason
}: {
  syntaxValid: boolean;
  domainStatus: VerificationResult["domainStatus"];
  roleEmail: boolean;
  disposable: boolean;
  catchAll: boolean;
  domainMatchesCompany: boolean;
  suppressionReason?: string;
}): LeadGrade {
  if (suppressionReason) return "S";
  if (!syntaxValid || domainStatus !== "Mail-capable" || disposable) return "D";
  if (roleEmail || catchAll) return "C";
  if (domainMatchesCompany) return "A";
  return "B";
}

function emailStatusFor({
  grade,
  roleEmail,
  catchAll,
  suppressionReason
}: {
  grade: LeadGrade;
  roleEmail: boolean;
  catchAll: boolean;
  suppressionReason?: string;
}): VerificationResult["emailStatus"] {
  if (suppressionReason || grade === "S") return "Suppressed";
  if (grade === "D") return "Invalid";
  if (roleEmail || catchAll || grade === "C") return "Risky";
  return "Valid";
}

function phoneStatusFor(phone: string): VerificationResult["phoneStatus"] {
  if (!phone) return "Missing";
  const digits = phone.replace(/\D/g, "");
  if ((digits.length === 11 && digits.startsWith("1")) || digits.length === 10) return "Valid";
  return "Invalid";
}

function scoreForVerification(
  existingScore: number,
  values: {
    grade: LeadGrade;
    phoneStatus: VerificationResult["phoneStatus"];
    domainMatchesCompany: boolean;
    roleEmail: boolean;
    catchAll: boolean;
  }
) {
  if (values.grade === "S") return 0;
  if (values.grade === "D") return Math.min(existingScore, 35);

  let score = 40;
  if (values.grade === "A") score += 35;
  if (values.grade === "B") score += 27;
  if (values.grade === "C") score += 14;
  if (values.phoneStatus === "Valid") score += 10;
  if (values.domainMatchesCompany) score += 8;
  if (values.roleEmail || values.catchAll) score -= 8;

  return Math.max(0, Math.min(100, score));
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

function messageForVerification(
  grade: LeadGrade,
  values: {
    suppressionReason?: string;
    roleEmail: boolean;
    catchAll: boolean;
    disposable: boolean;
    domainMatchesCompany: boolean;
    phoneStatus: VerificationResult["phoneStatus"];
  }
) {
  if (values.suppressionReason) return `Suppressed: ${values.suppressionReason}`;
  if (values.disposable) return "Disposable email domain; blocked from verified export";
  if (grade === "D") return "Invalid or missing email; do not export as verified";
  if (values.roleEmail) return "Role email; enrichment recommended";
  if (values.catchAll) return "Catch-all heuristic; export only under permissive rule";
  if (grade === "A") return "Verified locally: syntax, domain, company-domain match, suppression clear";
  if (grade === "B") return "Verified locally: syntax and domain pass, suppression clear";
  return values.phoneStatus === "Valid" ? "Risk-labeled but phone-ready" : "Risk-labeled; enrichment recommended";
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

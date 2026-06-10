import { randomUUID } from "node:crypto";
import type { AppState, Company, Contact, DedupeMatch } from "@/lib/phase1/types";
import { normalizeCompanyName, normalizeDomain } from "@/lib/phase1/normalization";

export function detectWorkspaceDuplicates(state: AppState, workspaceId: string) {
  const now = new Date().toISOString();
  const existingOpen = new Set(
    state.dedupeMatches
      .filter((match) => match.workspaceId === workspaceId && match.status === "Open")
      .map((match) => matchKey(match.objectType, match.primaryId, match.duplicateId))
  );
  let detected = 0;

  for (const match of detectCompanyMatches(state.companies.filter((company) => company.workspaceId === workspaceId), workspaceId, now)) {
    const key = matchKey(match.objectType, match.primaryId, match.duplicateId);
    if (!existingOpen.has(key)) {
      state.dedupeMatches.unshift(match);
      existingOpen.add(key);
      detected += 1;
    }
  }

  for (const match of detectContactMatches(state.contacts.filter((contact) => contact.workspaceId === workspaceId), workspaceId, now)) {
    const key = matchKey(match.objectType, match.primaryId, match.duplicateId);
    if (!existingOpen.has(key)) {
      state.dedupeMatches.unshift(match);
      existingOpen.add(key);
      detected += 1;
    }
  }

  return { detected, open: state.dedupeMatches.filter((match) => match.workspaceId === workspaceId && match.status === "Open").length };
}

export function mergeDedupeMatch(state: AppState, matchId: string) {
  const match = state.dedupeMatches.find((item) => item.id === matchId);
  if (!match || match.status !== "Open") {
    return false;
  }

  if (match.objectType === "company") {
    mergeCompanies(state, match.primaryId, match.duplicateId);
  } else {
    mergeContacts(state, match.primaryId, match.duplicateId);
  }

  match.status = "Merged";
  match.resolvedAt = new Date().toISOString();
  return true;
}

export function ignoreDedupeMatch(state: AppState, matchId: string) {
  const match = state.dedupeMatches.find((item) => item.id === matchId);
  if (!match || match.status !== "Open") {
    return false;
  }

  match.status = "Ignored";
  match.resolvedAt = new Date().toISOString();
  return true;
}

function detectCompanyMatches(companies: Company[], workspaceId: string, now: string): DedupeMatch[] {
  const matches: DedupeMatch[] = [];

  for (let i = 0; i < companies.length; i += 1) {
    for (let j = i + 1; j < companies.length; j += 1) {
      const left = companies[i];
      const right = companies[j];
      const leftDomain = normalizeDomain(left.domain);
      const rightDomain = normalizeDomain(right.domain);
      const sameDomain = leftDomain && rightDomain && leftDomain === rightDomain;
      const sameNameLocation =
        normalizeCompanyName(left.name) &&
        normalizeCompanyName(left.name) === normalizeCompanyName(right.name) &&
        left.city.toLowerCase() === right.city.toLowerCase() &&
        left.state.toLowerCase() === right.state.toLowerCase();
      const fuzzyName = similarity(normalizeCompanyName(left.name), normalizeCompanyName(right.name)) >= 0.88;

      if (sameDomain || sameNameLocation || fuzzyName) {
        matches.push({
          id: `dedupe-${randomUUID()}`,
          workspaceId,
          objectType: "company",
          primaryId: left.score >= right.score ? left.id : right.id,
          duplicateId: left.score >= right.score ? right.id : left.id,
          reason: sameDomain ? "Root domain match" : sameNameLocation ? "Company name + location match" : "Fuzzy company name match",
          confidence: sameDomain ? 98 : sameNameLocation ? 92 : 86,
          status: "Open",
          detectedAt: now
        });
      }
    }
  }

  return matches;
}

function detectContactMatches(contacts: Contact[], workspaceId: string, now: string): DedupeMatch[] {
  const matches: DedupeMatch[] = [];

  for (let i = 0; i < contacts.length; i += 1) {
    for (let j = i + 1; j < contacts.length; j += 1) {
      const left = contacts[i];
      const right = contacts[j];
      const sameEmail = left.email && right.email && left.email.toLowerCase() === right.email.toLowerCase();
      const sameNameCompany =
        left.companyId === right.companyId &&
        left.name &&
        right.name &&
        left.name.toLowerCase() === right.name.toLowerCase();

      if (sameEmail || sameNameCompany) {
        matches.push({
          id: `dedupe-${randomUUID()}`,
          workspaceId,
          objectType: "contact",
          primaryId: left.score >= right.score ? left.id : right.id,
          duplicateId: left.score >= right.score ? right.id : left.id,
          reason: sameEmail ? "Email address match" : "Full name + company match",
          confidence: sameEmail ? 99 : 91,
          status: "Open",
          detectedAt: now
        });
      }
    }
  }

  return matches;
}

function mergeCompanies(state: AppState, primaryId: string, duplicateId: string) {
  const primary = state.companies.find((company) => company.id === primaryId);
  const duplicate = state.companies.find((company) => company.id === duplicateId);
  if (!primary || !duplicate) return;

  primary.domain ||= duplicate.domain;
  primary.website ||= duplicate.website;
  primary.phone ||= duplicate.phone;
  primary.industry ||= duplicate.industry;
  primary.city ||= duplicate.city;
  primary.state ||= duplicate.state;
  primary.country ||= duplicate.country;
  primary.score = Math.max(primary.score, duplicate.score);
  primary.sourceLineage = Array.from(new Set([...primary.sourceLineage, ...duplicate.sourceLineage]));
  primary.updatedAt = new Date().toISOString();

  for (const contact of state.contacts.filter((item) => item.companyId === duplicateId)) {
    contact.companyId = primaryId;
    contact.updatedAt = new Date().toISOString();
  }

  state.companies = state.companies.filter((company) => company.id !== duplicateId);
}

function mergeContacts(state: AppState, primaryId: string, duplicateId: string) {
  const primary = state.contacts.find((contact) => contact.id === primaryId);
  const duplicate = state.contacts.find((contact) => contact.id === duplicateId);
  if (!primary || !duplicate) return;

  primary.title ||= duplicate.title;
  primary.phone ||= duplicate.phone;
  primary.email ||= duplicate.email;
  primary.score = Math.max(primary.score, duplicate.score);
  primary.grade = gradeRank(duplicate.grade) > gradeRank(primary.grade) ? duplicate.grade : primary.grade;
  primary.sourceLineage = Array.from(new Set([...primary.sourceLineage, ...duplicate.sourceLineage]));
  primary.isSuppressed = primary.isSuppressed || duplicate.isSuppressed;
  primary.updatedAt = new Date().toISOString();

  for (const verification of state.verificationResults.filter((item) => item.contactId === duplicateId)) {
    verification.contactId = primaryId;
  }

  state.contacts = state.contacts.filter((contact) => contact.id !== duplicateId);
}

function gradeRank(grade: Contact["grade"]) {
  return { A: 5, B: 4, C: 3, D: 2, S: 1 }[grade];
}

function matchKey(objectType: DedupeMatch["objectType"], left: string, right: string) {
  return [objectType, ...[left, right].sort()].join(":");
}

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

import { randomUUID } from "node:crypto";
import { toCsv } from "@/lib/phase1/csv";
import type { AppState, Contact, ExportRecord, ExportRule, Session } from "@/lib/phase1/types";

export const exportColumns: Record<ExportRecord["type"], string[]> = {
  companies: ["company", "domain", "website", "industry", "city", "state", "score", "priority", "source_lineage"],
  contacts: [
    "company",
    "contact",
    "title",
    "email",
    "phone",
    "grade",
    "score",
    "priority",
    "status",
    "segment",
    "owner"
  ],
  verified_email_leads: ["company", "contact", "title", "email", "grade", "score", "segment", "owner"],
  phone_leads: [
    "company",
    "contact",
    "title",
    "phone",
    "phone_status",
    "priority",
    "score",
    "segment",
    "owner",
    "source_lineage"
  ],
  sdr_assignments: ["owner", "priority", "company", "contact", "channel", "due_date", "next_task"]
};

export function createExportRecord({
  state,
  session,
  type,
  name,
  leadJobId,
  exportRuleId
}: {
  state: AppState;
  session: Session;
  type: ExportRecord["type"];
  name: string;
  leadJobId?: string;
  exportRuleId?: string;
}) {
  const rule = findExportRule(state, session.workspace.id, type, exportRuleId);
  const recordIds = recordIdsForExport(state, session.workspace.id, type, rule);
  const allEligibleForType = recordIdsForExport(state, session.workspace.id, type);
  const exportRecord: ExportRecord = {
    id: `export-${randomUUID()}`,
    workspaceId: session.workspace.id,
    leadJobId,
    exportRuleId: rule?.id,
    name,
    type,
    columns: exportColumns[type],
    recordIds,
    recordCount: recordIds.length,
    blockedCount: Math.max(allEligibleForType.length - recordIds.length, 0),
    createdById: session.user.id,
    createdAt: new Date().toISOString(),
    status: "Ready"
  };

  state.exports.unshift(exportRecord);
  return exportRecord;
}

export function exportCsvForRecord(state: AppState, exportRecord: ExportRecord) {
  const rows = rowsForExport(state, exportRecord);
  return toCsv(rows, exportRecord.columns);
}

export function rowsForExport(state: AppState, exportRecord: ExportRecord) {
  if (exportRecord.type === "companies") {
    return state.companies
      .filter((company) => company.workspaceId === exportRecord.workspaceId && exportRecord.recordIds.includes(company.id))
      .map((company) => ({
        company: company.name,
        domain: company.domain,
        website: company.website,
        industry: company.industry,
        city: company.city,
        state: company.state,
        score: company.score,
        priority: company.priority,
        source_lineage: company.sourceLineage.join(" | ")
      }));
  }

  if (exportRecord.type === "sdr_assignments") {
    return state.contacts
      .filter((contact) => contact.workspaceId === exportRecord.workspaceId && exportRecord.recordIds.includes(contact.id))
      .map((contact) => {
        const company = state.companies.find(
          (item) => item.id === contact.companyId && item.workspaceId === exportRecord.workspaceId
        );
        return {
          owner: contact.owner,
          priority: contact.priority,
          company: company?.name ?? "",
          contact: contact.name,
          channel: contact.grade === "A" || contact.grade === "B" ? "Email" : "Research",
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          next_task: contact.status === "Needs enrichment" ? "Find direct email" : "First touch"
        };
      });
  }

  if (exportRecord.type === "phone_leads") {
    return state.contacts
      .filter((contact) => contact.workspaceId === exportRecord.workspaceId && exportRecord.recordIds.includes(contact.id))
      .map((contact) => {
        const company = state.companies.find(
          (item) => item.id === contact.companyId && item.workspaceId === exportRecord.workspaceId
        );
        const latestVerification = latestVerificationForContact(state, contact.id, exportRecord.workspaceId);
        return {
          company: company?.name ?? "",
          contact: contact.name,
          title: contact.title,
          phone: contact.phone,
          phone_status: latestVerification?.phoneStatus ?? "Missing",
          priority: contact.priority,
          score: contact.score,
          segment: contact.segment,
          owner: contact.owner,
          source_lineage: contact.sourceLineage.join(" | ")
        };
      });
  }

  return state.contacts
    .filter((contact) => contact.workspaceId === exportRecord.workspaceId && exportRecord.recordIds.includes(contact.id))
    .map((contact) => {
      const company = state.companies.find(
        (item) => item.id === contact.companyId && item.workspaceId === exportRecord.workspaceId
      );
      return {
        company: company?.name ?? "",
        contact: contact.name,
        title: contact.title,
        email: contact.email,
        phone: contact.phone,
        grade: contact.grade,
        score: contact.score,
        priority: contact.priority,
        status: contact.status,
        segment: contact.segment,
        owner: contact.owner
      };
    });
}

export function recordIdsForExport(
  state: AppState,
  workspaceId: string,
  type: ExportRecord["type"],
  rule?: ExportRule
) {
  if (type === "companies") {
    return state.companies.filter((company) => company.workspaceId === workspaceId).map((company) => company.id);
  }

  if (type === "verified_email_leads") {
    return state.contacts
      .filter(
        (contact) =>
          contact.workspaceId === workspaceId &&
          !contact.isSuppressed &&
          (contact.grade === "A" || contact.grade === "B") &&
          (!rule || exportRuleAllowsContact(state, contact, rule))
      )
      .map((contact) => contact.id);
  }

  if (type === "phone_leads") {
    return state.contacts
      .filter((contact) => {
        const latestVerification = latestVerificationForContact(state, contact.id, workspaceId);
        return (
          contact.workspaceId === workspaceId &&
          !contact.isSuppressed &&
          Boolean(contact.phone) &&
          latestVerification?.phoneStatus === "Valid" &&
          (!rule || exportRuleAllowsContact(state, contact, rule))
        );
      })
      .map((contact) => contact.id);
  }

  return state.contacts
    .filter(
      (contact) =>
        contact.workspaceId === workspaceId &&
        !contact.isSuppressed &&
        (!rule || exportRuleAllowsContact(state, contact, rule))
    )
    .map((contact) => contact.id);
}

export function defaultExportRules(workspaceId: string, now = new Date().toISOString()): ExportRule[] {
  return [
    {
      id: "rule-verified-email-strict",
      workspaceId,
      name: "Strict verified email export",
      exportType: "verified_email_leads",
      allowedGrades: ["A", "B"],
      allowedStatuses: ["Ready for SDR", "Exported"],
      minScore: 60,
      includeRoleEmails: false,
      includeCatchAll: false,
      requirePhone: false,
      excludeSuppressed: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "rule-contact-standard",
      workspaceId,
      name: "Standard contact export",
      exportType: "contacts",
      allowedGrades: ["A", "B", "C"],
      allowedStatuses: ["Ready for SDR", "Needs enrichment", "Exported"],
      minScore: 45,
      includeRoleEmails: true,
      includeCatchAll: true,
      requirePhone: false,
      excludeSuppressed: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "rule-phone-leads-ready",
      workspaceId,
      name: "Phone-ready leads export",
      exportType: "phone_leads",
      allowedGrades: ["A", "B", "C"],
      allowedStatuses: ["Ready for SDR", "Needs enrichment", "Exported"],
      minScore: 50,
      includeRoleEmails: true,
      includeCatchAll: true,
      requirePhone: true,
      excludeSuppressed: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "rule-sdr-phone-ready",
      workspaceId,
      name: "SDR phone-ready queue",
      exportType: "sdr_assignments",
      allowedGrades: ["A", "B", "C"],
      allowedStatuses: ["Ready for SDR", "Needs enrichment"],
      minScore: 50,
      includeRoleEmails: true,
      includeCatchAll: true,
      requirePhone: true,
      excludeSuppressed: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

export function findExportRule(
  state: AppState,
  workspaceId: string,
  type: ExportRecord["type"],
  ruleId?: string
) {
  return (
    state.exportRules.find((rule) => rule.id === ruleId && rule.workspaceId === workspaceId && rule.exportType === type) ??
    state.exportRules.find((rule) => rule.workspaceId === workspaceId && rule.exportType === type)
  );
}

export function exportRuleAllowsContact(state: AppState, contact: Contact, rule: ExportRule) {
  if (rule.workspaceId !== contact.workspaceId) {
    return false;
  }

  if (rule.excludeSuppressed && contact.isSuppressed) {
    return false;
  }

  if (!rule.allowedGrades.includes(contact.grade)) {
    return false;
  }

  if (!rule.allowedStatuses.includes(contact.status)) {
    return false;
  }

  if (contact.score < rule.minScore) {
    return false;
  }

  if (rule.requirePhone && !contact.phone) {
    return false;
  }

  const latestVerification = latestVerificationForContact(state, contact.id, contact.workspaceId);

  if (!rule.includeRoleEmails && latestVerification?.roleEmail) {
    return false;
  }

  if (!rule.includeCatchAll && latestVerification?.catchAll) {
    return false;
  }

  return true;
}

function latestVerificationForContact(state: AppState, contactId: string, workspaceId: string) {
  return state.verificationResults
    .filter((result) => result.contactId === contactId && result.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt))[0];
}

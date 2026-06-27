import { describe, expect, it } from "vitest";
import { detectWorkspaceDuplicates } from "@/lib/phase1/dedupe";
import { buildLeadEngineMetrics, groupOpenDedupeMatches } from "@/lib/phase1/lead-engine-metrics";
import { repairStagedLeadIdentities } from "@/lib/phase1/lead-identity-repair";
import { normalizeImportedRows } from "@/lib/phase1/normalization";
import { contactRowsForStaging } from "@/lib/phase1/queries";
import { createSeedState } from "@/lib/phase1/seed";
import type { AppState, Contact, RawLead } from "@/lib/phase1/types";

function rawLead(workspaceId: string, leadJobId: string, payload: Record<string, string>): RawLead {
  return {
    id: `raw-${Math.random().toString(36).slice(2)}`,
    workspaceId,
    leadJobId,
    source: "CSV Upload",
    sourceRecordId: `rec-${Math.random().toString(36).slice(2)}`,
    sourcePayload: payload,
    sourceConfidence: 70,
    extractedAt: new Date().toISOString(),
    processingStatus: "Pending"
  };
}

function resetLeadData(state: AppState) {
  state.rawLeads = [];
  state.normalizedRecords = [];
  state.companies = [];
  state.contacts = [];
  state.dedupeMatches = [];
  state.verificationResults = [];
  state.exports = [];
}

describe("Lead Engine data quality", () => {
  it("normalizes personal-contact CSV rows without turning free-email domains into companies", () => {
    const state = createSeedState();
    resetLeadData(state);
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const lead = rawLead(workspaceId, job.id, {
      name: "Usama Ahmed Khan",
      email: "usamaahmedkhan7979@gmail.com",
      phone: "3035550101"
    });

    normalizeImportedRows({ state, workspaceId, leadJob: job, rawLeads: [lead], mapping: {} });

    const contact = state.contacts.find((item) => item.email === "usamaahmedkhan7979@gmail.com");
    const company = state.companies.find((item) => item.id === contact?.companyId);
    const normalized = state.normalizedRecords.find((item) => item.email === "usamaahmedkhan7979@gmail.com");

    expect(contact?.name).toBe("Usama Ahmed Khan");
    expect(contact?.grade).toBe("C");
    expect(company?.name).toBe("Individual contact");
    expect(company?.domain).toBe("");
    expect(normalized?.companyName).toBe("Individual contact");
    expect(normalized?.verification).toContain("personal email");

    const metrics = buildLeadEngineMetrics(state, workspaceId);
    expect(job.pushedToCrm).toBe(0);
    expect(metrics.readyForSdrCount).toBe(0);
    expect(metrics.assignmentBlockedCount).toBe(1);
    expect(metrics.personalEmailCount).toBe(1);
  });

  it("promotes mobile-contact names out of a mis-mapped company column", () => {
    const state = createSeedState();
    resetLeadData(state);
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const lead = rawLead(workspaceId, job.id, {
      name: "skills.essential@gmail.com",
      company: "Zack Austin",
      email: "skills.essential@gmail.com",
      city: "Dallas",
      state: "TX"
    });

    normalizeImportedRows({
      state,
      workspaceId,
      leadJob: job,
      rawLeads: [lead],
      mapping: { contactName: "name", companyName: "company", email: "email" }
    });

    const contact = state.contacts.find((item) => item.email === "skills.essential@gmail.com");
    const company = state.companies.find((item) => item.id === contact?.companyId);
    const normalized = state.normalizedRecords.find((item) => item.email === "skills.essential@gmail.com");
    const stagedRow = contactRowsForStaging(state, workspaceId).find((row) => row.email === "skills.essential@gmail.com");

    expect(contact?.name).toBe("Zack Austin");
    expect(company?.name).toBe("Individual contact");
    expect(normalized?.contactName).toBe("Zack Austin");
    expect(normalized?.companyName).toBe("Individual contact");
    expect(stagedRow?.contactName).toBe("Zack Austin");
    expect(stagedRow?.company).toBe("Individual contact");
  });

  it("repairs staged display for legacy rows with an email stored as the contact name", () => {
    const state = createSeedState();
    resetLeadData(state);
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const lead = rawLead(workspaceId, job.id, {
      name: "skills.essential@gmail.com",
      company: "Zack Austin",
      email: "skills.essential@gmail.com"
    });

    normalizeImportedRows({
      state,
      workspaceId,
      leadJob: job,
      rawLeads: [lead],
      mapping: { contactName: "name", companyName: "company", email: "email" }
    });
    const normalized = state.normalizedRecords.find((item) => item.email === "skills.essential@gmail.com");
    expect(normalized).toBeDefined();
    if (!normalized) return;

    normalized.contactName = "skills.essential@gmail.com";
    normalized.companyName = "Zack Austin";

    const stagedRow = contactRowsForStaging(state, workspaceId).find((row) => row.id === normalized.id);

    expect(stagedRow?.contactName).toBe("Zack Austin");
    expect(stagedRow?.company).toBe("Individual contact");
  });

  it("does not reuse a repeated personal import inbox as every lead email", () => {
    const state = createSeedState();
    resetLeadData(state);
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const leads = ["Zack Austin", "Bryan Stibbens", "Sam Carter", "Leo"].map((name) =>
      rawLead(workspaceId, job.id, {
        name: "skills.essential@gmail.com",
        company: name,
        email: "skills.essential@gmail.com",
        city: "Dallas",
        state: "TX"
      })
    );

    normalizeImportedRows({
      state,
      workspaceId,
      leadJob: job,
      rawLeads: leads,
      mapping: { contactName: "name", companyName: "company", email: "email" }
    });

    const stagedRows = contactRowsForStaging(state, workspaceId);

    expect(state.contacts).toHaveLength(4);
    expect(new Set(stagedRows.map((row) => row.contactName))).toEqual(
      new Set(["Zack Austin", "Bryan Stibbens", "Sam Carter", "Leo"])
    );
    expect(stagedRows.every((row) => row.email === "")).toBe(true);
    expect(stagedRows.every((row) => row.company === "Individual contact")).toBe(true);
    expect(stagedRows.every((row) => row.emailGrade === "D")).toBe(true);
  });

  it("repairs existing staged records that were collapsed around one shared personal email", () => {
    const state = createSeedState();
    resetLeadData(state);
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const leads = ["Zack Austin", "Bryan Stibbens", "Sam Carter", "Leo"].map((name) =>
      rawLead(workspaceId, job.id, {
        name: "skills.essential@gmail.com",
        company: name,
        email: "skills.essential@gmail.com",
        city: "Dallas",
        state: "TX"
      })
    );

    normalizeImportedRows({
      state,
      workspaceId,
      leadJob: job,
      rawLeads: leads,
      mapping: { contactName: "name", companyName: "company", email: "email" }
    });

    for (const record of state.normalizedRecords) {
      record.email = "skills.essential@gmail.com";
      record.contactName = "skills.essential@gmail.com";
      record.companyName = record.companyName === "Individual contact" ? "Zack Austin" : record.companyName;
      record.domain = "gmail.com";
      record.grade = "C";
      record.status = "Needs enrichment";
      record.verification = "C verification contributed 22; 78% contact enrichment coverage";
    }
    state.normalizedRecords[1].companyName = "Bryan Stibbens";
    state.normalizedRecords[2].companyName = "Sam Carter";
    state.normalizedRecords[3].companyName = "Leo";

    const rowsBeforeRepair = contactRowsForStaging(state, workspaceId);
    expect(rowsBeforeRepair.every((row) => row.email === "")).toBe(true);
    expect(rowsBeforeRepair.every((row) => row.emailGrade === "D")).toBe(true);
    expect(rowsBeforeRepair.every((row) => row.status === "In review")).toBe(true);

    const result = repairStagedLeadIdentities(state, workspaceId);
    const stagedRows = contactRowsForStaging(state, workspaceId);

    expect(result.normalizedRecordsRepaired).toBe(4);
    expect(result.sharedEmailsCleared).toBe(4);
    expect(new Set(stagedRows.map((row) => row.contactName))).toEqual(
      new Set(["Zack Austin", "Bryan Stibbens", "Sam Carter", "Leo"])
    );
    expect(stagedRows.every((row) => row.email === "")).toBe(true);
    expect(stagedRows.every((row) => row.company === "Individual contact")).toBe(true);
    expect(stagedRows.every((row) => row.emailGrade === "D")).toBe(true);
    expect(stagedRows.every((row) => row.status === "In review")).toBe(true);
  });

  it("does not create duplicate matches from placeholder contact names", () => {
    const state = createSeedState();
    resetLeadData(state);
    const workspaceId = state.workspaces[0].id;
    const now = new Date().toISOString();
    state.companies.push({
      id: "company-individual",
      workspaceId,
      name: "Individual contact",
      normalizedName: "individual contact",
      domain: "",
      website: "",
      phone: "",
      industry: "",
      city: "",
      state: "",
      country: "US",
      sourceLineage: ["CSV Upload"],
      score: 30,
      priority: "P4",
      createdAt: now,
      updatedAt: now
    });
    const baseContact: Contact = {
      id: "contact-placeholder-1",
      workspaceId,
      companyId: "company-individual",
      name: "Unknown contact",
      title: "",
      email: "",
      phone: "",
      grade: "D",
      score: 20,
      priority: "P4",
      status: "In review",
      segment: "General outbound",
      owner: "Unassigned",
      sourceLineage: ["CSV Upload"],
      verification: "Missing email",
      lawfulBasis: "Legitimate interest",
      consentStatus: "Unknown",
      consentSource: "CSV Upload",
      doNotContact: false,
      isSuppressed: false,
      createdAt: now,
      updatedAt: now
    };
    state.contacts.push(baseContact, { ...baseContact, id: "contact-placeholder-2" });

    const result = detectWorkspaceDuplicates(state, workspaceId);

    expect(result.detected).toBe(0);
    expect(result.open).toBe(0);
  });

  it("groups actionable duplicates and hides stale placeholder pairs from metrics", () => {
    const state = createSeedState();
    resetLeadData(state);
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const lead = rawLead(workspaceId, job.id, {
      company: "Northstar Tools",
      contact: "Jane Doe",
      email: "jane@northstar-tools.test"
    });
    normalizeImportedRows({ state, workspaceId, leadJob: job, rawLeads: [lead], mapping: {} });
    const original = state.contacts.find((contact) => contact.email === "jane@northstar-tools.test");
    expect(original).toBeDefined();
    if (!original) return;
    state.contacts.push({
      ...original,
      id: "contact-jane-duplicate",
      score: Math.max(original.score - 5, 1),
      sourceLineage: [...original.sourceLineage, "Unit test duplicate"]
    });
    detectWorkspaceDuplicates(state, workspaceId);
    state.dedupeMatches.push({
      id: "dedupe-stale-placeholder",
      workspaceId,
      objectType: "contact",
      primaryId: original.id,
      duplicateId: original.id,
      reason: "Full name + company match",
      confidence: 91,
      status: "Open",
      detectedAt: new Date().toISOString()
    });

    const groups = groupOpenDedupeMatches(state, workspaceId);
    const metrics = buildLeadEngineMetrics(state, workspaceId);

    expect(groups.some((group) => group.matchType === "Exact email")).toBe(true);
    expect(metrics.duplicateGroupCount).toBe(groups.length);
    expect(metrics.hiddenDuplicatePairCount).toBeGreaterThan(0);
  });
});

import type {
  AppState,
  AuditLog,
  Company,
  Contact,
  ExportRecord,
  LeadJob,
  NormalizedRecord,
  RawLead,
  SearchProfile,
  SuppressionRecord,
  User,
  Workspace,
  WorkspaceMember
} from "@/lib/phase1/types";
import { ensureAiDefaults } from "@/lib/phase1/ai";
import { defaultContactCompliance, ensureComplianceDefaults } from "@/lib/phase1/compliance";
import { ensureCrmDefaults } from "@/lib/phase1/crm";
import { detectWorkspaceDuplicates } from "@/lib/phase1/dedupe";
import { runWorkspaceEnrichment } from "@/lib/phase1/enrichment";
import { defaultExportRules } from "@/lib/phase1/exporting";
import { ensureJobObservabilityDefaults } from "@/lib/phase1/jobs";
import { ensureOutreachDefaults } from "@/lib/phase1/outreach";
import { ensureReportingDefaults } from "@/lib/phase1/reporting";
import { defaultSegmentRules } from "@/lib/phase1/scoring";
import { ensureSdrDefaults } from "@/lib/phase1/sdr";
import { runWorkspaceVerification } from "@/lib/phase1/verification";
import {
  accounts,
  contacts,
  exportHistory,
  leadJobs,
  searchProfiles,
  stagedLeads
} from "@/lib/data";

const now = "2026-06-08T21:00:00.000Z";
const workspaceId = "workspace-syncore";

export function createSeedState(): AppState {
  const workspace: Workspace = {
    id: workspaceId,
    name: "Syncore Tech",
    market: "US outbound workspace",
    seats: 18,
    health: "Operational",
    createdAt: now,
    updatedAt: now
  };

  const users: User[] = [
    {
      id: "user-nora",
      name: "Nora West",
      email: "nora@syncore.tech",
      createdAt: now
    },
    {
      id: "user-ari",
      name: "Ari Patel",
      email: "ari@syncore.tech",
      createdAt: now
    },
    {
      id: "user-mina",
      name: "Mina Brooks",
      email: "mina@syncore.tech",
      createdAt: now
    },
    {
      id: "user-leo",
      name: "Leo Grant",
      email: "leo@syncore.tech",
      createdAt: now
    },
    {
      id: "user-compliance",
      name: "Rhea Cole",
      email: "rhea@syncore.tech",
      createdAt: now
    }
  ];

  const workspaceMembers: WorkspaceMember[] = [
    { id: "member-nora", workspaceId, userId: "user-nora", role: "Admin" },
    { id: "member-ari", workspaceId, userId: "user-ari", role: "SDR" },
    { id: "member-mina", workspaceId, userId: "user-mina", role: "SDR" },
    { id: "member-leo", workspaceId, userId: "user-leo", role: "Data Operator" },
    { id: "member-rhea", workspaceId, userId: "user-compliance", role: "Compliance Admin" }
  ];

  const seededProfiles: SearchProfile[] = searchProfiles.map((profile) => ({
    id: profile.id,
    workspaceId,
    name: profile.name,
    targetMarket: profile.targetMarket,
    geographies: profile.geographies,
    industries: profile.industries,
    titles: profile.titles,
    sources: profile.sources,
    requiredFields: profile.requiredFields,
    scoringProfile: profile.scoringProfile,
    segmentRules: profile.segmentRules,
    defaultRouting: profile.defaultRouting,
    estimatedVolume: profile.estimatedVolume,
    complianceNote: profile.complianceNote,
    createdById: "user-nora",
    createdAt: now,
    updatedAt: now
  }));

  const seededJobs: LeadJob[] = leadJobs.map((job) => ({
    id: job.id,
    workspaceId,
    searchProfileId: job.profileId,
    name: job.name,
    status: job.status,
    progress: job.progress,
    sources: job.sources,
    raw: job.raw,
    normalized: job.normalized,
    duplicates: job.duplicates,
    suppressed: job.suppressed,
    verified: job.verified,
    enriched: job.enriched,
    exported: job.exported,
    pushedToCrm: job.pushedToCrm,
    actualCost: job.actualCost,
    startedAt: new Date(job.startedAt).toISOString(),
    completedAt: job.status === "Completed" ? now : undefined,
    eta: job.eta,
    errorSummary: job.errorSummary,
    createdById: "user-nora",
    createdAt: now,
    updatedAt: now
  }));

  const seededCompanies: Company[] = accounts.map((account) => ({
    id: companyIdForAccount(account.id),
    workspaceId,
    name: account.name,
    normalizedName: account.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    domain: account.domain,
    website: `https://${account.domain}`,
    phone: "",
    industry: account.industry,
    employeeBand: account.employees,
    revenueBand: account.revenueBand,
    technologies: [],
    signals: [],
    enrichmentCoverage: 0,
    city: account.location.split(",")[0] ?? "",
    state: account.location.split(",")[1]?.trim() ?? "",
    country: "US",
    sourceLineage: [account.source],
    score: account.score,
    priority: account.priority,
    createdAt: now,
    updatedAt: now
  }));

  const seededContacts: Contact[] = contacts.map((contact) => {
    const staged = stagedLeads.find((lead) => lead.email === contact.email);
    const suppressed = staged?.status === "Suppressed";
    return {
      id: contact.id,
      workspaceId,
      companyId: companyIdForAccount(contact.accountId),
      name: contact.name,
      title: contact.title,
      seniority: undefined,
      department: undefined,
      email: contact.email,
      phone: contact.phone,
      grade: contact.grade,
      score: contact.score,
      priority: staged?.priority ?? "P2",
      status: (staged?.status ?? "Ready for SDR") as Contact["status"],
      segment: staged?.segment ?? "General outbound",
      owner: contact.owner,
      sourceLineage: [staged?.source ?? "Seed data"],
      verification: staged?.verification ?? "Seed verification",
      enrichmentCoverage: 0,
      fitReason: undefined,
      enrichedAt: undefined,
      ...defaultContactCompliance({
        source: staged?.source ?? "Seed data",
        suppressed,
        capturedAt: now
      }),
      isSuppressed: suppressed,
      createdAt: now,
      updatedAt: now
    };
  });

  const seededRawLeads: RawLead[] = stagedLeads.map((lead) => ({
    id: `raw-${lead.id}`,
    workspaceId,
    leadJobId: lead.status === "Exported" ? "job-1038" : lead.city === "San Francisco" ? "job-1036" : "job-1042",
    source: lead.source,
    sourceRecordId: lead.id,
    sourcePayload: {
      company: lead.company,
      contact: lead.contactName,
      title: lead.title,
      email: lead.email,
      phone: lead.phone,
      domain: lead.domain,
      city: lead.city,
      state: lead.state,
      source: lead.source
    },
    sourceConfidence: 80,
    extractedAt: now,
    processingStatus: lead.status === "Suppressed" ? "Suppressed" : "Normalized"
  }));

  const seededNormalized: NormalizedRecord[] = stagedLeads.map((lead) => ({
    id: `norm-${lead.id}`,
    workspaceId,
    rawLeadId: `raw-${lead.id}`,
    leadJobId: lead.status === "Exported" ? "job-1038" : lead.city === "San Francisco" ? "job-1036" : "job-1042",
    companyName: lead.company,
    normalizedCompanyName: lead.company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    contactName: lead.contactName,
    title: lead.title,
    email: lead.email,
    phone: lead.phone,
    domain: lead.domain,
    website: `https://${lead.domain}`,
    city: lead.city,
    state: lead.state,
    country: "US",
    industry: lead.segment,
    source: lead.source,
    grade: lead.emailGrade,
    score: lead.score,
    priority: lead.priority,
    status: lead.status,
    segment: lead.segment,
    owner: lead.owner,
    verification: lead.verification,
    suppressionReason: lead.status === "Suppressed" ? lead.segment : undefined,
    normalizedAt: now
  }));

  const suppressionRecords: SuppressionRecord[] = [
    {
      id: "supp-existing-smith",
      workspaceId,
      type: "Existing customer",
      domain: "smithfamilymotors.com",
      reason: "active customer account",
      source: "CRM",
      createdAt: now
    },
    {
      id: "supp-bounce-demo",
      workspaceId,
      type: "Hard bounce",
      email: "bounced@example.com",
      reason: "hard bounce",
      source: "Email event",
      createdAt: now
    },
    {
      id: "supp-dnc-demo",
      workspaceId,
      type: "Do not call",
      phone: "+1 555 000 0000",
      reason: "DNC",
      source: "Manual",
      createdAt: now
    }
  ];

  const exports: ExportRecord[] = exportHistory.map((exportItem) => {
    const recordIds = seededContacts
      .filter((contact) => !contact.isSuppressed && (contact.grade === "A" || contact.grade === "B"))
      .map((contact) => contact.id)
      .slice(0, Math.min(10, seededContacts.length));

    return {
      id: exportItem.id,
      workspaceId,
      leadJobId: exportItem.sourceJob,
      name: exportItem.name,
      type: exportItem.name.toLowerCase().includes("phone") ? "sdr_assignments" : "verified_email_leads",
      columns: ["company", "contact", "title", "email", "grade", "score", "segment", "owner"],
      recordIds,
      recordCount: recordIds.length,
      createdById: "user-nora",
      createdAt: new Date(exportItem.createdAt).toISOString(),
      status: exportItem.status as ExportRecord["status"]
    };
  });

  const auditLogs: AuditLog[] = [
    {
      id: "audit-seed",
      workspaceId,
      actorUserId: "user-nora",
      objectType: "workspace",
      objectId: workspaceId,
      action: "seeded_phase_1",
      reason: "Initial local data",
      createdAt: now
    }
  ];

  const state: AppState = {
    version: 11,
    workspaces: [workspace],
    users,
    workspaceMembers,
    searchProfiles: seededProfiles,
    leadJobs: seededJobs,
    asyncJobRuns: [],
    jobLogs: [],
    jobIdempotencyRecords: [],
    rawLeads: seededRawLeads,
    normalizedRecords: seededNormalized,
    companies: seededCompanies,
    contacts: seededContacts,
    verificationResults: [],
    dedupeMatches: [],
    exportRules: defaultExportRules(workspaceId, now),
    providerCache: [],
    enrichmentResults: [],
    segmentRules: defaultSegmentRules(workspaceId, now),
    recordSegments: [],
    leadScores: [],
    opportunities: [],
    activities: [],
    tasks: [],
    notes: [],
    callLogs: [],
    customFields: [],
    customFieldValues: [],
    sdrTeams: [],
    sdrAssignments: [],
    followUpReminders: [],
    reassignmentRules: [],
    outreachProviders: [],
    outreachCampaigns: [],
    campaignSequences: [],
    sequenceSteps: [],
    emailEvents: [],
    smsEvents: [],
    webhookEvents: [],
    trackedCalls: [],
    reportSnapshots: [],
    retentionPolicies: [],
    retentionRuns: [],
    complianceChecklistItems: [],
    dataSubjectRequests: [],
    deliverabilityAlerts: [],
    aiPersonalizations: [],
    aiReplyClassifications: [],
    aiCallSummaries: [],
    aiLeadScorePredictions: [],
    aiIcpRecommendations: [],
    aiDeliverabilityRecommendations: [],
    aiRevenueInsights: [],
    aiAutomationRuns: [],
    suppressionRecords,
    exports,
    auditLogs
  };

  runWorkspaceVerification(state, workspaceId);
  ensureJobObservabilityDefaults(state, workspaceId);
  detectWorkspaceDuplicates(state, workspaceId);
  runWorkspaceEnrichment(state, workspaceId);
  ensureCrmDefaults(state, workspaceId);
  ensureSdrDefaults(state, workspaceId);
  ensureOutreachDefaults(state, workspaceId);
  ensureComplianceDefaults(state, workspaceId);
  ensureReportingDefaults(state, workspaceId);
  ensureAiDefaults(state, workspaceId);

  return state;
}

function companyIdForAccount(accountId: string) {
  return `company-${accountId.replace(/^acct-/, "")}`;
}

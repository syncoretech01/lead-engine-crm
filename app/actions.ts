"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertPermission, restrictsToOwnedRecords } from "@/lib/phase1/auth";
import {
  completeDataSubjectRequest,
  consentStatuses,
  createDataSubjectRequest,
  dataSubjectRequestTypes,
  lawfulBases,
  recordingConsentStatuses,
  suppressContact
} from "@/lib/phase1/compliance";
import {
  applyAiIcpRecommendation,
  applyAiLeadScore,
  applyAiPersonalization,
  classifyAiReplies,
  createIcpRecommendationFromPrompt,
  dismissAiRecord,
  generateAiCallSummaries,
  generateAiDeliverabilityRecommendations,
  generateAiIcpRecommendations,
  generateAiLeadScores,
  generateAiPersonalizations,
  generateAiRevenueInsights,
  parsePromptForIcp,
  runAiAutomationSuite,
  updateIcpRecommendation
} from "@/lib/phase1/ai";
import { resolveIcpDraft } from "@/lib/llm/icp-drafter";
import {
  addActivity,
  callOutcomes,
  opportunityStages,
  resolveWorkspaceCrmTargets,
  stageProbability,
  taskPriorities
} from "@/lib/phase1/crm";
import { splitList } from "@/lib/phase1/csv";
import { detectWorkspaceDuplicates, ignoreDedupeMatch, mergeDedupeMatch } from "@/lib/phase1/dedupe";
import {
  assignedBulkEmailContactIds,
  buildDirectEmailSendPlan,
  recordDirectEmailSendResults,
  sendDirectEmailBatch,
  type BulkEmailAudience
} from "@/lib/phase1/direct-email-send";
import { runWorkspaceEnrichment } from "@/lib/phase1/enrichment";
import { createExportRecord } from "@/lib/phase1/exporting";
import { createTrackedJob, retryFailedJob } from "@/lib/phase1/jobs";
import { partitionLeadsForAssignment } from "@/lib/phase1/lead-gate";
import { applyLeadOverride, createLeadJobFromPreflight } from "@/lib/phase1/lead-planning";
import { applyCampaignEngagementScores } from "@/lib/phase1/engagement-scoring";
import { normalizeDomain, normalizeEmail, normalizePhone } from "@/lib/phase1/normalization";
import { outreachBatchSize } from "@/lib/phase1/outreach-config";
import {
  buildCampaignSendBatch,
  recordCampaignSendResults,
  sendCampaignBatch
} from "@/lib/phase1/outreach-send";
import {
  aiWriteTables,
  complianceWriteTables,
  crmWriteTables,
  exportRuleWriteTables,
  enrichmentWriteTables,
  exportWriteTables,
  leadGenerationWriteTables,
  outreachCampaignSendWriteTables,
  outreachEmailWriteTables,
  outreachSetupWriteTables,
  outreachSmsWriteTables,
  outreachTrackedCallWriteTables,
  reportingWriteTables,
  sdrWriteTables
} from "@/lib/phase1/normalized-write-tables";
import { readFastLeadDashboardState } from "@/lib/phase1/lead-dashboard-read-model";
import {
  callDispositions,
  campaignStatuses,
  campaignTypes,
  createCampaign,
  createEmailEvent,
  createSequence,
  createSequenceStep,
  createSmsEvent,
  createTrackedCall,
  emailEventTypes,
  outreachChannels as campaignChannels,
  outreachProviderStatuses,
  simulateCampaignSend,
  smsEventStatuses,
  trackedCallStatuses
} from "@/lib/phase1/outreach";
import {
  complianceChecklistStatuses,
  generateReportSnapshots,
  resolveDeliverabilityAlert,
  retentionActions,
  retentionRunModes,
  runRetentionPolicy
} from "@/lib/phase1/reporting";
import {
  disableProviderConnectionForWorkspace,
  saveProviderConnection,
  setProviderConnectionExecutionMode,
  testProviderConnection
} from "@/lib/phase1/provider-connection-service";
import { applySegmentsAndScores, createSegmentRuleFromForm } from "@/lib/phase1/scoring";
import {
  applyReassignmentRecommendations,
  assignWorkspaceLeads,
  assignmentMethods,
  completeReminder,
  createReassignmentRule,
  outreachChannels,
  reassignmentTriggers,
  reassignSdrAssignment,
  recordFirstTouch,
  refreshSlaStatuses,
  sdrLeadStatuses
} from "@/lib/phase1/sdr";
import { ownedCrmRecordScope } from "@/lib/phase1/queries";
import { createSeedState } from "@/lib/phase1/seed";
import { appendAudit, getSession, getWorkspaceSessionContext, readState, updateState } from "@/lib/phase1/store";
import { requireWorkspaceScopedRecord } from "@/lib/phase1/tenant-isolation";
import { runWorkspaceVerification } from "@/lib/phase1/verification";
import { enrichContactsWithWaterfall } from "@/lib/phase1/waterfall-enrichment-service";
import type {
  AppState,
  Session,
  CallLog,
  CallDisposition,
  CrmTask,
  CustomField,
  CampaignStatus,
  CampaignType,
  EmailEventType,
  ExportRecord,
  ExportRule,
  LeadGrade,
  LeadJob,
  LeadStatus,
  Opportunity,
  OpportunityStage,
  OutreachChannel,
  Priority,
  ReassignmentTrigger,
  RetentionAction,
  RetentionRunMode,
  SearchProfile,
  SegmentCondition,
  SdrLeadStatus,
  SmsEventStatus,
  SuppressionRecord,
  ComplianceChecklistStatus,
  ConsentStatus,
  DataSubjectRequestType,
  LawfulBasis,
  RecordingConsentStatus,
  TrackedCallStatus
} from "@/lib/phase1/types";
import type { ProviderCapability, ProviderId } from "@/lib/providers/types";

export async function createSearchProfileAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_profiles");
    const now = new Date().toISOString();
    const profile: SearchProfile = {
      id: `sp-${randomUUID()}`,
      workspaceId: session.workspace.id,
      name: stringValue(formData.get("name"), "Untitled profile"),
      targetMarket: stringValue(formData.get("targetMarket"), "US outbound"),
      geographies: splitList(formData.get("geographies")),
      industries: splitList(formData.get("industries")),
      titles: splitList(formData.get("titles")),
      sources: sourceValues(formData),
      requiredFields: splitList(formData.get("requiredFields")),
      scoringProfile: stringValue(formData.get("scoringProfile"), "Basic fit"),
      segmentRules: splitList(formData.get("segmentRules")),
      defaultRouting: stringValue(formData.get("defaultRouting"), "Manual manager review"),
      estimatedVolume: numberValue(formData.get("estimatedVolume")),
      complianceNote: stringValue(formData.get("complianceNote"), "Source label required before export."),
      createdById: session.user.id,
      createdAt: now,
      updatedAt: now
    };

    state.searchProfiles.unshift(profile);
    appendAudit(state, session, {
      objectType: "search_profile",
      objectId: profile.id,
      action: "created",
      newValue: profile
    });
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages(["/", "/search-profiles", "/build-list"]);
}

export async function duplicateSearchProfileAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_profiles");
    const id = stringValue(formData.get("id"));
    const profile = state.searchProfiles.find((item) => item.id === id && item.workspaceId === session.workspace.id);

    if (!profile) {
      throw new Error("Search profile not found.");
    }

    const now = new Date().toISOString();
    const duplicate: SearchProfile = {
      ...profile,
      id: `sp-${randomUUID()}`,
      name: `${profile.name} Copy`,
      createdById: session.user.id,
      createdAt: now,
      updatedAt: now
    };

    state.searchProfiles.unshift(duplicate);
    appendAudit(state, session, {
      objectType: "search_profile",
      objectId: duplicate.id,
      action: "duplicated",
      oldValue: { sourceProfileId: profile.id },
      newValue: duplicate
    });
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages(["/search-profiles", "/build-list"]);
}

export async function deleteSearchProfileAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_profiles");
    const id = stringValue(formData.get("id"));
    const before = state.searchProfiles.length;
    state.searchProfiles = state.searchProfiles.filter(
      (profile) => !(profile.id === id && profile.workspaceId === session.workspace.id)
    );

    if (state.searchProfiles.length !== before) {
      appendAudit(state, session, {
        objectType: "search_profile",
        objectId: id,
        action: "deleted"
      });
    }
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages(["/", "/search-profiles", "/build-list"]);
}

export async function createLeadJobAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "run_jobs");
    const profileId = stringValue(formData.get("searchProfileId"));
    const profile = state.searchProfiles.find((item) => item.id === profileId && item.workspaceId === session.workspace.id);
    const sources = sourceValues(formData);
    const now = new Date().toISOString();
    const budgetCapCents =
      centsValue(formData.get("budgetCapDollars")) ?? optionalNumberValue(formData.get("budgetCapCents"));
    const enrichmentBudgetCents =
      centsValue(formData.get("enrichmentBudgetDollars")) ?? optionalNumberValue(formData.get("enrichmentBudgetCents"));
    const job: LeadJob = createLeadJobFromPreflight({
      session,
      profile,
      name: stringValue(formData.get("name"), profile ? `${profile.name} Job` : "Manual lead job"),
      sources: sources.length ? sources : profile?.sources ?? ["CSV Upload"],
      requestedRecords: optionalNumberValue(formData.get("requestedRecords")) ?? profile?.estimatedVolume,
      budgetCapCents,
      enrichmentBudgetCents,
      highValueOnlyEnrichment: formData.get("highValueOnlyEnrichment") === "on",
      budgetConfirmed: formData.get("budgetConfirmed") === "on",
      now
    });

    createTrackedJob({
      state,
      job,
      sources: job.sources,
      logMessage: "Manual lead job queued from app"
    });

    appendAudit(state, session, {
      objectType: "lead_job",
      objectId: job.id,
      action: "queued_with_budget_confirmation",
      newValue: job
    });
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages(["/", "/lead-jobs", "/build-list"]);
}

export async function retryLeadJobAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "run_jobs");
    const id = stringValue(formData.get("id"));
    const retry = retryFailedJob(state, session.workspace.id, id);

    appendAudit(state, session, {
      objectType: "lead_job",
      objectId: id,
      action: "retry_queued",
      newValue: retry
    });
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages(["/lead-jobs", "/build-list"]);
}

export async function createExportAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "export_csv");
    const type = stringValue(formData.get("type"), "verified_email_leads") as ExportRecord["type"];
    const exportRecord = createExportRecord({
      state,
      session,
      type,
      name: stringValue(formData.get("name"), exportName(type)),
      leadJobId: stringValue(formData.get("leadJobId")) || undefined,
      exportRuleId: stringValue(formData.get("exportRuleId")) || undefined
    });

    appendAudit(state, session, {
      objectType: "export",
      objectId: exportRecord.id,
      action: "created",
      newValue: exportRecord
    });
  }, { normalizedTables: exportWriteTables });

  revalidateLeadEnginePages(["/", "/exports"]);
}

export async function runVerificationAction() {
  await updateState((state, session) => {
    assertPermission(session, "run_jobs");
    const result = runWorkspaceVerification(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "verification",
      objectId: session.workspace.id,
      action: "verification_run",
      newValue: result
    });
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages();
}

export async function detectDuplicatesAction() {
  await updateState((state, session) => {
    assertPermission(session, "run_jobs");
    const result = detectWorkspaceDuplicates(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "dedupe",
      objectId: session.workspace.id,
      action: "duplicates_detected",
      newValue: result
    });
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages();
}

export async function mergeDuplicateAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "run_jobs");
    const id = stringValue(formData.get("id"));
    const merged = mergeDedupeMatch(state, id);

    if (merged) {
      appendAudit(state, session, {
        objectType: "dedupe_match",
        objectId: id,
        action: "merged"
      });
    }
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages();
}

export async function ignoreDuplicateAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "run_jobs");
    const id = stringValue(formData.get("id"));
    const ignored = ignoreDedupeMatch(state, id);

    if (ignored) {
      appendAudit(state, session, {
        objectType: "dedupe_match",
        objectId: id,
        action: "ignored"
      });
    }
  }, { normalizedTables: leadGenerationWriteTables });

  revalidateLeadEnginePages();
}

export async function addSuppressionAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_compliance");
    const type = stringValue(formData.get("type"), "Unsubscribe") as SuppressionRecord["type"];
    const email = normalizeEmail(stringValue(formData.get("email"))) || undefined;
    const phone = normalizePhone(stringValue(formData.get("phone"))) || undefined;
    const domain = normalizeDomain(stringValue(formData.get("domain"))) || undefined;
    const reason = stringValue(formData.get("reason"), type);
    const source = stringValue(formData.get("source"), "Manual");
    const record: SuppressionRecord = {
      id: `supp-${randomUUID()}`,
      workspaceId: session.workspace.id,
      type,
      email,
      phone,
      domain,
      reason,
      source,
      createdAt: new Date().toISOString()
    };

    state.suppressionRecords.unshift(record);
    const affectedContacts = applySuppressionToContacts(state, record);
    runWorkspaceVerification(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "suppression",
      objectId: record.id,
      action: "created",
      newValue: { ...record, affectedContacts }
    });
  }, { normalizedTables: complianceWriteTables });

  revalidateDevPages(["/compliance", "/reports/compliance"]);
  revalidateLeadEnginePages();
  revalidateCrmPages();
}

export async function deleteSuppressionAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_compliance");
    const id = stringValue(formData.get("id"));
    state.suppressionRecords = state.suppressionRecords.filter(
      (record) => !(record.id === id && record.workspaceId === session.workspace.id)
    );
    runWorkspaceVerification(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "suppression",
      objectId: id,
      action: "deleted"
    });
  }, { normalizedTables: complianceWriteTables });

  revalidateDevPages(["/compliance", "/reports/compliance"]);
  revalidateLeadEnginePages();
  revalidateCrmPages();
}

export async function createExportRuleAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_export_rules");
    const now = new Date().toISOString();
    const exportType = stringValue(formData.get("exportType"), "verified_email_leads") as ExportRule["exportType"];
    const rule: ExportRule = {
      id: `rule-${randomUUID()}`,
      workspaceId: session.workspace.id,
      name: stringValue(formData.get("name"), "Custom export rule"),
      exportType,
      allowedGrades: formData.getAll("allowedGrades").map(String) as LeadGrade[],
      allowedStatuses: formData.getAll("allowedStatuses").map(String) as LeadStatus[],
      minScore: numberValue(formData.get("minScore")),
      includeRoleEmails: formData.get("includeRoleEmails") === "on",
      includeCatchAll: formData.get("includeCatchAll") === "on",
      requirePhone: formData.get("requirePhone") === "on",
      excludeSuppressed: formData.get("excludeSuppressed") !== "off",
      createdAt: now,
      updatedAt: now
    };

    if (rule.allowedGrades.length === 0) {
      rule.allowedGrades = ["A", "B"];
    }

    if (rule.allowedStatuses.length === 0) {
      rule.allowedStatuses = ["Ready for SDR", "Exported"];
    }

    state.exportRules.unshift(rule);
    appendAudit(state, session, {
      objectType: "export_rule",
      objectId: rule.id,
      action: "created",
      newValue: rule
    });
  }, { normalizedTables: exportRuleWriteTables });

  revalidateLeadEnginePages(["/exports"]);
}

export async function deleteExportRuleAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_export_rules");
    const id = stringValue(formData.get("id"));
    state.exportRules = state.exportRules.filter(
      (rule) => !(rule.id === id && rule.workspaceId === session.workspace.id)
    );

    appendAudit(state, session, {
      objectType: "export_rule",
      objectId: id,
      action: "deleted"
    });
  }, { normalizedTables: exportRuleWriteTables });

  revalidateLeadEnginePages(["/exports"]);
}

export async function runEnrichmentAction(formData?: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_enrichment");
    const budgetCents =
      centsValue(formData?.get("enrichmentBudgetDollars")) ?? optionalNumberValue(formData?.get("enrichmentBudgetCents"));
    const result = runWorkspaceEnrichment(state, session.workspace.id, {
      budgetCents,
      highValueOnly: formData?.get("highValueOnlyEnrichment") === "on"
    });

    appendAudit(state, session, {
      objectType: "enrichment",
      objectId: session.workspace.id,
      action: "enrichment_waterfall_run",
      newValue: result
    });
  }, { normalizedTables: enrichmentWriteTables });

  revalidateLeadEnginePages();
}

export async function overrideLeadPrioritySegmentAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_enrichment");
    const result = applyLeadOverride({
      state,
      workspaceId: session.workspace.id,
      contactId: stringValue(formData.get("contactId")),
      priorityOverride: optionalPriority(formData.get("priorityOverride")),
      segmentOverride: stringValue(formData.get("segmentOverride")) || undefined,
      reason: stringValue(formData.get("overrideReason")),
      now: new Date().toISOString()
    });

    appendAudit(state, session, {
      objectType: "lead_override",
      objectId: result.contact.id,
      action: "manual_priority_segment_override",
      oldValue: result.before,
      newValue: result.after,
      reason: result.reason
    });
  }, { normalizedTables: enrichmentWriteTables });

  revalidateLeadEnginePages();
}

export async function applySegmentsAndScoresAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_enrichment");
    const result = applySegmentsAndScores(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "scoring",
      objectId: session.workspace.id,
      action: "segments_and_scores_applied",
      newValue: result
    });
  }, { normalizedTables: enrichmentWriteTables });

  revalidateLeadEnginePages();
}

export async function createSegmentRuleAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_enrichment");
    const rule = createSegmentRuleFromForm({
      workspaceId: session.workspace.id,
      name: stringValue(formData.get("name"), "Custom segment"),
      description: stringValue(formData.get("description"), "Custom segment rule"),
      outputSegment: stringValue(formData.get("outputSegment"), "Custom segment"),
      scoreBoost: numberValue(formData.get("scoreBoost")),
      priorityOverride: optionalPriority(formData.get("priorityOverride")),
      conditions: {
        industries: splitList(formData.get("industries")),
        titleKeywords: splitList(formData.get("titleKeywords")),
        domainKeywords: splitList(formData.get("domainKeywords")),
        technologyKeywords: splitList(formData.get("technologyKeywords")),
        signalKeywords: splitList(formData.get("signalKeywords")),
        grades: gradeValues(formData),
        minScore: numberValue(formData.get("minScore")),
        requirePhone: formData.get("requirePhone") === "on"
      } satisfies SegmentCondition
    });

    state.segmentRules.unshift(rule);
    const scoring = applySegmentsAndScores(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "segment_rule",
      objectId: rule.id,
      action: "created",
      newValue: { rule, scoring }
    });
  }, { normalizedTables: enrichmentWriteTables });

  revalidateLeadEnginePages();
}

export async function deleteSegmentRuleAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_enrichment");
    const id = stringValue(formData.get("id"));
    state.segmentRules = state.segmentRules.filter(
      (rule) => !(rule.id === id && rule.workspaceId === session.workspace.id)
    );
    state.recordSegments = state.recordSegments.filter((segment) => segment.segmentRuleId !== id);
    const scoring = applySegmentsAndScores(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "segment_rule",
      objectId: id,
      action: "deleted",
      newValue: scoring
    });
  }, { normalizedTables: enrichmentWriteTables });

  revalidateLeadEnginePages();
}

export async function createOpportunityAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const companyId = stringValue(formData.get("companyId"));
    const company = state.companies.find((item) => item.id === companyId && item.workspaceId === session.workspace.id);

    if (!company) {
      throw new Error("Account not found.");
    }

    const rawContactId = stringValue(formData.get("contactId")) || undefined;
    const contact = rawContactId
      ? state.contacts.find(
          (item) => item.id === rawContactId && item.companyId === companyId && item.workspaceId === session.workspace.id
        )
      : undefined;
    const contactId = contact?.id;
    const stage = opportunityStageValue(formData.get("stage"));
    const now = new Date().toISOString();
    const opportunity: Opportunity = {
      id: `opp-${randomUUID()}`,
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      name: stringValue(formData.get("name"), `${company.name} opportunity`),
      stage,
      amount: numberValue(formData.get("amount")),
      probability: stageProbability(stage),
      expectedCloseDate: dateValue(formData.get("expectedCloseDate")),
      ownerUserId: stringValue(formData.get("ownerUserId"), session.user.id),
      source: stringValue(formData.get("source"), company.sourceLineage[0] ?? "Manual CRM"),
      createdAt: now,
      updatedAt: now
    };

    state.opportunities.unshift(opportunity);
    addActivity(state, {
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      opportunityId: opportunity.id,
      type: "Opportunity",
      title: `${stage} opportunity created`,
      body: opportunity.name,
      actorUserId: session.user.id,
      metadata: { amount: opportunity.amount, probability: opportunity.probability }
    });

    appendAudit(state, session, {
      objectType: "opportunity",
      objectId: opportunity.id,
      action: "created",
      newValue: opportunity
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages(crmDetailPathsFromForm(formData));
}

export async function updateOpportunityStageAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const id = stringValue(formData.get("id"));
    const opportunity = state.opportunities.find(
      (item) => item.id === id && item.workspaceId === session.workspace.id
    );

    if (!opportunity) {
      throw new Error("Opportunity not found.");
    }

    const oldStage = opportunity.stage;
    const nextStage = opportunityStageValue(formData.get("stage"));
    opportunity.stage = nextStage;
    opportunity.probability = stageProbability(nextStage);
    opportunity.updatedAt = new Date().toISOString();

    addActivity(state, {
      workspaceId: session.workspace.id,
      companyId: opportunity.companyId,
      contactId: opportunity.contactId,
      opportunityId: opportunity.id,
      type: "Status change",
      title: `Opportunity moved to ${nextStage}`,
      body: `${oldStage} -> ${nextStage}`,
      actorUserId: session.user.id,
      metadata: { oldStage, nextStage }
    });

    appendAudit(state, session, {
      objectType: "opportunity",
      objectId: opportunity.id,
      action: "stage_updated",
      oldValue: { stage: oldStage },
      newValue: { stage: nextStage, probability: opportunity.probability }
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages();
}

export async function createTaskAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const { contact, companyId } = resolveWorkspaceCrmTargets(state, session.workspace.id, {
      contactId: stringValue(formData.get("contactId")) || undefined,
      companyId: stringValue(formData.get("companyId")) || undefined
    });
    const contactId = contact?.id;
    const now = new Date().toISOString();
    const task: CrmTask = {
      id: `task-${randomUUID()}`,
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      title: stringValue(formData.get("title"), "Follow up"),
      status: "Open",
      priority: taskPriorityValue(formData.get("priority")),
      dueAt: dateValue(formData.get("dueAt")),
      ownerUserId: stringValue(formData.get("ownerUserId"), session.user.id),
      createdById: session.user.id,
      createdAt: now,
      updatedAt: now
    };

    state.tasks.unshift(task);
    addActivity(state, {
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      type: "Task",
      title: `Task created: ${task.title}`,
      body: task.dueAt ? `Due ${task.dueAt.slice(0, 10)}.` : undefined,
      actorUserId: session.user.id,
      metadata: { priority: task.priority }
    });

    appendAudit(state, session, {
      objectType: "task",
      objectId: task.id,
      action: "created",
      newValue: task
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages(crmDetailPathsFromForm(formData));
}

export async function completeTaskAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const id = stringValue(formData.get("id"));
    const task = state.tasks.find((item) => item.id === id && item.workspaceId === session.workspace.id);

    if (!task) {
      throw new Error("Task not found.");
    }

    const oldStatus = task.status;
    const now = new Date().toISOString();
    task.status = "Completed";
    task.completedAt = now;
    task.updatedAt = now;

    addActivity(state, {
      workspaceId: session.workspace.id,
      companyId: task.companyId,
      contactId: task.contactId,
      type: "Task",
      title: `Task completed: ${task.title}`,
      actorUserId: session.user.id,
      metadata: { oldStatus, nextStatus: task.status }
    });

    appendAudit(state, session, {
      objectType: "task",
      objectId: task.id,
      action: "completed",
      oldValue: { status: oldStatus },
      newValue: { status: task.status, completedAt: task.completedAt }
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages();
}

export async function createNoteAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const { contact, companyId } = resolveWorkspaceCrmTargets(state, session.workspace.id, {
      contactId: stringValue(formData.get("contactId")) || undefined,
      companyId: stringValue(formData.get("companyId")) || undefined
    });
    const contactId = contact?.id;
    const now = new Date().toISOString();
    const note = {
      id: `note-${randomUUID()}`,
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      body: stringValue(formData.get("body"), "Note added."),
      createdById: session.user.id,
      createdAt: now,
      updatedAt: now
    };

    state.notes.unshift(note);
    addActivity(state, {
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      type: "Note",
      title: "Note added",
      body: note.body,
      actorUserId: session.user.id
    });

    appendAudit(state, session, {
      objectType: "note",
      objectId: note.id,
      action: "created",
      newValue: note
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages(crmDetailPathsFromForm(formData));
}

export async function createCallLogAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const { contact, companyId } = resolveWorkspaceCrmTargets(state, session.workspace.id, {
      contactId: stringValue(formData.get("contactId")) || undefined,
      companyId: stringValue(formData.get("companyId")) || undefined
    });
    const contactId = contact?.id;
    const durationMinutes = Math.max(0, numberValue(formData.get("durationMinutes")));
    const call: CallLog = {
      id: `call-${randomUUID()}`,
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      phone: stringValue(formData.get("phone"), contact?.phone ?? ""),
      outcome: callOutcomeValue(formData.get("outcome")),
      durationSeconds: Math.round(durationMinutes * 60),
      notes: stringValue(formData.get("notes"), "Manual call logged."),
      createdById: session.user.id,
      createdAt: new Date().toISOString()
    };

    state.callLogs.unshift(call);
    addActivity(state, {
      workspaceId: session.workspace.id,
      companyId,
      contactId,
      type: "Call",
      title: `${call.outcome} call logged`,
      body: call.notes,
      actorUserId: session.user.id,
      metadata: { phone: call.phone, durationSeconds: call.durationSeconds }
    });

    appendAudit(state, session, {
      objectType: "call_log",
      objectId: call.id,
      action: "created",
      newValue: call
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages(crmDetailPathsFromForm(formData));
}

export async function createCustomFieldAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const now = new Date().toISOString();
    const field: CustomField = {
      id: `field-${randomUUID()}`,
      workspaceId: session.workspace.id,
      objectType: customFieldObjectValue(formData.get("objectType")),
      name: stringValue(formData.get("name"), "Custom field"),
      fieldType: customFieldTypeValue(formData.get("fieldType")),
      options: splitList(formData.get("options")),
      createdAt: now
    };

    if (field.fieldType !== "select") {
      field.options = undefined;
    }

    state.customFields.unshift(field);
    appendAudit(state, session, {
      objectType: "custom_field",
      objectId: field.id,
      action: "created",
      newValue: field
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages();
}

export async function setCustomFieldValueAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_crm");
    const customFieldId = stringValue(formData.get("customFieldId"));
    const objectId = stringValue(formData.get("objectId"));
    const value = stringValue(formData.get("value"));
    const field = state.customFields.find(
      (item) => item.id === customFieldId && item.workspaceId === session.workspace.id
    );

    if (!field) {
      throw new Error("Custom field not found.");
    }

    const now = new Date().toISOString();
    const existing = state.customFieldValues.find(
      (item) => item.workspaceId === session.workspace.id && item.customFieldId === customFieldId && item.objectId === objectId
    );

    if (existing) {
      existing.value = value;
      existing.updatedAt = now;
    } else {
      state.customFieldValues.unshift({
        id: `cfv-${randomUUID()}`,
        workspaceId: session.workspace.id,
        customFieldId,
        objectId,
        value,
        updatedAt: now
      });
    }

    const activityTarget = activityTargetForCustomField(state, field.objectType, objectId, session.workspace.id);
    addActivity(state, {
      workspaceId: session.workspace.id,
      companyId: activityTarget.companyId,
      contactId: activityTarget.contactId,
      opportunityId: activityTarget.opportunityId,
      type: "Status change",
      title: `${field.name} updated`,
      body: value,
      actorUserId: session.user.id,
      metadata: { customFieldId }
    });

    appendAudit(state, session, {
      objectType: "custom_field_value",
      objectId,
      action: "updated",
      newValue: { customFieldId, value }
    });
  }, { normalizedTables: crmWriteTables });

  revalidateCrmPages([`/crm/contacts/${stringValue(formData.get("objectId"))}`, `/crm/accounts/${stringValue(formData.get("objectId"))}`]);
}

export async function runSdrAssignmentAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const result = assignWorkspaceLeads(state, session.workspace.id, session.user.id);
    const sla = refreshSlaStatuses(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "sdr_assignment",
      objectId: session.workspace.id,
      action: "assignment_run",
      newValue: { ...result, sla }
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
}

export async function logFirstTouchAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr");
    const assignment = recordFirstTouch(state, {
      workspaceId: session.workspace.id,
      assignmentId: stringValue(formData.get("assignmentId")),
      actorUserId: session.user.id,
      channel: outreachChannelValue(formData.get("channel")),
      outcome: sdrLeadStatusValue(formData.get("outcome")),
      notes: stringValue(formData.get("notes"), "First touch logged."),
      followUpDueAt: dateTimeValue(formData.get("followUpDueAt"))
    });

    appendAudit(state, session, {
      objectType: "sdr_assignment",
      objectId: assignment.id,
      action: "first_touch_logged",
      newValue: assignment
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
}

export async function completeFollowUpReminderAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr");
    const reminder = completeReminder(state, stringValue(formData.get("id")), session.user.id, session.workspace.id);

    appendAudit(state, session, {
      objectType: "follow_up_reminder",
      objectId: reminder.id,
      action: "completed",
      newValue: reminder
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
}

export async function reassignSdrAssignmentAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const assignment = reassignSdrAssignment(state, {
      workspaceId: session.workspace.id,
      assignmentId: stringValue(formData.get("assignmentId")),
      nextSdrId: stringValue(formData.get("nextSdrId"), session.user.id),
      actorUserId: session.user.id,
      reason: stringValue(formData.get("reason"), "Manual manager reassignment."),
      method: assignmentMethodValue(formData.get("assignmentMethod"))
    });

    appendAudit(state, session, {
      objectType: "sdr_assignment",
      objectId: assignment.id,
      action: "reassigned",
      newValue: assignment
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
}

export async function applyReassignmentRulesAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const result = applyReassignmentRecommendations(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "reassignment_rule",
      objectId: session.workspace.id,
      action: "recommendations_applied",
      newValue: result
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
}

export async function createReassignmentRuleAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const rule = createReassignmentRule({
      workspaceId: session.workspace.id,
      name: stringValue(formData.get("name"), "Custom reassignment rule"),
      trigger: reassignmentTriggerValue(formData.get("trigger")),
      assignmentMethod: assignmentMethodValue(formData.get("assignmentMethod")),
      thresholdHours: numberValue(formData.get("thresholdHours")) || 4,
      targetTeamId: stringValue(formData.get("targetTeamId")) || undefined
    });

    state.reassignmentRules.unshift(rule);
    appendAudit(state, session, {
      objectType: "reassignment_rule",
      objectId: rule.id,
      action: "created",
      newValue: rule
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
}

export async function deleteReassignmentRuleAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const id = stringValue(formData.get("id"));
    state.reassignmentRules = state.reassignmentRules.filter(
      (rule) => !(rule.id === id && rule.workspaceId === session.workspace.id)
    );

    appendAudit(state, session, {
      objectType: "reassignment_rule",
      objectId: id,
      action: "deleted"
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
}

export async function createOutreachCampaignAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_outreach");
    const campaign = createCampaign({
      workspaceId: session.workspace.id,
      name: stringValue(formData.get("name"), "New outreach campaign"),
      campaignType: campaignTypeValue(formData.get("campaignType")),
      targetSegment: stringValue(formData.get("targetSegment"), "General outbound"),
      ownerUserId: stringValue(formData.get("ownerUserId"), session.user.id),
      sendingDomain: stringValue(formData.get("sendingDomain"), "outbound.syncore.tech"),
      mailboxGroup: stringValue(formData.get("mailboxGroup"), "syncore-sdr"),
      status: campaignStatusValue(formData.get("status")),
      sourceJobIds: splitList(formData.get("sourceJobIds"))
    });

    state.outreachCampaigns.unshift(campaign);
    appendAudit(state, session, {
      objectType: "outreach_campaign",
      objectId: campaign.id,
      action: "created",
      newValue: campaign
    });
  }, { normalizedTables: outreachSetupWriteTables });

  revalidateOutreachPages();
}

export async function createCampaignSequenceAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_outreach");
    const campaignId = stringValue(formData.get("campaignId"));
    const campaign = state.outreachCampaigns.find(
      (item) => item.id === campaignId && item.workspaceId === session.workspace.id
    );

    if (!campaign) {
      throw new Error("Campaign not found.");
    }

    const sequence = createSequence({
      workspaceId: session.workspace.id,
      campaignId: campaign.id,
      name: stringValue(formData.get("name"), `${campaign.name} sequence`),
      targetSegment: stringValue(formData.get("targetSegment"), campaign.targetSegment),
      createdById: session.user.id
    });

    state.campaignSequences.unshift(sequence);
    appendAudit(state, session, {
      objectType: "campaign_sequence",
      objectId: sequence.id,
      action: "created",
      newValue: sequence
    });
  }, { normalizedTables: outreachSetupWriteTables });

  revalidateOutreachPages();
}

export async function createSequenceStepAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_outreach");
    const sequenceId = stringValue(formData.get("sequenceId"));
    const sequence = state.campaignSequences.find(
      (item) => item.id === sequenceId && item.workspaceId === session.workspace.id
    );

    if (!sequence) {
      throw new Error("Sequence not found.");
    }

    const step = createSequenceStep({
      workspaceId: session.workspace.id,
      sequenceId,
      stepNumber: numberValue(formData.get("stepNumber")) || 1,
      channel: campaignChannelValue(formData.get("channel")),
      delayDays: numberValue(formData.get("delayDays")),
      subject: stringValue(formData.get("subject")) || undefined,
      bodyTemplate: stringValue(formData.get("bodyTemplate")) || undefined,
      callScript: stringValue(formData.get("callScript")) || undefined,
      smsTemplate: stringValue(formData.get("smsTemplate")) || undefined,
      manualTaskInstruction: stringValue(formData.get("manualTaskInstruction")) || undefined,
      personalizationVariables: splitList(formData.get("personalizationVariables")),
      requiredFields: splitList(formData.get("requiredFields")),
      physicalAddress: stringValue(formData.get("physicalAddress")) || undefined
    });

    state.sequenceSteps.unshift(step);
    appendAudit(state, session, {
      objectType: "sequence_step",
      objectId: step.id,
      action: "created",
      newValue: step
    });
  }, { normalizedTables: outreachSetupWriteTables });

  revalidateOutreachPages();
}

export async function sendCampaignAction(formData: FormData) {
  const campaignId = stringValue(formData.get("campaignId"));
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "manage_outreach");
  const plan = {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    ...buildCampaignSendBatch(state, session.workspace.id, campaignId, { batchSize: outreachBatchSize() })
  };

  if (!plan.credentialOk) {
    await updateState((state, session) => {
      assertPermission(session, "manage_outreach");
      const result = simulateCampaignSend(state, session.workspace.id, campaignId, session.user.id);

      appendAudit(state, session, {
        objectType: "outreach_campaign",
        objectId: campaignId,
        action: "provider_send_simulated",
        newValue: { ...result, reason: plan.reason }
      });
    }, { normalizedTables: outreachCampaignSendWriteTables });

    revalidateOutreachPages();
    return;
  }

  const outcomes = plan.recipients.length
    ? await sendCampaignBatch(plan.recipients, plan.credential, plan.workspaceId)
    : [];

  await updateState((state, session) => {
    assertPermission(session, "manage_outreach");
    const summary = recordCampaignSendResults(state, session.workspace.id, campaignId, session.user.id, outcomes);

    appendAudit(state, session, {
      objectType: "outreach_campaign",
      objectId: campaignId,
      action: "provider_send_live",
      newValue: {
        sent: summary.sent,
        failed: summary.failed,
        completed: summary.completed,
        remaining: plan.remaining,
        totalEligible: plan.totalEligible
      }
    });
  }, { normalizedTables: outreachCampaignSendWriteTables });

  revalidateOutreachPages();
}

export { sendCampaignAction as simulateCampaignSendAction };

export async function scoreAndAssignByCampaignAction(formData: FormData) {
  const campaignId = stringValue(formData.get("campaignId"));
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const now = new Date().toISOString();
    const rescored = applyCampaignEngagementScores(state, session.workspace.id, campaignId, now);
    const eligibleContactIds = new Set(rescored.orderedContactIds);
    const result = assignWorkspaceLeads(state, session.workspace.id, session.user.id, now, {
      orderedContactIds: rescored.orderedContactIds,
      eligibleContactIds
    });
    const sla = refreshSlaStatuses(state, session.workspace.id, now);

    appendAudit(state, session, {
      objectType: "sdr_assignment",
      objectId: campaignId,
      action: "leads_assigned_by_engagement",
      newValue: { campaignId, rescored: rescored.rescored, assigned: result.created, sla }
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages(["/outreach/campaigns", "/outreach/events"]);
}

export async function assignLeadsNowAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const profile = state.searchProfiles
      .filter((item) => item.workspaceId === session.workspace.id)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    const contacts = state.contacts.filter((contact) => contact.workspaceId === session.workspace.id);
    const { ready, held } = partitionLeadsForAssignment({ contacts, requiredFields: profile?.requiredFields });
    const eligibleContactIds = new Set(ready.map((contact) => contact.id));
    const result = assignWorkspaceLeads(
      state,
      session.workspace.id,
      session.user.id,
      new Date().toISOString(),
      { eligibleContactIds }
    );
    const sla = refreshSlaStatuses(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "sdr_assignment",
      objectId: session.workspace.id,
      action: "leads_assigned_precampaign",
      newValue: { ...result, held: held.length, sla, gated: true }
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateSdrPages();
  revalidateLeadEnginePages(["/build-list"]);
}

function assertAssignedContactForOutreach(state: AppState, session: Session, contactId: string) {
  if (restrictsToOwnedRecords(session) && !ownedCrmRecordScope(state, session).contactIds.has(contactId)) {
    throw new Error("You can only send or log outreach for contacts assigned to you.");
  }
}

export async function recordEmailEventAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "send_direct_outreach");
    const contactId = stringValue(formData.get("contactId"));
    assertAssignedContactForOutreach(state, session, contactId);
    const event = createEmailEvent(state, {
      workspaceId: session.workspace.id,
      contactId,
      campaignId: stringValue(formData.get("campaignId")) || undefined,
      sequenceId: stringValue(formData.get("sequenceId")) || undefined,
      sequenceStepId: stringValue(formData.get("sequenceStepId")) || undefined,
      eventType: emailEventTypeValue(formData.get("eventType")),
      subject: stringValue(formData.get("subject"), "Manual email event"),
      bodySnapshot: stringValue(formData.get("bodySnapshot"), "Manual local provider event."),
      actorUserId: session.user.id,
      bounceType: stringValue(formData.get("bounceType")) === "Hard" ? "Hard" : stringValue(formData.get("bounceType")) === "Soft" ? "Soft" : undefined,
      smtpCode: stringValue(formData.get("smtpCode")) || undefined
    });

    appendAudit(state, session, {
      objectType: "email_event",
      objectId: event.id,
      action: "created",
      newValue: event
    });
  }, { normalizedTables: outreachEmailWriteTables });

  revalidateOutreachPages(crmDetailPathsFromForm(formData));
}

export async function sendDirectEmailAction(formData: FormData) {
  const contactId = stringValue(formData.get("contactId"));
  const requestId = stringValue(formData.get("requestId"), `direct-${contactId}-${randomUUID()}`);
  const subject = stringValue(formData.get("subject"), "Quick question");
  const body = stringValue(formData.get("bodySnapshot"), "Hi {{first_name}}, quick question about {{company}}.");

  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "send_direct_outreach");
  assertAssignedContactForOutreach(state, session, contactId);
  const plan = buildDirectEmailSendPlan(state, {
    workspaceId: session.workspace.id,
    actor: session.user,
    requestId,
    mode: "one_to_one",
    contactIds: [contactId],
    subject,
    body
  });

  const outcomes = plan.credentialOk
    ? await sendDirectEmailBatch(plan.recipients, plan.credential, plan.workspaceId)
    : plan.recipients.map((recipient) => ({
        contactId: recipient.contactId,
        status: "failed" as const,
        reason: plan.reason
      }));

  await updateState((state, session) => {
    assertPermission(session, "send_direct_outreach");
    const summary = recordDirectEmailSendResults(state, {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      recipients: plan.recipients,
      outcomes,
      skipped: plan.skipped
    });

    appendAudit(state, session, {
      objectType: "email_event",
      objectId: requestId,
      action: plan.credentialOk ? "direct_email_live" : "direct_email_not_sent",
      newValue: {
        ...summary,
        totalRequested: plan.totalRequested,
        reason: plan.credentialOk ? undefined : plan.reason
      }
    });
  }, { normalizedTables: outreachEmailWriteTables });

  revalidateOutreachPages([`/crm/contacts/${contactId}`]);
}

export async function sendAssignedBulkEmailAction(formData: FormData) {
  const requestId = stringValue(formData.get("requestId"), `sdr-bulk-${randomUUID()}`);
  const subject = stringValue(formData.get("subject"), "Quick question");
  const body = stringValue(formData.get("bodySnapshot"), "Hi {{first_name}}, quick question about {{company}}.");
  const audience = bulkEmailAudienceValue(formData.get("audience"));
  const rawOwnerUserId = stringValue(formData.get("ownerUserId"));
  const rawLimit = numberValue(formData.get("limit")) || outreachBatchSize();
  const limit = Math.max(1, Math.min(rawLimit, outreachBatchSize()));

  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "send_direct_outreach");
  const ownerUserId = restrictsToOwnedRecords(session)
    ? session.user.id
    : rawOwnerUserId === "all"
      ? undefined
      : rawOwnerUserId || session.user.id;
  const contactIds = assignedBulkEmailContactIds(state, {
    workspaceId: session.workspace.id,
    ownerUserId,
    audience,
    limit
  });
  const sendPlan = buildDirectEmailSendPlan(state, {
    workspaceId: session.workspace.id,
    actor: session.user,
    requestId,
    mode: "sdr_bulk",
    contactIds,
    subject,
    body
  });
  const plan = { ...sendPlan, audience, ownerUserId };

  const outcomes = plan.credentialOk
    ? await sendDirectEmailBatch(plan.recipients, plan.credential, plan.workspaceId)
    : plan.recipients.map((recipient) => ({
        contactId: recipient.contactId,
        status: "failed" as const,
        reason: plan.reason
      }));

  await updateState((state, session) => {
    assertPermission(session, "send_direct_outreach");
    const summary = recordDirectEmailSendResults(state, {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      recipients: plan.recipients,
      outcomes,
      skipped: plan.skipped
    });

    appendAudit(state, session, {
      objectType: "email_event",
      objectId: requestId,
      action: plan.credentialOk ? "sdr_bulk_email_live" : "sdr_bulk_email_not_sent",
      newValue: {
        ...summary,
        totalRequested: plan.totalRequested,
        audience: plan.audience,
        ownerUserId: plan.ownerUserId,
        reason: plan.credentialOk ? undefined : plan.reason
      }
    });
  }, { normalizedTables: outreachEmailWriteTables });

  revalidateOutreachPages();
}

export async function recordSmsEventAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "send_direct_outreach");
    const contactId = stringValue(formData.get("contactId"));
    assertAssignedContactForOutreach(state, session, contactId);
    const event = createSmsEvent(state, {
      workspaceId: session.workspace.id,
      contactId,
      campaignId: stringValue(formData.get("campaignId")) || undefined,
      sequenceId: stringValue(formData.get("sequenceId")) || undefined,
      sequenceStepId: stringValue(formData.get("sequenceStepId")) || undefined,
      sdrUserId: stringValue(formData.get("sdrUserId"), session.user.id),
      direction: stringValue(formData.get("direction"), "Outbound") === "Inbound" ? "Inbound" : "Outbound",
      body: stringValue(formData.get("body"), "Manual SMS event."),
      status: smsEventStatusValue(formData.get("status"))
    });

    appendAudit(state, session, {
      objectType: "sms_event",
      objectId: event.id,
      action: "created",
      newValue: event
    });
  }, { normalizedTables: outreachSmsWriteTables });

  revalidateOutreachPages(crmDetailPathsFromForm(formData));
}

export async function recordTrackedCallAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "send_direct_outreach");
    const contactId = stringValue(formData.get("contactId"));
    assertAssignedContactForOutreach(state, session, contactId);
    const call = createTrackedCall(state, {
      workspaceId: session.workspace.id,
      contactId,
      sdrUserId: stringValue(formData.get("sdrUserId"), session.user.id),
      direction: stringValue(formData.get("direction"), "Outbound") === "Inbound" ? "Inbound" : "Outbound",
      callStatus: trackedCallStatusValue(formData.get("callStatus")),
      disposition: callDispositionValue(formData.get("disposition")),
      durationSeconds: numberValue(formData.get("durationSeconds")),
      recordingConsent: recordingConsentValue(formData.get("recordingConsent")),
      recordingConsentSource: stringValue(formData.get("recordingConsentSource")) || undefined,
      recordingUrl: stringValue(formData.get("recordingUrl")) || undefined,
      transcript: stringValue(formData.get("transcript")) || undefined,
      callSummary: stringValue(formData.get("callSummary")) || undefined,
      nextStep: stringValue(formData.get("nextStep")) || undefined
    });

    appendAudit(state, session, {
      objectType: "tracked_call",
      objectId: call.id,
      action: "created",
      newValue: call
    });
  }, { normalizedTables: outreachTrackedCallWriteTables });

  revalidateOutreachPages(crmDetailPathsFromForm(formData));
}

export async function updateOutreachProviderStatusAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_outreach");
    const id = stringValue(formData.get("id"));
    const provider = state.outreachProviders.find(
      (item) => item.id === id && item.workspaceId === session.workspace.id
    );

    if (!provider) {
      throw new Error("Provider not found.");
    }

    const oldStatus = provider.status;
    provider.status = outreachProviderStatusValue(formData.get("status"));
    provider.updatedAt = new Date().toISOString();

    appendAudit(state, session, {
      objectType: "outreach_provider",
      objectId: provider.id,
      action: "status_updated",
      oldValue: { status: oldStatus },
      newValue: { status: provider.status }
    });
  }, { normalizedTables: outreachSetupWriteTables });

  revalidateOutreachPages();
}

export async function generateReportSnapshotsAction() {
  await updateState((state, session) => {
    assertPermission(session, "view_reports");
    const result = generateReportSnapshots(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "report_snapshot",
      objectId: session.workspace.id,
      action: "generated",
      newValue: result,
      reason: "Admin reporting snapshot generated"
    });
  }, { normalizedTables: reportingWriteTables });

  revalidateDevPages(["/reports", "/reports/compliance"]);
}

export async function runRetentionPolicyAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_retention");
    const policyId = stringValue(formData.get("policyId"));
    const mode = retentionRunModeValue(formData.get("mode"));
    const run = runRetentionPolicy(state, session.workspace.id, policyId, mode, session.user.id);

    appendAudit(state, session, {
      objectType: "retention_policy",
      objectId: policyId,
      action: mode === "Apply" ? "retention_applied" : "retention_previewed",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: reportingWriteTables });

  revalidateDevPages(["/compliance", "/reports/compliance"]);
  revalidateLeadEnginePages();
  revalidateCrmPages();
}

export async function updateRetentionPolicyAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_retention");
    const id = stringValue(formData.get("id"));
    const policy = state.retentionPolicies.find((item) => item.id === id && item.workspaceId === session.workspace.id);

    if (!policy) {
      throw new Error("Retention policy not found.");
    }

    const oldValue = { ...policy };
    policy.retentionDays = Math.max(0, numberValue(formData.get("retentionDays")));
    policy.action = retentionActionValue(formData.get("action"));
    policy.active = formData.get("active") === "on";
    policy.legalBasis = stringValue(formData.get("legalBasis"), policy.legalBasis);
    policy.notes = stringValue(formData.get("notes"), policy.notes);
    policy.updatedAt = new Date().toISOString();

    appendAudit(state, session, {
      objectType: "retention_policy",
      objectId: policy.id,
      action: "updated",
      oldValue,
      newValue: policy
    });
  }, { normalizedTables: reportingWriteTables });

  revalidateDevPages(["/reports", "/reports/compliance", "/compliance"]);
}

export async function createDataSubjectRequestAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_compliance");
    const request = createDataSubjectRequest(state, {
      workspaceId: session.workspace.id,
      requestType: dataSubjectRequestTypeValue(formData.get("requestType")),
      email: stringValue(formData.get("email")) || undefined,
      phone: stringValue(formData.get("phone")) || undefined,
      notes: stringValue(formData.get("notes")) || undefined
    });

    appendAudit(state, session, {
      objectType: "data_subject_request",
      objectId: request.id,
      action: "created",
      newValue: request,
      reason: request.notes
    });
  }, { normalizedTables: complianceWriteTables });

  revalidateDevPages(["/reports", "/reports/compliance", "/compliance"]);
}

export async function completeDataSubjectRequestAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_compliance");
    const result = completeDataSubjectRequest(state, {
      workspaceId: session.workspace.id,
      requestId: stringValue(formData.get("requestId")),
      actorUserId: session.user.id,
      evidence: stringValue(formData.get("evidence")) || undefined
    });
    runWorkspaceVerification(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "data_subject_request",
      objectId: result.request.id,
      action: "completed",
      newValue: result,
      reason: result.request.evidence
    });
  }, { normalizedTables: complianceWriteTables });

  revalidateDevPages(["/reports", "/reports/compliance", "/compliance"]);
  revalidateLeadEnginePages();
  revalidateCrmPages();
}

export async function updateContactComplianceAction(formData: FormData) {
  const contactId = stringValue(formData.get("contactId"));
  await updateState((state, session) => {
    assertPermission(session, "manage_compliance");
    const contact = state.contacts.find((item) => item.id === contactId && item.workspaceId === session.workspace.id);

    if (!contact) {
      throw new Error("Contact not found.");
    }

    const oldValue = {
      lawfulBasis: contact.lawfulBasis,
      consentStatus: contact.consentStatus,
      consentSource: contact.consentSource,
      doNotContact: contact.doNotContact
    };
    const now = new Date().toISOString();
    contact.lawfulBasis = lawfulBasisValue(formData.get("lawfulBasis"));
    contact.consentStatus = consentStatusValue(formData.get("consentStatus"));
    contact.consentSource = stringValue(formData.get("consentSource"), "Manual compliance update");
    contact.consentCapturedAt = now;
    contact.doNotContact =
      formData.get("doNotContact") === "on" ||
      contact.lawfulBasis === "Do not contact" ||
      contact.consentStatus === "Revoked";

    if (contact.doNotContact) {
      suppressContact(contact, contact.consentSource, now);
      const exists = state.suppressionRecords.some(
        (record) =>
          record.workspaceId === session.workspace.id &&
          ((contact.email && record.email?.toLowerCase() === contact.email.toLowerCase()) ||
            (contact.phone && record.phone === contact.phone))
      );
      if (!exists) {
        state.suppressionRecords.unshift({
          id: `supp-${randomUUID()}`,
          workspaceId: session.workspace.id,
          type: contact.phone && !contact.email ? "Do not call" : "Unsubscribe",
          email: contact.email || undefined,
          phone: contact.phone || undefined,
          reason: contact.consentSource,
          source: "Manual contact compliance",
          createdAt: now
        });
      }
    } else {
      contact.updatedAt = now;
    }

    appendAudit(state, session, {
      objectType: "contact",
      objectId: contact.id,
      action: "compliance_updated",
      oldValue,
      newValue: {
        lawfulBasis: contact.lawfulBasis,
        consentStatus: contact.consentStatus,
        consentSource: contact.consentSource,
        doNotContact: contact.doNotContact
      }
    });
  }, { normalizedTables: complianceWriteTables });

  revalidateCrmPages([`/crm/contacts/${contactId}`]);
}

export async function resolveDeliverabilityAlertAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_compliance");
    const alertId = stringValue(formData.get("alertId"));
    const alert = resolveDeliverabilityAlert(state, session.workspace.id, alertId, session.user.id);

    appendAudit(state, session, {
      objectType: "deliverability_alert",
      objectId: alert.id,
      action: "resolved",
      newValue: alert,
      reason: stringValue(formData.get("reason"), "Reviewed by compliance")
    });
  }, { normalizedTables: complianceWriteTables });

  revalidateDevPages(["/reports/compliance", "/compliance"]);
}

export async function updateComplianceChecklistStatusAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_compliance");
    const itemId = stringValue(formData.get("itemId"));
    const item = state.complianceChecklistItems.find(
      (checklistItem) => checklistItem.id === itemId && checklistItem.workspaceId === session.workspace.id
    );

    if (!item) {
      throw new Error("Compliance checklist item not found.");
    }

    const oldValue = { status: item.status, evidence: item.evidence };
    item.status = complianceStatusValue(formData.get("status"));
    item.evidence = stringValue(formData.get("evidence"), item.evidence);
    item.updatedAt = new Date().toISOString();

    appendAudit(state, session, {
      objectType: "compliance_checklist_item",
      objectId: item.id,
      action: "status_updated",
      oldValue,
      newValue: { status: item.status, evidence: item.evidence }
    });
  }, { normalizedTables: complianceWriteTables });

  revalidateDevPages(["/reports/compliance", "/compliance"]);
}

export async function runAiAutomationSuiteAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = runAiAutomationSuite(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_automation_run",
      objectId: run.id,
      action: "suite_run",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function generateAiPersonalizationsAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = generateAiPersonalizations(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_personalization",
      objectId: run.id,
      action: "generated",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function classifyAiRepliesAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = classifyAiReplies(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_reply_classification",
      objectId: run.id,
      action: "generated",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function generateAiCallSummariesAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = generateAiCallSummaries(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_call_summary",
      objectId: run.id,
      action: "generated",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function generateAiLeadScoresAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = generateAiLeadScores(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_lead_score",
      objectId: run.id,
      action: "generated",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function generateAiIcpRecommendationsAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = generateAiIcpRecommendations(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_icp_recommendation",
      objectId: run.id,
      action: "generated",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function createAiIcpRecommendationAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const prompt = stringValue(formData.get("prompt"), "Find high-fit B2B accounts similar to our best customers.");
    const recommendation = createIcpRecommendationFromPrompt(state, session.workspace.id, session.user.id, prompt);

    appendAudit(state, session, {
      objectType: "ai_icp_recommendation",
      objectId: recommendation.id,
      action: "created_from_prompt",
      newValue: recommendation,
      reason: "AI ICP builder prompt"
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

/**
 * Build List — step 1: draft an ICP from a free-text description. The model call
 * runs out-of-band (authorize -> async LLM -> persist) so no DB transaction is
 * held across network I/O; it falls back to the deterministic parser when the
 * LLM is disabled or errors. Gated by manage_profiles so lead-gen Managers and
 * Data Operators can use it (not just Admins).
 */
export async function draftLeadListIcpAction(formData: FormData) {
  const prompt = stringValue(formData.get("prompt"), "Find high-fit B2B accounts similar to our best customers.");

  // Phase A — authorize before any LLM spend.
  const { session } = await getWorkspaceSessionContext("manage_profiles");
  assertPermission(session, "manage_profiles");

  // Phase B — async: resolve the ICP draft (model when enabled, else keyword parser).
  const { draft } = await resolveIcpDraft(prompt, () => parsePromptForIcp(prompt));

  // Phase C — persist.
  await updateState((freshState, freshSession) => {
    assertPermission(freshSession, "manage_profiles");
    const recommendation = createIcpRecommendationFromPrompt(
      freshState,
      freshSession.workspace.id,
      freshSession.user.id,
      prompt,
      draft
    );

    appendAudit(freshState, freshSession, {
      objectType: "ai_icp_recommendation",
      objectId: recommendation.id,
      action: "created_from_prompt",
      newValue: recommendation,
      reason: "Build List ICP prompt"
    });
  }, { normalizedTables: aiWriteTables });

  revalidateLeadEnginePages(["/build-list"]);
}

/**
 * Build List — step 2: apply user edits to the drafted ICP and create a real
 * SearchProfile from it. Gated by manage_profiles.
 */
export async function confirmLeadListIcpAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_profiles");
    const recommendationId = stringValue(formData.get("recommendationId"));

    const industries = stringValue(formData.get("industries"));
    const titles = stringValue(formData.get("titles"));
    const geographies = stringValue(formData.get("geographies"));
    const segments = stringValue(formData.get("segments"));

    updateIcpRecommendation(state, session.workspace.id, recommendationId, {
      name: stringValue(formData.get("name")) || undefined,
      industries: industries ? splitList(industries) : undefined,
      titles: titles ? splitList(titles) : undefined,
      geographies: geographies ? splitList(geographies) : undefined,
      segments: segments ? splitList(segments) : undefined
    });

    const result = applyAiIcpRecommendation(state, session.workspace.id, recommendationId, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_icp_recommendation",
      objectId: result.recommendation.id,
      action: "applied_to_search_profile",
      newValue: result,
      reason: "Build List ICP confirmed into a Search Profile"
    });
  }, { normalizedTables: aiWriteTables });

  revalidateLeadEnginePages(["/build-list", "/search-profiles"]);
}

/**
 * Build List — step 4: run the recommended waterfall over the workspace's
 * contacts that still need an email or phone. enrichContactsWithWaterfall does
 * its own read/authorize(manage_waterfalls)/async/persist; this just selects the
 * targets. Real enrichment values require live providers (mock otherwise).
 */
export async function approveBuildListEnrichmentAction(formData: FormData) {
  const templateId = stringValue(formData.get("templateId"));
  if (!templateId) {
    throw new Error("A waterfall template is required.");
  }

  const { session, workspaceId } = await getWorkspaceSessionContext("manage_waterfalls");
  assertPermission(session, "manage_waterfalls");
  const state = await readFastLeadDashboardState(session, workspaceId) ?? await readState();

  const contactIds = state.contacts
    .filter(
      (contact) =>
        contact.workspaceId === workspaceId && !contact.isSuppressed && (!contact.phone || !contact.email)
    )
    .slice(0, 200)
    .map((contact) => contact.id);

  if (contactIds.length > 0) {
    await enrichContactsWithWaterfall({ templateId, contactIds });
  }

  revalidateLeadEnginePages(["/build-list"]);
}

/**
 * Build List — step 5: quality-gate, then fairly assign. Only ready leads (graded,
 * not suppressed, with the profile's required fields) are eligible; the rest are
 * held back. Reuses the capacity-weighted assignWorkspaceLeads with an
 * eligibility filter so low-quality leads never reach SDR queues.
 */
export async function assignBuildListLeadsAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_sdr_team");
    const profile = state.searchProfiles
      .filter((item) => item.workspaceId === session.workspace.id)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    const contacts = state.contacts.filter((contact) => contact.workspaceId === session.workspace.id);
    const { ready, held } = partitionLeadsForAssignment({ contacts, requiredFields: profile?.requiredFields });
    const eligibleContactIds = new Set(ready.map((contact) => contact.id));
    const result = assignWorkspaceLeads(
      state,
      session.workspace.id,
      session.user.id,
      new Date().toISOString(),
      { eligibleContactIds }
    );
    const sla = refreshSlaStatuses(state, session.workspace.id);

    appendAudit(state, session, {
      objectType: "sdr_assignment",
      objectId: session.workspace.id,
      action: "assignment_run",
      newValue: { ...result, held: held.length, sla, gated: true }
    });
  }, { normalizedTables: sdrWriteTables });

  revalidateLeadEnginePages();
  revalidateSdrPages();
}

export async function generateAiDeliverabilityRecommendationsAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = generateAiDeliverabilityRecommendations(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_deliverability_recommendation",
      objectId: run.id,
      action: "generated",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function generateAiRevenueInsightsAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const run = generateAiRevenueInsights(state, session.workspace.id, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_revenue_insight",
      objectId: run.id,
      action: "generated",
      newValue: run,
      reason: run.summary
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function applyAiLeadScoreAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const predictionId = stringValue(formData.get("predictionId"));
    const prediction = applyAiLeadScore(state, session.workspace.id, predictionId, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_lead_score",
      objectId: prediction.id,
      action: "applied",
      newValue: prediction,
      reason: "AI lead score applied to CRM contact"
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
  revalidateCrmPages();
}

export async function applyAiPersonalizationAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const personalizationId = stringValue(formData.get("personalizationId"));
    const personalization = applyAiPersonalization(state, session.workspace.id, personalizationId, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_personalization",
      objectId: personalization.id,
      action: "applied",
      newValue: personalization,
      reason: "AI personalization stored as CRM activity"
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
  revalidateCrmPages();
}

export async function applyAiIcpRecommendationAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const recommendationId = stringValue(formData.get("recommendationId"));
    const result = applyAiIcpRecommendation(state, session.workspace.id, recommendationId, session.user.id);

    appendAudit(state, session, {
      objectType: "ai_icp_recommendation",
      objectId: result.recommendation.id,
      action: "applied_to_search_profile",
      newValue: result,
      reason: "AI ICP recommendation converted into a Search Profile"
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
  revalidateLeadEnginePages(["/search-profiles", "/build-list"]);
}

export async function dismissAiRecordAction(formData: FormData) {
  await updateState((state, session) => {
    assertPermission(session, "manage_ai_automation");
    const recordType = stringValue(formData.get("recordType"), "ai_record");
    const recordId = stringValue(formData.get("recordId"));
    const record = dismissAiRecord(state, session.workspace.id, recordType, recordId);

    appendAudit(state, session, {
      objectType: recordType,
      objectId: record.id,
      action: "dismissed",
      newValue: record,
      reason: "AI recommendation dismissed"
    });
  }, { normalizedTables: aiWriteTables });

  revalidateDevPages(["/automation"]);
}

export async function saveProviderConnectionAction(formData: FormData) {
  await saveProviderConnection({
    providerId: providerIdValue(formData.get("providerId")),
    enabled: formData.get("enabled") === "on",
    credentialLabel: stringValue(formData.get("credentialLabel")),
    secretValue: stringValue(formData.get("secretValue")),
    scopes: splitList(formData.get("scopes")),
    allowedOperations: providerCapabilityValues(formData),
    rateLimitPerMinute: optionalNumberValue(formData.get("rateLimitPerMinute")),
    dailyBudgetCents: optionalNumberValue(formData.get("dailyBudgetCents")),
    waterfallOrder: optionalNumberValue(formData.get("waterfallOrder"))
  });

  revalidateDevPages(["/integrations"]);
}

export async function testProviderConnectionAction(formData: FormData) {
  await testProviderConnection(providerIdValue(formData.get("providerId")));
  revalidateDevPages(["/integrations"]);
}

export async function setProviderExecutionModeAction(formData: FormData) {
  const executionMode = stringValue(formData.get("executionMode")) === "live" ? "live" : "mock";
  await setProviderConnectionExecutionMode(providerIdValue(formData.get("providerId")), executionMode);
  revalidateDevPages(["/integrations"]);
}

export async function disableProviderConnectionAction(formData: FormData) {
  await disableProviderConnectionForWorkspace(
    providerIdValue(formData.get("providerId")),
    stringValue(formData.get("reason"), "Disabled from Integration Center")
  );

  revalidateDevPages(["/integrations"]);
}

export async function resetPhase1DataAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_workspace");
    Object.assign(state, createSeedState());
  });

  revalidatePath("/", "layout");
}

function sourceValues(formData: FormData) {
  return formData
    .getAll("sources")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function stringValue(value: FormDataEntryValue | null, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim() || fallback;
}

function numberValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberValue(value: FormDataEntryValue | null | undefined) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function centsValue(value: FormDataEntryValue | null | undefined) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : undefined;
}

function providerIdValue(value: FormDataEntryValue | null): ProviderId {
  return stringValue(value) as ProviderId;
}

function providerCapabilityValues(formData: FormData): ProviderCapability[] {
  return formData.getAll("allowedOperations").map(String) as ProviderCapability[];
}

function bulkEmailAudienceValue(value: FormDataEntryValue | null): BulkEmailAudience {
  const audience = stringValue(value, "all_assigned");
  if (audience === "p1" || audience === "due_or_overdue") {
    return audience;
  }
  return "all_assigned";
}

function revalidateDevPages(paths: string[] = []) {
  const devPaths = paths.length
    ? paths
    : ["/integrations", "/access", "/reports", "/reports/compliance", "/compliance", "/automation"];

  for (const path of [...new Set(devPaths)]) {
    if (path) revalidatePath(path);
  }
}

function revalidateLeadEnginePages(paths: string[] = []) {
  const leadPaths = [
    "/",
    "/build-list",
    "/search-profiles",
    "/lead-jobs",
    "/staging",
    "/data-quality",
    "/enrichment",
    "/waterfalls",
    "/exports",
    ...paths
  ];

  for (const path of [...new Set(leadPaths)]) {
    if (path) revalidatePath(path);
  }
  revalidatePath("/waterfalls/[id]", "page");
}

function revalidateCrmPages(paths: string[] = []) {
  revalidatePath("/crm");
  revalidatePath("/crm/accounts");
  revalidatePath("/crm/accounts/[id]", "page");
  revalidatePath("/crm/contacts");
  revalidatePath("/crm/contacts/[id]", "page");
  revalidatePath("/crm/opportunities");
  for (const path of paths) {
    if (path) revalidatePath(path);
  }
}

function revalidateSdrPages(paths: string[] = []) {
  revalidatePath("/sdr/queue");
  revalidatePath("/sdr/manager");
  revalidateCrmPages(paths);
}

function revalidateOutreachPages(paths: string[] = []) {
  revalidatePath("/outreach/campaigns");
  revalidatePath("/outreach/events");
  revalidatePath("/sdr/queue");
  for (const path of paths) {
    if (path) revalidatePath(path);
  }
}

function crmDetailPathsFromForm(formData: FormData) {
  return [
    stringValue(formData.get("contactId")) ? `/crm/contacts/${stringValue(formData.get("contactId"))}` : "",
    stringValue(formData.get("companyId")) ? `/crm/accounts/${stringValue(formData.get("companyId"))}` : ""
  ].filter(Boolean);
}

function exportName(type: ExportRecord["type"]) {
  if (type === "companies") return "Companies export";
  if (type === "contacts") return "Contacts export";
  if (type === "phone_leads") return "Phone-ready leads";
  if (type === "sdr_assignments") return "SDR assignment queue";
  return "Verified email leads";
}

function gradeValues(formData: FormData): LeadGrade[] {
  const grades = formData.getAll("grades").map(String) as LeadGrade[];
  return grades.length ? grades : ["A", "B", "C"];
}

function optionalPriority(value: FormDataEntryValue | null): Priority | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  return value as Priority;
}

function opportunityStageValue(value: FormDataEntryValue | null): OpportunityStage {
  const stage = stringValue(value, "Prospecting") as OpportunityStage;
  return opportunityStages.includes(stage) ? stage : "Prospecting";
}

function taskPriorityValue(value: FormDataEntryValue | null): CrmTask["priority"] {
  const priority = stringValue(value, "Normal") as CrmTask["priority"];
  return taskPriorities.includes(priority) ? priority : "Normal";
}

function callOutcomeValue(value: FormDataEntryValue | null): CallLog["outcome"] {
  const outcome = stringValue(value, "Connected") as CallLog["outcome"];
  return callOutcomes.includes(outcome) ? outcome : "Connected";
}

function customFieldObjectValue(value: FormDataEntryValue | null): CustomField["objectType"] {
  const objectType = stringValue(value, "company");
  if (objectType === "contact" || objectType === "opportunity") return objectType;
  return "company";
}

function customFieldTypeValue(value: FormDataEntryValue | null): CustomField["fieldType"] {
  const fieldType = stringValue(value, "text");
  if (fieldType === "number" || fieldType === "date" || fieldType === "select") return fieldType;
  return "text";
}

function dateValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const date = new Date(`${value.trim()}T09:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function activityTargetForCustomField(
  state: Parameters<typeof runWorkspaceVerification>[0],
  objectType: CustomField["objectType"],
  objectId: string,
  workspaceId: string
) {
  if (objectType === "contact") {
    const contact = requireWorkspaceScopedRecord(
      state.contacts.find((item) => item.id === objectId),
      workspaceId,
      "Custom field contact target"
    );
    return { companyId: contact?.companyId, contactId: contact?.id, opportunityId: undefined };
  }

  if (objectType === "opportunity") {
    const opportunity = requireWorkspaceScopedRecord(
      state.opportunities.find((item) => item.id === objectId),
      workspaceId,
      "Custom field opportunity target"
    );
    return {
      companyId: opportunity?.companyId,
      contactId: opportunity?.contactId,
      opportunityId: opportunity?.id
    };
  }

  const company = requireWorkspaceScopedRecord(
    state.companies.find((item) => item.id === objectId),
    workspaceId,
    "Custom field company target"
  );
  return { companyId: company.id, contactId: undefined, opportunityId: undefined };
}

function sdrLeadStatusValue(value: FormDataEntryValue | null): SdrLeadStatus {
  const status = stringValue(value, "Contacted") as SdrLeadStatus;
  return sdrLeadStatuses.includes(status) ? status : "Contacted";
}

function outreachChannelValue(value: FormDataEntryValue | null): OutreachChannel {
  const channel = stringValue(value, "Email") as OutreachChannel;
  return outreachChannels.includes(channel) ? channel : "Email";
}

function assignmentMethodValue(value: FormDataEntryValue | null) {
  const method = stringValue(value, "Capacity-based") as (typeof assignmentMethods)[number];
  return assignmentMethods.includes(method) ? method : "Capacity-based";
}

function reassignmentTriggerValue(value: FormDataEntryValue | null): ReassignmentTrigger {
  const trigger = stringValue(value, "SLA overdue") as ReassignmentTrigger;
  return reassignmentTriggers.includes(trigger) ? trigger : "SLA overdue";
}

function dateTimeValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const normalized = value.includes("T") ? value : `${value}T09:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function campaignTypeValue(value: FormDataEntryValue | null): CampaignType {
  const type = stringValue(value, "Multichannel") as CampaignType;
  return campaignTypes.includes(type) ? type : "Multichannel";
}

function campaignStatusValue(value: FormDataEntryValue | null): CampaignStatus {
  const status = stringValue(value, "Draft") as CampaignStatus;
  return campaignStatuses.includes(status) ? status : "Draft";
}

function campaignChannelValue(value: FormDataEntryValue | null): OutreachChannel {
  const channel = stringValue(value, "Email") as OutreachChannel;
  return campaignChannels.includes(channel) ? channel : "Email";
}

function emailEventTypeValue(value: FormDataEntryValue | null): EmailEventType {
  const eventType = stringValue(value, "Sent") as EmailEventType;
  return emailEventTypes.includes(eventType) ? eventType : "Sent";
}

function smsEventStatusValue(value: FormDataEntryValue | null): SmsEventStatus {
  const status = stringValue(value, "Sent") as SmsEventStatus;
  return smsEventStatuses.includes(status) ? status : "Sent";
}

function trackedCallStatusValue(value: FormDataEntryValue | null): TrackedCallStatus {
  const status = stringValue(value, "Connected") as TrackedCallStatus;
  return trackedCallStatuses.includes(status) ? status : "Connected";
}

function callDispositionValue(value: FormDataEntryValue | null): CallDisposition {
  const disposition = stringValue(value, "Interested") as CallDisposition;
  return callDispositions.includes(disposition) ? disposition : "Interested";
}

function recordingConsentValue(value: FormDataEntryValue | null): RecordingConsentStatus {
  const status = stringValue(value, "Unknown") as RecordingConsentStatus;
  return recordingConsentStatuses.includes(status) ? status : "Unknown";
}

function outreachProviderStatusValue(value: FormDataEntryValue | null) {
  const status = stringValue(value, "Connected") as (typeof outreachProviderStatuses)[number];
  return outreachProviderStatuses.includes(status) ? status : "Connected";
}

function retentionRunModeValue(value: FormDataEntryValue | null): RetentionRunMode {
  const mode = stringValue(value, "Preview") as RetentionRunMode;
  return retentionRunModes.includes(mode) ? mode : "Preview";
}

function retentionActionValue(value: FormDataEntryValue | null): RetentionAction {
  const action = stringValue(value, "Review") as RetentionAction;
  return retentionActions.includes(action) ? action : "Review";
}

function complianceStatusValue(value: FormDataEntryValue | null): ComplianceChecklistStatus {
  const status = stringValue(value, "Warning") as ComplianceChecklistStatus;
  return complianceChecklistStatuses.includes(status) ? status : "Warning";
}

function dataSubjectRequestTypeValue(value: FormDataEntryValue | null): DataSubjectRequestType {
  const requestType = stringValue(value, "Access") as DataSubjectRequestType;
  return dataSubjectRequestTypes.includes(requestType) ? requestType : "Access";
}

function lawfulBasisValue(value: FormDataEntryValue | null): LawfulBasis {
  const basis = stringValue(value, "Legitimate interest") as LawfulBasis;
  return lawfulBases.includes(basis) ? basis : "Legitimate interest";
}

function consentStatusValue(value: FormDataEntryValue | null): ConsentStatus {
  const status = stringValue(value, "Unknown") as ConsentStatus;
  return consentStatuses.includes(status) ? status : "Unknown";
}

function applySuppressionToContacts(state: Parameters<typeof runWorkspaceVerification>[0], suppression: SuppressionRecord) {
  let affected = 0;

  for (const contact of state.contacts.filter((item) => item.workspaceId === suppression.workspaceId)) {
    const company = state.companies.find((item) => item.id === contact.companyId);
    const matches =
      (suppression.email && contact.email.toLowerCase() === suppression.email.toLowerCase()) ||
      (suppression.phone && contact.phone === suppression.phone) ||
      (suppression.domain && company?.domain.toLowerCase() === suppression.domain.toLowerCase());

    if (matches) {
      affected += 1;
      suppressContact(contact, suppression.reason);
    }
  }

  return affected;
}

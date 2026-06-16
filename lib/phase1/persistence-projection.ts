import { createHash } from "node:crypto";
import { ownerUserIdForName } from "@/lib/phase1/crm";
import type {
  Activity,
  AppState,
  JobStatus,
  Opportunity,
  ProcessingStatus,
  SuppressionRecord,
  WorkspaceRole
} from "@/lib/phase1/types";

export type ProjectionTableName =
  | "workspaces"
  | "users"
  | "workspaceMembers"
  | "providerConnections"
  | "providerCredentialAudits"
  | "providerEncryptedSecrets"
  | "providerJobs"
  | "providerJobRuns"
  | "providerUsageLedger"
  | "searchProfiles"
  | "leadJobs"
  | "rawLeads"
  | "normalizedRecords"
  | "companies"
  | "contacts"
  | "verificationResults"
  | "enrichmentResults"
  | "segments"
  | "recordSegments"
  | "leadScores"
  | "accounts"
  | "crmContacts"
  | "opportunities"
  | "activities"
  | "tasks"
  | "notes"
  | "callLogs"
  | "customFields"
  | "customFieldValues"
  | "sdrTeams"
  | "sdrAssignments"
  | "followUpReminders"
  | "reassignmentRules"
  | "suppressionRecords"
  | "exports"
  | "outreachProviders"
  | "outreachCampaigns"
  | "campaignSequences"
  | "sequenceSteps"
  | "emailEvents"
  | "smsEvents"
  | "trackedCalls"
  | "reportSnapshots"
  | "retentionPolicies"
  | "retentionRuns"
  | "complianceChecklistItems"
  | "dataSubjectRequests"
  | "deliverabilityAlerts"
  | "aiPersonalizations"
  | "aiReplyClassifications"
  | "aiCallSummaries"
  | "aiLeadScorePredictions"
  | "aiIcpRecommendations"
  | "aiDeliverabilityRecommendations"
  | "aiRevenueInsights"
  | "aiAutomationRuns"
  | "auditLogs";

export type ProjectionRow = {
  id: string;
  workspaceId?: string;
  [key: string]: unknown;
};

export type NormalizedPersistenceProjection = Record<ProjectionTableName, ProjectionRow[]>;
export type SyncNormalizedProjectionOptions = {
  tables?: ProjectionTableName[];
};

const projectionTables: ProjectionTableName[] = [
  "workspaces",
  "users",
  "workspaceMembers",
  "providerConnections",
  "providerCredentialAudits",
  "providerEncryptedSecrets",
  "providerJobs",
  "providerJobRuns",
  "providerUsageLedger",
  "searchProfiles",
  "leadJobs",
  "rawLeads",
  "normalizedRecords",
  "companies",
  "contacts",
  "verificationResults",
  "enrichmentResults",
  "segments",
  "recordSegments",
  "leadScores",
  "accounts",
  "crmContacts",
  "opportunities",
  "activities",
  "tasks",
  "notes",
  "callLogs",
  "customFields",
  "customFieldValues",
  "sdrTeams",
  "sdrAssignments",
  "followUpReminders",
  "reassignmentRules",
  "suppressionRecords",
  "exports",
  "outreachProviders",
  "outreachCampaigns",
  "campaignSequences",
  "sequenceSteps",
  "emailEvents",
  "smsEvents",
  "trackedCalls",
  "reportSnapshots",
  "retentionPolicies",
  "retentionRuns",
  "complianceChecklistItems",
  "dataSubjectRequests",
  "deliverabilityAlerts",
  "aiPersonalizations",
  "aiReplyClassifications",
  "aiCallSummaries",
  "aiLeadScorePredictions",
  "aiIcpRecommendations",
  "aiDeliverabilityRecommendations",
  "aiRevenueInsights",
  "aiAutomationRuns",
  "auditLogs"
];

const upsertOrder: Array<{ table: ProjectionTableName; delegate: string; workspaceScoped: boolean }> = [
  { table: "workspaces", delegate: "workspace", workspaceScoped: false },
  { table: "users", delegate: "user", workspaceScoped: false },
  { table: "workspaceMembers", delegate: "workspaceMember", workspaceScoped: true },
  { table: "providerConnections", delegate: "providerConnection", workspaceScoped: true },
  { table: "providerCredentialAudits", delegate: "providerCredentialAudit", workspaceScoped: true },
  { table: "providerEncryptedSecrets", delegate: "providerEncryptedSecret", workspaceScoped: true },
  { table: "providerJobs", delegate: "providerJob", workspaceScoped: true },
  { table: "providerJobRuns", delegate: "providerJobRun", workspaceScoped: true },
  { table: "providerUsageLedger", delegate: "providerUsageLedger", workspaceScoped: true },
  { table: "searchProfiles", delegate: "searchProfile", workspaceScoped: true },
  { table: "leadJobs", delegate: "leadJob", workspaceScoped: true },
  { table: "rawLeads", delegate: "rawLead", workspaceScoped: true },
  { table: "normalizedRecords", delegate: "normalizedRecord", workspaceScoped: true },
  { table: "companies", delegate: "company", workspaceScoped: true },
  { table: "contacts", delegate: "contact", workspaceScoped: true },
  { table: "verificationResults", delegate: "verificationResult", workspaceScoped: true },
  { table: "enrichmentResults", delegate: "enrichmentResult", workspaceScoped: true },
  { table: "segments", delegate: "segment", workspaceScoped: true },
  { table: "recordSegments", delegate: "recordSegment", workspaceScoped: true },
  { table: "leadScores", delegate: "leadScore", workspaceScoped: true },
  { table: "accounts", delegate: "account", workspaceScoped: true },
  { table: "crmContacts", delegate: "crmContact", workspaceScoped: true },
  { table: "opportunities", delegate: "opportunity", workspaceScoped: true },
  { table: "activities", delegate: "activity", workspaceScoped: true },
  { table: "tasks", delegate: "task", workspaceScoped: true },
  { table: "notes", delegate: "note", workspaceScoped: true },
  { table: "callLogs", delegate: "callLog", workspaceScoped: true },
  { table: "customFields", delegate: "customField", workspaceScoped: true },
  { table: "customFieldValues", delegate: "customFieldValue", workspaceScoped: true },
  { table: "sdrTeams", delegate: "sdrTeam", workspaceScoped: true },
  { table: "sdrAssignments", delegate: "sdrAssignment", workspaceScoped: true },
  { table: "followUpReminders", delegate: "followUpReminder", workspaceScoped: true },
  { table: "reassignmentRules", delegate: "reassignmentRule", workspaceScoped: true },
  { table: "suppressionRecords", delegate: "suppressionRecord", workspaceScoped: true },
  { table: "exports", delegate: "export", workspaceScoped: true },
  { table: "outreachProviders", delegate: "outreachProvider", workspaceScoped: true },
  { table: "outreachCampaigns", delegate: "outreachCampaign", workspaceScoped: true },
  { table: "campaignSequences", delegate: "campaignSequence", workspaceScoped: true },
  { table: "sequenceSteps", delegate: "sequenceStep", workspaceScoped: true },
  { table: "emailEvents", delegate: "emailEvent", workspaceScoped: true },
  { table: "smsEvents", delegate: "smsEvent", workspaceScoped: true },
  { table: "trackedCalls", delegate: "trackedCall", workspaceScoped: true },
  { table: "reportSnapshots", delegate: "reportSnapshot", workspaceScoped: true },
  { table: "retentionPolicies", delegate: "retentionPolicy", workspaceScoped: true },
  { table: "retentionRuns", delegate: "retentionRun", workspaceScoped: true },
  { table: "complianceChecklistItems", delegate: "complianceChecklistItem", workspaceScoped: true },
  { table: "dataSubjectRequests", delegate: "dataSubjectRequest", workspaceScoped: true },
  { table: "deliverabilityAlerts", delegate: "deliverabilityAlert", workspaceScoped: true },
  { table: "aiPersonalizations", delegate: "aiPersonalization", workspaceScoped: true },
  { table: "aiReplyClassifications", delegate: "aiReplyClassification", workspaceScoped: true },
  { table: "aiCallSummaries", delegate: "aiCallSummary", workspaceScoped: true },
  { table: "aiLeadScorePredictions", delegate: "aiLeadScorePrediction", workspaceScoped: true },
  { table: "aiIcpRecommendations", delegate: "aiIcpRecommendation", workspaceScoped: true },
  { table: "aiDeliverabilityRecommendations", delegate: "aiDeliverabilityRecommendation", workspaceScoped: true },
  { table: "aiRevenueInsights", delegate: "aiRevenueInsight", workspaceScoped: true },
  { table: "aiAutomationRuns", delegate: "aiAutomationRun", workspaceScoped: true },
  { table: "auditLogs", delegate: "auditLog", workspaceScoped: true }
];

type PrismaMirrorClient = Record<string, {
  deleteMany?: (args: unknown) => Promise<unknown>;
  upsert?: (args: unknown) => Promise<unknown>;
} | undefined>;

export function createNormalizedPersistenceProjection(state: AppState): NormalizedPersistenceProjection {
  return {
    workspaces: sortRows(state.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      market: workspace.market,
      seats: workspace.seats,
      health: workspace.health,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    }))),
    users: sortRows(state.users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.createdAt
    }))),
    workspaceMembers: sortRows(state.workspaceMembers.map((member) => ({
      id: member.id,
      workspaceId: member.workspaceId,
      userId: member.userId,
      role: workspaceRoleValue(member.role),
      createdAt: state.workspaces.find((workspace) => workspace.id === member.workspaceId)?.createdAt ?? new Date(0).toISOString()
    }))),
    providerConnections: sortRows(state.providerConnections.map((connection) => ({
      id: connection.id,
      workspaceId: connection.workspaceId,
      providerId: connection.providerId,
      displayName: connection.displayName,
      status: connection.status,
      enabled: connection.enabled,
      executionMode: connection.executionMode,
      categories: connection.categories,
      capabilities: connection.capabilities,
      scopes: connection.scopes,
      allowedOperations: connection.allowedOperations,
      credentialLabel: connection.credentialLabel,
      secretRef: connection.secretRef,
      secretStorage: connection.secretStorage,
      secretVersion: connection.secretVersion,
      maskedSecretSuffix: connection.maskedSecretSuffix,
      rateLimitPerMinute: connection.rateLimitPerMinute,
      dailyBudgetCents: connection.dailyBudgetCents,
      waterfallOrder: connection.waterfallOrder,
      lastTestStatus: connection.lastTestStatus,
      lastTestedAt: connection.lastTestedAt,
      lastTestedById: connection.lastTestedById,
      lastTestError: connection.lastTestError,
      createdById: connection.createdById,
      updatedById: connection.updatedById,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt
    }))),
    providerCredentialAudits: sortRows(state.providerCredentialAudits.map((audit) => ({
      id: audit.id,
      workspaceId: audit.workspaceId,
      providerConnectionId: audit.providerConnectionId,
      providerId: audit.providerId,
      actorUserId: audit.actorUserId,
      action: audit.action,
      secretVersion: audit.secretVersion,
      redactedMetadata: audit.redactedMetadata,
      createdAt: audit.createdAt
    }))),
    providerEncryptedSecrets: sortRows(state.providerEncryptedSecrets.map((secret) => ({
      id: secret.id,
      workspaceId: secret.workspaceId,
      providerConnectionId: secret.providerConnectionId,
      providerId: secret.providerId,
      secretRef: secret.secretRef,
      secretVersion: secret.secretVersion,
      storage: secret.storage,
      algorithm: secret.algorithm,
      keyId: secret.keyId,
      ciphertext: secret.ciphertext,
      iv: secret.iv,
      authTag: secret.authTag,
      checksum: secret.checksum,
      rotatedFromSecretRef: secret.rotatedFromSecretRef,
      createdById: secret.createdById,
      createdAt: secret.createdAt
    }))),
    providerJobs: sortRows(state.providerJobs.map((job) => ({
      id: job.id,
      workspaceId: job.workspaceId,
      providerConnectionId: job.providerConnectionId,
      providerId: job.providerId,
      operation: job.operation,
      status: job.status,
      priority: job.priority,
      idempotencyKey: job.idempotencyKey,
      requestHash: job.requestHash,
      sourceObjectType: job.sourceObjectType,
      sourceObjectId: job.sourceObjectId,
      inputSummary: job.inputSummary,
      resultSummary: job.resultSummary,
      recordsRead: job.recordsRead,
      recordsWritten: job.recordsWritten,
      costCents: job.costCents,
      errorMessage: job.errorMessage,
      maxAttempts: job.maxAttempts,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      nextRetryAt: job.nextRetryAt,
      createdById: job.createdById,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    }))),
    providerJobRuns: sortRows(state.providerJobRuns.map((run) => ({
      id: run.id,
      workspaceId: run.workspaceId,
      providerJobId: run.providerJobId,
      providerConnectionId: run.providerConnectionId,
      providerId: run.providerId,
      operation: run.operation,
      status: run.status,
      attempt: run.attempt,
      maxAttempts: run.maxAttempts,
      idempotencyKey: run.idempotencyKey,
      providerRequestId: run.providerRequestId,
      providerRunId: run.providerRunId,
      checkpoint: run.checkpoint,
      requestSummary: run.requestSummary,
      responseSummary: run.responseSummary,
      rawResponseRef: run.rawResponseRef,
      recordsRead: run.recordsRead,
      recordsWritten: run.recordsWritten,
      costCents: run.costCents,
      durationMs: run.durationMs,
      errorMessage: run.errorMessage,
      lockedBy: run.lockedBy,
      lockedAt: run.lockedAt,
      lockExpiresAt: run.lockExpiresAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      nextRetryAt: run.nextRetryAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    }))),
    providerUsageLedger: sortRows(state.providerUsageLedger.map((entry) => ({
      id: entry.id,
      workspaceId: entry.workspaceId,
      provider: entry.provider,
      operation: entry.operation,
      jobId: entry.jobId,
      providerJobId: entry.providerJobId,
      providerJobRunId: entry.providerJobRunId,
      unitsUsed: entry.unitsUsed,
      unitCostCents: entry.unitCostCents,
      totalCostCents: entry.totalCostCents,
      currency: entry.currency,
      amountKind: entry.amountKind,
      rawProviderMetadata: entry.rawProviderMetadata,
      createdAt: entry.createdAt
    }))),
    searchProfiles: sortRows(state.searchProfiles.map((profile) => ({
      id: profile.id,
      workspaceId: profile.workspaceId,
      profileName: profile.name,
      targetMarket: profile.targetMarket,
      targetIndustries: profile.industries,
      targetGeographies: profile.geographies,
      targetTitles: profile.titles,
      requiredFields: profile.requiredFields,
      excludedKeywords: [],
      excludedDomains: [],
      sourcePreferences: { sources: profile.sources },
      scoringProfile: profile.scoringProfile,
      segmentRules: profile.segmentRules,
      defaultRouting: { route: profile.defaultRouting },
      complianceNotes: profile.complianceNote,
      createdById: profile.createdById,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    }))),
    leadJobs: sortRows(state.leadJobs.map((job) => ({
      id: job.id,
      workspaceId: job.workspaceId,
      searchProfileId: job.searchProfileId,
      jobName: job.name,
      selectedSources: job.sources,
      sourceConfigs: {
        sources: job.sources,
        preflightSourceEstimates: job.preflightSourceEstimates ?? [],
        highValueOnlyEnrichment: job.highValueOnlyEnrichment ?? false,
        enrichmentBudgetCents: job.enrichmentBudgetCents
      },
      status: jobStatusValue(job.status),
      estimatedRecords: job.estimatedRecords ?? job.raw,
      rawRecordsCount: job.raw,
      normalizedRecordsCount: job.normalized,
      duplicateRecordsCount: job.duplicates,
      suppressedRecordsCount: job.suppressed,
      verifiedEmailCount: job.verified,
      verifiedPhoneCount: verifiedPhoneCountForJob(state, job.id),
      enrichedRecordsCount: job.enriched,
      exportedRecordsCount: job.exported,
      pushedToCrmCount: job.pushedToCrm,
      estimatedCostCents: job.estimatedCostCents ?? Math.round(job.actualCost * 100),
      actualCostCents: Math.round(job.actualCost * 100),
      complianceNotes: job.budgetStatus
        ? `Budget ${job.budgetStatus}; cap ${job.budgetCapCents ?? 0} cents`
        : undefined,
      errorSummary: job.errorSummary,
      createdById: job.createdById,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    }))),
    rawLeads: sortRows(state.rawLeads.map((lead) => ({
      id: lead.id,
      workspaceId: lead.workspaceId,
      leadJobId: lead.leadJobId,
      source: lead.source,
      sourceRecordId: lead.sourceRecordId,
      sourcePayload: lead.sourcePayload,
      sourceUrl: lead.sourceUrl,
      sourceConfidence: lead.sourceConfidence,
      extractedAt: lead.extractedAt,
      processingStatus: processingStatusValue(lead.processingStatus),
      processingError: lead.processingError
    }))),
    normalizedRecords: sortRows(state.normalizedRecords.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      rawLeadId: record.rawLeadId,
      leadJobId: record.leadJobId,
      companyName: record.companyName,
      normalizedName: record.normalizedCompanyName,
      domain: record.domain,
      website: record.website,
      contactName: record.contactName,
      title: record.title,
      email: record.email,
      phone: record.phone,
      city: record.city,
      state: record.state,
      country: record.country,
      industry: record.industry,
      technology: [],
      grade: record.grade,
      score: record.score,
      priority: record.priority,
      status: record.status,
      segment: record.segment,
      owner: record.owner,
      verification: record.verification,
      suppressionReason: record.suppressionReason,
      normalizedAt: record.normalizedAt
    }))),
    companies: sortRows(state.companies.map((company) => ({
      id: company.id,
      workspaceId: company.workspaceId,
      name: company.name,
      normalizedName: company.normalizedName,
      rootDomain: company.domain,
      website: company.website,
      phone: company.phone,
      industry: company.industry,
      employeeBand: company.employeeBand,
      revenueBand: company.revenueBand,
      city: company.city,
      state: company.state,
      country: company.country,
      sourceLineage: company.sourceLineage,
      confidence: company.enrichmentCoverage ?? company.score,
      score: company.score,
      priority: company.priority,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt
    }))),
    contacts: sortRows(state.contacts.map((contact) => ({
      id: contact.id,
      workspaceId: contact.workspaceId,
      companyId: state.companies.some((company) => company.id === contact.companyId) ? contact.companyId : undefined,
      fullName: contact.name,
      title: contact.title,
      seniority: contact.seniority,
      department: contact.department,
      email: contact.email,
      phone: contact.phone,
      sourceLineage: contact.sourceLineage,
      confidence: contact.enrichmentCoverage ?? contact.score,
      grade: contact.grade,
      score: contact.score,
      priority: contact.priority,
      status: contact.status,
      segment: contact.segment,
      owner: contact.owner,
      verification: contact.verification,
      enrichmentCoverage: contact.enrichmentCoverage,
      fitReason: contact.fitReason,
      enrichedAt: contact.enrichedAt,
      lawfulBasis: contact.lawfulBasis,
      consentStatus: contact.consentStatus,
      consentSource: contact.consentSource,
      consentCapturedAt: contact.consentCapturedAt,
      doNotContact: contact.doNotContact,
      isSuppressed: contact.isSuppressed,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt
    }))),
    verificationResults: sortRows(state.verificationResults
      .filter((result) => state.contacts.some((contact) => contact.id === result.contactId))
      .map((result) => ({
        id: result.id,
        workspaceId: result.workspaceId,
        contactId: result.contactId,
        provider: result.provider,
        email: result.email,
        phone: result.phone,
        grade: result.grade,
        status: result.emailStatus,
        checks: {
          checks: result.checks,
          emailStatus: result.emailStatus,
          domainStatus: result.domainStatus,
          phoneStatus: result.phoneStatus,
          roleEmail: result.roleEmail,
          disposable: result.disposable,
          catchAll: result.catchAll,
          suppressionReason: result.suppressionReason
        },
        rawResponse: result.rawResponse,
        verifiedAt: result.verifiedAt,
        expiresAt: result.expiresAt
      }))),
    enrichmentResults: sortRows(state.enrichmentResults.map((result) => ({
      id: result.id,
      workspaceId: result.workspaceId,
      contactId: result.targetType === "contact" && state.contacts.some((contact) => contact.id === result.targetId)
        ? result.targetId
        : undefined,
      companyId: result.targetType === "company" && hasCompany(state, result.targetId)
        ? result.targetId
        : undefined,
      provider: result.provider,
      confidence: result.confidence,
      fields: result.fields,
      rawResponse: {
        ...result.rawResponse,
        cacheKey: result.cacheKey,
        targetType: result.targetType,
        targetId: result.targetId
      },
      enrichedAt: result.enrichedAt,
      expiresAt: result.expiresAt
    }))),
    segments: sortRows(state.segmentRules.map((rule) => ({
      id: rule.id,
      workspaceId: rule.workspaceId,
      name: rule.outputSegment,
      rules: {
        name: rule.name,
        description: rule.description,
        scoreBoost: rule.scoreBoost,
        priorityOverride: rule.priorityOverride,
        conditions: rule.conditions,
        active: rule.active
      },
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    }))),
    recordSegments: sortRows(state.recordSegments
      .filter((segment) => state.segmentRules.some((rule) => rule.id === segment.segmentRuleId))
      .map((segment) => ({
        id: segment.id,
        workspaceId: segment.workspaceId,
        segmentId: segment.segmentRuleId,
        contactId: state.contacts.some((contact) => contact.id === segment.contactId) ? segment.contactId : undefined,
        companyId: hasCompany(state, segment.companyId) ? segment.companyId : undefined,
        assignedAt: segment.assignedAt
      }))),
    leadScores: sortRows(state.leadScores
      .filter((score) => state.contacts.some((contact) => contact.id === score.contactId))
      .map((score) => ({
        id: score.id,
        workspaceId: score.workspaceId,
        contactId: score.contactId,
        companyId: hasCompany(state, score.companyId) ? score.companyId : undefined,
        score: score.score,
        priority: score.priority,
        breakdown: {
          ...score.breakdown,
          reasons: score.reasons
        },
        calculatedAt: score.calculatedAt
      }))),
    accounts: sortRows(state.companies.map((company) => {
      const primaryContact = state.contacts.find((contact) => contact.companyId === company.id);

      return {
        id: company.id,
        workspaceId: company.workspaceId,
        companyId: company.id,
        name: company.name,
        domain: company.domain,
        industry: company.industry,
        location: [company.city, company.state, company.country].filter(Boolean).join(", ") || undefined,
        ownerUserId: ownerUserIdForName(state, primaryContact?.owner),
        source: company.sourceLineage[0],
        score: company.score,
        priority: company.priority,
        complianceNote: primaryContact?.isSuppressed ? "Suppression present" : "Source label and export gate clear",
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      };
    })),
    crmContacts: sortRows(state.contacts
      .filter((contact) => hasCompany(state, contact.companyId))
      .map((contact) => ({
        id: contact.id,
        workspaceId: contact.workspaceId,
        accountId: contact.companyId,
        contactId: contact.id,
        fullName: contact.name,
        title: contact.title,
        email: contact.email,
        phone: contact.phone,
        status: contact.status,
        ownerUserId: ownerUserIdForName(state, contact.owner),
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt
      }))),
    opportunities: sortRows(state.opportunities
      .filter((opportunity) => hasCompany(state, opportunity.companyId))
      .map((opportunity) => ({
        id: opportunity.id,
        workspaceId: opportunity.workspaceId,
        accountId: opportunity.companyId,
        contactId: opportunity.contactId && hasCrmContact(state, opportunity.contactId)
          ? opportunity.contactId
          : undefined,
        name: opportunity.name,
        stage: opportunityStageValue(opportunity.stage),
        amountCents: Math.round(opportunity.amount * 100),
        probability: opportunity.probability,
        expectedCloseDate: opportunity.expectedCloseDate,
        ownerUserId: state.users.some((user) => user.id === opportunity.ownerUserId) ? opportunity.ownerUserId : undefined,
        source: opportunity.source,
        createdAt: opportunity.createdAt,
        updatedAt: opportunity.updatedAt
      }))),
    activities: sortRows(state.activities.map((activity) => ({
      id: activity.id,
      workspaceId: activity.workspaceId,
      accountId: activity.companyId && hasCompany(state, activity.companyId)
        ? activity.companyId
        : undefined,
      contactId: activity.contactId && hasCrmContact(state, activity.contactId)
        ? activity.contactId
        : undefined,
      opportunityId: activity.opportunityId && hasProjectedOpportunity(state, activity.opportunityId)
        ? activity.opportunityId
        : undefined,
      actorUserId: state.users.some((user) => user.id === activity.actorUserId) ? activity.actorUserId : undefined,
      type: activityTypeValue(activity.type),
      title: activity.title,
      body: activity.body,
      metadata: activity.metadata,
      occurredAt: activity.createdAt
    }))),
    tasks: sortRows(state.tasks.map((task) => ({
      id: task.id,
      workspaceId: task.workspaceId,
      accountId: task.companyId && hasCompany(state, task.companyId)
        ? task.companyId
        : undefined,
      contactId: task.contactId && hasCrmContact(state, task.contactId)
        ? task.contactId
        : undefined,
      title: task.title,
      status: task.status,
      priority: task.priority.toLowerCase(),
      dueAt: task.dueAt,
      ownerUserId: state.users.some((user) => user.id === task.ownerUserId) ? task.ownerUserId : undefined,
      createdById: state.users.some((user) => user.id === task.createdById) ? task.createdById : undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt
    }))),
    notes: sortRows(state.notes.map((note) => ({
      id: note.id,
      workspaceId: note.workspaceId,
      accountId: note.companyId && hasCompany(state, note.companyId)
        ? note.companyId
        : undefined,
      contactId: note.contactId && hasCrmContact(state, note.contactId)
        ? note.contactId
        : undefined,
      body: note.body,
      createdById: state.users.some((user) => user.id === note.createdById) ? note.createdById : undefined,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }))),
    callLogs: sortRows(state.callLogs.map((call) => ({
      id: call.id,
      workspaceId: call.workspaceId,
      accountId: call.companyId && hasCompany(state, call.companyId)
        ? call.companyId
        : undefined,
      contactId: call.contactId && hasCrmContact(state, call.contactId)
        ? call.contactId
        : undefined,
      phone: call.phone,
      outcome: call.outcome,
      durationSeconds: call.durationSeconds,
      notes: call.notes,
      createdById: state.users.some((user) => user.id === call.createdById) ? call.createdById : undefined,
      createdAt: call.createdAt
    }))),
    customFields: sortRows(state.customFields.map((field) => ({
      id: field.id,
      workspaceId: field.workspaceId,
      objectType: field.objectType,
      name: field.name,
      fieldType: field.fieldType,
      options: field.options ?? [],
      createdAt: field.createdAt
    }))),
    customFieldValues: sortRows(state.customFieldValues
      .filter((value) => state.customFields.some((field) => field.id === value.customFieldId))
      .map((value) => ({
        id: value.id,
        workspaceId: value.workspaceId,
        customFieldId: value.customFieldId,
        objectId: value.objectId,
        value: value.value,
        updatedAt: value.updatedAt
      }))),
    sdrTeams: sortRows(state.sdrTeams.map((team) => ({
      id: team.id,
      workspaceId: team.workspaceId,
      name: team.name,
      managerUserId: state.users.some((user) => user.id === team.managerUserId) ? team.managerUserId : undefined,
      memberUserIds: team.memberUserIds,
      territories: team.territories,
      industries: team.industries,
      capacityWeight: team.capacityWeight,
      active: team.active,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt
    }))),
    sdrAssignments: sortRows(state.sdrAssignments
      .filter((assignment) => hasCompany(state, assignment.companyId) && hasCrmContact(state, assignment.contactId))
      .map((assignment) => ({
        id: assignment.id,
        workspaceId: assignment.workspaceId,
        accountId: assignment.companyId,
        contactId: assignment.contactId,
        assignedSdrId: state.users.some((user) => user.id === assignment.assignedSdrId) ? assignment.assignedSdrId : undefined,
        assignedTeamId: assignment.assignedTeamId && state.sdrTeams.some((team) => team.id === assignment.assignedTeamId)
          ? assignment.assignedTeamId
          : undefined,
        assignedById: state.users.some((user) => user.id === assignment.assignedById) ? assignment.assignedById : undefined,
        assignmentMethod: assignment.assignmentMethod,
        assignmentReason: assignment.assignmentReason,
        assignedAt: assignment.assignedAt,
        firstTouchDueAt: assignment.firstTouchDueAt,
        followUpDueAt: assignment.followUpDueAt,
        status: assignment.status,
        reassignmentReason: assignment.reassignmentReason,
        previousOwnerId: assignment.previousOwnerId,
        slaStatus: assignment.slaStatus,
        firstTouchedAt: assignment.firstTouchedAt,
        lastTouchAt: assignment.lastTouchAt,
        touchCount: assignment.touchCount,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt
      }))),
    followUpReminders: sortRows(state.followUpReminders
      .filter((reminder) => state.sdrAssignments.some((assignment) => assignment.id === reminder.assignmentId))
      .map((reminder) => ({
        id: reminder.id,
        workspaceId: reminder.workspaceId,
        assignmentId: reminder.assignmentId,
        accountId: hasCompany(state, reminder.companyId) ? reminder.companyId : undefined,
        contactId: hasCrmContact(state, reminder.contactId) ? reminder.contactId : undefined,
        ownerUserId: state.users.some((user) => user.id === reminder.ownerUserId) ? reminder.ownerUserId : undefined,
        title: reminder.title,
        channel: reminder.channel,
        dueAt: reminder.dueAt,
        status: reminder.status,
        createdAt: reminder.createdAt,
        completedAt: reminder.completedAt,
        snoozedUntil: reminder.snoozedUntil
      }))),
    reassignmentRules: sortRows(state.reassignmentRules.map((rule) => ({
      id: rule.id,
      workspaceId: rule.workspaceId,
      name: rule.name,
      trigger: rule.trigger,
      assignmentMethod: rule.assignmentMethod,
      thresholdHours: rule.thresholdHours,
      targetTeamId: rule.targetTeamId && state.sdrTeams.some((team) => team.id === rule.targetTeamId)
        ? rule.targetTeamId
        : undefined,
      active: rule.active,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    }))),
    suppressionRecords: sortRows(state.suppressionRecords.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      type: suppressionTypeValue(record.type),
      email: record.email,
      phone: record.phone,
      domain: record.domain,
      reason: record.reason,
      source: record.source,
      createdAt: record.createdAt
    }))),
    exports: sortRows(state.exports.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      leadJobId: record.leadJobId,
      name: record.name,
      exportType: record.type,
      filterSnapshot: {
        exportRuleId: record.exportRuleId,
        recordIds: record.recordIds,
        blockedCount: record.blockedCount,
        status: record.status
      },
      columns: record.columns,
      recordCount: record.recordCount,
      createdById: record.createdById,
      createdAt: record.createdAt
    }))),
    outreachProviders: sortRows(state.outreachProviders.map((provider) => ({
      id: provider.id,
      workspaceId: provider.workspaceId,
      kind: provider.kind,
      provider: provider.provider,
      status: provider.status,
      sendingDomain: provider.sendingDomain,
      mailboxGroup: provider.mailboxGroup,
      senderEmail: provider.senderEmail,
      fromNumber: provider.fromNumber,
      dailyLimit: provider.dailyLimit,
      sentToday: provider.sentToday,
      bounceRate: provider.bounceRate,
      complaintRate: provider.complaintRate,
      unsubscribeRate: provider.unsubscribeRate,
      warmupStage: provider.warmupStage,
      spf: provider.spf,
      dkim: provider.dkim,
      dmarc: provider.dmarc,
      tls: provider.tls,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    }))),
    outreachCampaigns: sortRows(state.outreachCampaigns.map((campaign) => ({
      id: campaign.id,
      workspaceId: campaign.workspaceId,
      name: campaign.name,
      campaignType: campaign.campaignType,
      targetSegment: campaign.targetSegment,
      sourceJobIds: campaign.sourceJobIds,
      ownerUserId: campaign.ownerUserId,
      sendingDomain: campaign.sendingDomain,
      mailboxGroup: campaign.mailboxGroup,
      status: campaign.status,
      startDate: campaign.startDate ? asDateTime(campaign.startDate) : undefined,
      endDate: campaign.endDate ? asDateTime(campaign.endDate) : undefined,
      totalLeads: campaign.totalLeads,
      sentCount: campaign.sentCount,
      openCount: campaign.openCount,
      clickCount: campaign.clickCount,
      replyCount: campaign.replyCount,
      bounceCount: campaign.bounceCount,
      unsubscribeCount: campaign.unsubscribeCount,
      meetingsBooked: campaign.meetingsBooked,
      opportunitiesCreated: campaign.opportunitiesCreated,
      revenueWonCents: Math.round(campaign.revenueWon * 100),
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt
    }))),
    campaignSequences: sortRows(state.campaignSequences.map((sequence) => ({
      id: sequence.id,
      workspaceId: sequence.workspaceId,
      campaignId: sequence.campaignId,
      name: sequence.name,
      targetSegment: sequence.targetSegment,
      defaultDelayRules: sequence.defaultDelayRules,
      stopOnReply: sequence.stopOnReply,
      stopOnBounce: sequence.stopOnBounce,
      stopOnUnsubscribe: sequence.stopOnUnsubscribe,
      createdById: sequence.createdById,
      status: sequence.status,
      createdAt: sequence.createdAt,
      updatedAt: sequence.updatedAt
    }))),
    sequenceSteps: sortRows(state.sequenceSteps.map((step) => ({
      id: step.id,
      workspaceId: step.workspaceId,
      sequenceId: step.sequenceId,
      stepNumber: step.stepNumber,
      channel: step.channel,
      delayDays: step.delayDays,
      subject: step.subject,
      bodyTemplate: step.bodyTemplate,
      callScript: step.callScript,
      smsTemplate: step.smsTemplate,
      manualTaskInstruction: step.manualTaskInstruction,
      personalizationVariables: step.personalizationVariables,
      requiredFields: step.requiredFields,
      unsubscribeFooterRequired: step.unsubscribeFooterRequired,
      physicalAddress: step.physicalAddress,
      complianceStatus: step.complianceStatus,
      complianceNotes: step.complianceNotes,
      active: step.active,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt
    }))),
    emailEvents: sortRows(state.emailEvents.map((event) => ({
      id: event.id,
      workspaceId: event.workspaceId,
      contactId: hasCrmContact(state, event.contactId) ? event.contactId : undefined,
      accountId: hasCompany(state, event.companyId) ? event.companyId : undefined,
      campaignId: state.outreachCampaigns.some((campaign) => campaign.id === event.campaignId) ? event.campaignId : undefined,
      sequenceId: state.campaignSequences.some((sequence) => sequence.id === event.sequenceId) ? event.sequenceId : undefined,
      sequenceStepId: state.sequenceSteps.some((step) => step.id === event.sequenceStepId) ? event.sequenceStepId : undefined,
      messageId: event.messageId,
      provider: event.provider,
      senderEmail: event.senderEmail,
      recipientEmail: event.recipientEmail,
      eventType: event.eventType,
      subject: event.subject,
      bodySnapshot: event.bodySnapshot,
      sentAt: event.sentAt,
      deliveredAt: event.deliveredAt,
      openedAt: event.openedAt,
      clickedAt: event.clickedAt,
      repliedAt: event.repliedAt,
      bouncedAt: event.bouncedAt,
      unsubscribeAt: event.unsubscribeAt,
      bounceType: event.bounceType,
      smtpCode: event.smtpCode,
      rawPayload: {
        ...event.rawPayload,
        leadContactId: event.contactId,
        companyId: event.companyId
      }
    }))),
    smsEvents: sortRows(state.smsEvents.map((event) => ({
      id: event.id,
      workspaceId: event.workspaceId,
      contactId: hasCrmContact(state, event.contactId) ? event.contactId : undefined,
      accountId: hasCompany(state, event.companyId) ? event.companyId : undefined,
      campaignId: state.outreachCampaigns.some((campaign) => campaign.id === event.campaignId) ? event.campaignId : undefined,
      sequenceId: state.campaignSequences.some((sequence) => sequence.id === event.sequenceId) ? event.sequenceId : undefined,
      sequenceStepId: state.sequenceSteps.some((step) => step.id === event.sequenceStepId) ? event.sequenceStepId : undefined,
      sdrUserId: state.users.some((user) => user.id === event.sdrUserId) ? event.sdrUserId : undefined,
      provider: event.provider,
      fromNumber: event.fromNumber,
      toNumber: event.toNumber,
      direction: event.direction,
      body: event.body,
      status: event.status,
      deliveredAt: event.deliveredAt,
      repliedAt: event.repliedAt,
      failedAt: event.failedAt,
      optOutFlag: event.optOutFlag,
      rawPayload: {
        ...event.rawPayload,
        leadContactId: event.contactId,
        companyId: event.companyId
      },
      createdAt: event.createdAt
    }))),
    trackedCalls: sortRows(state.trackedCalls.map((call) => ({
      id: call.id,
      workspaceId: call.workspaceId,
      contactId: hasCrmContact(state, call.contactId) ? call.contactId : undefined,
      accountId: hasCompany(state, call.companyId) ? call.companyId : undefined,
      leadContactId: call.contactId,
      companyId: call.companyId,
      sdrUserId: call.sdrUserId,
      phoneNumber: call.phoneNumber,
      direction: call.direction,
      callStatus: call.callStatus,
      disposition: call.disposition,
      durationSeconds: call.durationSeconds,
      recordingConsent: call.recordingConsent,
      recordingConsentSource: call.recordingConsentSource,
      recordingConsentCapturedAt: call.recordingConsentCapturedAt,
      recordingUrl: call.recordingUrl,
      recordingStoragePath: call.recordingStoragePath,
      transcript: call.transcript,
      callSummary: call.callSummary,
      nextStep: call.nextStep,
      createdAt: call.createdAt
    }))),
    reportSnapshots: sortRows(state.reportSnapshots.map((snapshot) => ({
      id: snapshot.id,
      workspaceId: snapshot.workspaceId,
      category: snapshot.category,
      title: snapshot.title,
      metrics: snapshot.metrics,
      generatedById: state.users.some((user) => user.id === snapshot.generatedById) ? snapshot.generatedById : undefined,
      generatedAt: snapshot.generatedAt
    }))),
    retentionPolicies: sortRows(state.retentionPolicies.map((policy) => ({
      id: policy.id,
      workspaceId: policy.workspaceId,
      dataType: policy.dataType,
      retentionDays: policy.retentionDays,
      action: policy.action,
      active: policy.active,
      legalBasis: policy.legalBasis,
      notes: policy.notes,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt
    }))),
    retentionRuns: sortRows(state.retentionRuns
      .filter((run) => state.retentionPolicies.some((policy) => policy.id === run.retentionPolicyId))
      .map((run) => ({
        id: run.id,
        workspaceId: run.workspaceId,
        retentionPolicyId: run.retentionPolicyId,
        runById: state.users.some((user) => user.id === run.runById) ? run.runById : undefined,
        dataType: run.dataType,
        mode: run.mode,
        action: run.action,
        candidateCount: run.candidateCount,
        affectedCount: run.affectedCount,
        status: run.status,
        summary: run.summary,
        runAt: run.runAt
      }))),
    complianceChecklistItems: sortRows(state.complianceChecklistItems.map((item) => ({
      id: item.id,
      workspaceId: item.workspaceId,
      category: item.category,
      requirement: item.requirement,
      control: item.control,
      status: item.status,
      evidence: item.evidence,
      ownerRole: item.ownerRole,
      updatedAt: item.updatedAt
    }))),
    dataSubjectRequests: sortRows(state.dataSubjectRequests.map((request) => ({
      id: request.id,
      workspaceId: request.workspaceId,
      requestType: request.requestType,
      status: request.status,
      email: request.email,
      phone: request.phone,
      contactId: request.contactId,
      requestedAt: request.requestedAt,
      dueAt: request.dueAt,
      verifiedAt: request.verifiedAt,
      completedAt: request.completedAt,
      handledById: request.handledById,
      notes: request.notes,
      evidence: request.evidence
    }))),
    deliverabilityAlerts: sortRows(state.deliverabilityAlerts.map((alert) => ({
      id: alert.id,
      workspaceId: alert.workspaceId,
      providerId: alert.providerId && state.outreachProviders.some((provider) => provider.id === alert.providerId)
        ? alert.providerId
        : undefined,
      trigger: alert.trigger,
      severity: alert.severity,
      status: alert.status,
      currentValue: alert.currentValue,
      threshold: alert.threshold,
      recommendation: alert.recommendation,
      createdAt: alert.createdAt,
      resolvedAt: alert.resolvedAt,
      resolvedById: alert.resolvedById && state.users.some((user) => user.id === alert.resolvedById)
        ? alert.resolvedById
        : undefined
    }))),
    aiPersonalizations: sortRows(state.aiPersonalizations.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      contactId: record.contactId,
      companyId: record.companyId,
      campaignId: record.campaignId,
      provider: record.provider,
      firstLine: record.firstLine,
      painPointAngle: record.painPointAngle,
      recommendedOffer: record.recommendedOffer,
      recommendedChannel: record.recommendedChannel,
      confidence: record.confidence,
      status: record.status,
      generatedById: state.users.some((user) => user.id === record.generatedById) ? record.generatedById : undefined,
      generatedAt: record.generatedAt,
      appliedAt: record.appliedAt
    }))),
    aiReplyClassifications: sortRows(state.aiReplyClassifications.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      contactId: record.contactId,
      companyId: record.companyId,
      campaignId: record.campaignId,
      emailEventId: record.emailEventId,
      smsEventId: record.smsEventId,
      channel: record.channel,
      intent: record.intent,
      sentiment: record.sentiment,
      confidence: record.confidence,
      summary: record.summary,
      recommendedAction: record.recommendedAction,
      status: record.status,
      classifiedAt: record.classifiedAt
    }))),
    aiCallSummaries: sortRows(state.aiCallSummaries.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      trackedCallId: record.trackedCallId,
      contactId: record.contactId,
      companyId: record.companyId,
      provider: record.provider,
      summary: record.summary,
      nextSteps: record.nextSteps,
      sentiment: record.sentiment,
      objections: record.objections,
      topics: record.topics,
      confidence: record.confidence,
      status: record.status,
      generatedAt: record.generatedAt
    }))),
    aiLeadScorePredictions: sortRows(state.aiLeadScorePredictions.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      contactId: record.contactId,
      companyId: record.companyId,
      provider: record.provider,
      modelVersion: record.modelVersion,
      score: record.score,
      conversionProbability: record.conversionProbability,
      priority: record.priority,
      factors: record.factors,
      risks: record.risks,
      recommendedAction: record.recommendedAction,
      status: record.status,
      generatedAt: record.generatedAt,
      appliedAt: record.appliedAt
    }))),
    aiIcpRecommendations: sortRows(state.aiIcpRecommendations.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      name: record.name,
      description: record.description,
      industries: record.industries,
      titles: record.titles,
      geographies: record.geographies,
      technologies: record.technologies,
      segments: record.segments,
      sourceSummary: record.sourceSummary,
      fitSignals: record.fitSignals,
      confidence: record.confidence,
      prompt: record.prompt,
      status: record.status,
      createdById: state.users.some((user) => user.id === record.createdById) ? record.createdById : undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      appliedSearchProfileId: record.appliedSearchProfileId
    }))),
    aiDeliverabilityRecommendations: sortRows(state.aiDeliverabilityRecommendations.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      providerId: record.providerId && state.outreachProviders.some((provider) => provider.id === record.providerId)
        ? record.providerId
        : undefined,
      title: record.title,
      severity: record.severity,
      recommendation: record.recommendation,
      triggerMetric: record.triggerMetric,
      expectedImpact: record.expectedImpact,
      status: record.status,
      createdAt: record.createdAt,
      appliedAt: record.appliedAt
    }))),
    aiRevenueInsights: sortRows(state.aiRevenueInsights.map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      dimension: record.dimension,
      dimensionValue: record.dimensionValue,
      insight: record.insight,
      recommendedAction: record.recommendedAction,
      impactAmountCents: Math.round(record.impactAmount * 100),
      confidence: record.confidence,
      status: record.status,
      createdAt: record.createdAt
    }))),
    aiAutomationRuns: sortRows(state.aiAutomationRuns.map((run) => ({
      id: run.id,
      workspaceId: run.workspaceId,
      automationType: run.automationType,
      status: run.status,
      recordsAnalyzed: run.recordsAnalyzed,
      recordsCreated: run.recordsCreated,
      summary: run.summary,
      runById: state.users.some((user) => user.id === run.runById) ? run.runById : undefined,
      startedAt: run.startedAt,
      completedAt: run.completedAt
    }))),
    auditLogs: sortRows(state.auditLogs.map((log) => ({
      id: log.id,
      workspaceId: log.workspaceId,
      actorUserId: log.actorUserId,
      objectType: log.objectType,
      objectId: log.objectId,
      action: log.action,
      oldValue: log.oldValue,
      newValue: log.newValue,
      reason: log.reason,
      createdAt: log.createdAt
    })))
  };
}

export function normalizedProjectionSummary(projection: NormalizedPersistenceProjection) {
  return {
    tables: Object.fromEntries(projectionTables.map((table) => [table, projection[table].length])) as Record<ProjectionTableName, number>,
    hash: normalizedProjectionHash(projection)
  };
}

export function normalizedProjectionHash(projection: NormalizedPersistenceProjection) {
  return createHash("sha256").update(stableStringify(projection)).digest("hex");
}

export async function syncNormalizedProjectionToPrisma(
  state: AppState,
  client: PrismaMirrorClient,
  options: SyncNormalizedProjectionOptions = {}
) {
  const projection = createNormalizedPersistenceProjection(state);
  const workspaceIds = projection.workspaces.map((workspace) => workspace.id);
  const requestedTables = options.tables?.length ? new Set(options.tables) : undefined;
  const selectedUpsertOrder = upsertOrder.filter((spec) => !requestedTables || requestedTables.has(spec.table));
  const skippedTables: ProjectionTableName[] = [];

  for (const spec of [...selectedUpsertOrder].reverse()) {
    if (!spec.workspaceScoped) continue;
    const delegate = client[spec.delegate];
    if (!delegate?.deleteMany) {
      skippedTables.push(spec.table);
      continue;
    }

    for (const workspaceId of workspaceIds) {
      const ids = projection[spec.table]
        .filter((row) => row.workspaceId === workspaceId)
        .map((row) => row.id);
      await delegate.deleteMany({ where: { workspaceId, id: { notIn: ids } } });
    }
  }

  for (const spec of selectedUpsertOrder) {
    const delegate = client[spec.delegate];
    if (!delegate?.upsert) {
      if (!skippedTables.includes(spec.table)) skippedTables.push(spec.table);
      continue;
    }

    for (const row of projection[spec.table]) {
      const data = stripUndefined(row);
      await delegate.upsert({
        where: { id: row.id },
        update: data,
        create: data
      });
    }
  }

  return {
    ...normalizedProjectionSummary(projection),
    syncedTables: selectedUpsertOrder.map((spec) => spec.table),
    skippedTables: Array.from(new Set(skippedTables))
  };
}

function sortRows<T extends ProjectionRow>(rows: T[]) {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function workspaceRoleValue(role: WorkspaceRole) {
  const map: Record<WorkspaceRole, string> = {
    Admin: "ADMIN",
    Manager: "MANAGER",
    SDR: "SDR",
    "Data Operator": "DATA_OPERATOR",
    Viewer: "VIEWER",
    "Compliance Admin": "COMPLIANCE_ADMIN"
  };
  return map[role];
}

function jobStatusValue(status: JobStatus) {
  const map: Record<JobStatus, string> = {
    Draft: "DRAFT",
    Queued: "QUEUED",
    Running: "RUNNING",
    Paused: "PAUSED",
    Completed: "COMPLETED",
    Failed: "FAILED"
  };
  return map[status];
}

function processingStatusValue(status: ProcessingStatus) {
  const map: Record<ProcessingStatus, string> = {
    Pending: "PENDING",
    Normalized: "NORMALIZED",
    Failed: "FAILED",
    Suppressed: "SUPPRESSED"
  };
  return map[status];
}

function suppressionTypeValue(type: SuppressionRecord["type"]) {
  const map: Record<SuppressionRecord["type"], string> = {
    Unsubscribe: "UNSUBSCRIBE",
    "Hard bounce": "HARD_BOUNCE",
    "Do not call": "DO_NOT_CALL",
    "Existing customer": "EXISTING_CUSTOMER",
    Competitor: "COMPETITOR",
    "Spam complaint": "SPAM_COMPLAINT",
    "SMS opt-out": "SMS_OPT_OUT",
    "Deletion request": "DELETION_REQUEST"
  };
  return map[type];
}

function hasCompany(state: AppState, companyId: string) {
  return state.companies.some((company) => company.id === companyId);
}

function hasCrmContact(state: AppState, contactId: string) {
  const contact = state.contacts.find((item) => item.id === contactId);
  return Boolean(contact && hasCompany(state, contact.companyId));
}

function hasProjectedOpportunity(state: AppState, opportunityId: string) {
  const opportunity = state.opportunities.find((item) => item.id === opportunityId);
  return Boolean(opportunity && hasCompany(state, opportunity.companyId));
}

function verifiedPhoneCountForJob(state: AppState, jobId: string) {
  const contactIds = state.normalizedRecords
    .filter((record) => record.leadJobId === jobId)
    .map((record) =>
      state.contacts.find((contact) => contact.workspaceId === record.workspaceId && contact.email === record.email)
    )
    .filter((contact) => Boolean(contact?.id))
    .map((contact) => contact?.id);

  return contactIds.filter((contactId) => {
    const latestVerification = state.verificationResults
      .filter((result) => result.contactId === contactId)
      .sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt))[0];
    return latestVerification?.phoneStatus === "Valid";
  }).length;
}

function opportunityStageValue(stage: Opportunity["stage"]) {
  const map: Record<Opportunity["stage"], string> = {
    Prospecting: "PROSPECTING",
    Qualified: "QUALIFIED",
    Discovery: "DISCOVERY",
    Proposal: "PROPOSAL",
    "Closed won": "CLOSED_WON",
    "Closed lost": "CLOSED_LOST"
  };
  return map[stage];
}

function activityTypeValue(type: Activity["type"]) {
  const map: Record<Activity["type"], string> = {
    Email: "EMAIL",
    Call: "CALL",
    SMS: "SMS",
    Note: "NOTE",
    Task: "TASK",
    Meeting: "MEETING",
    "Status change": "STATUS_CHANGE",
    Verification: "VERIFICATION",
    Opportunity: "OPPORTUNITY"
  };
  return map[type];
}

function asDateTime(value: string) {
  const normalized = value.includes("T") ? value : `${value}T00:00:00.000Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, stripUndefined(item)])
    ) as T;
  }

  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

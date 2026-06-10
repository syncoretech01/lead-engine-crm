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
  | "searchProfiles"
  | "leadJobs"
  | "rawLeads"
  | "normalizedRecords"
  | "companies"
  | "contacts"
  | "accounts"
  | "crmContacts"
  | "opportunities"
  | "activities"
  | "tasks"
  | "notes"
  | "callLogs"
  | "suppressionRecords"
  | "exports"
  | "outreachCampaigns"
  | "campaignSequences"
  | "sequenceSteps"
  | "emailEvents"
  | "smsEvents"
  | "trackedCalls"
  | "dataSubjectRequests"
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
  "searchProfiles",
  "leadJobs",
  "rawLeads",
  "normalizedRecords",
  "companies",
  "contacts",
  "accounts",
  "crmContacts",
  "opportunities",
  "activities",
  "tasks",
  "notes",
  "callLogs",
  "suppressionRecords",
  "exports",
  "outreachCampaigns",
  "campaignSequences",
  "sequenceSteps",
  "emailEvents",
  "smsEvents",
  "trackedCalls",
  "dataSubjectRequests",
  "auditLogs"
];

const upsertOrder: Array<{ table: ProjectionTableName; delegate: string; workspaceScoped: boolean }> = [
  { table: "workspaces", delegate: "workspace", workspaceScoped: false },
  { table: "users", delegate: "user", workspaceScoped: false },
  { table: "workspaceMembers", delegate: "workspaceMember", workspaceScoped: true },
  { table: "searchProfiles", delegate: "searchProfile", workspaceScoped: true },
  { table: "leadJobs", delegate: "leadJob", workspaceScoped: true },
  { table: "rawLeads", delegate: "rawLead", workspaceScoped: true },
  { table: "normalizedRecords", delegate: "normalizedRecord", workspaceScoped: true },
  { table: "companies", delegate: "company", workspaceScoped: true },
  { table: "contacts", delegate: "contact", workspaceScoped: true },
  { table: "accounts", delegate: "account", workspaceScoped: true },
  { table: "crmContacts", delegate: "crmContact", workspaceScoped: true },
  { table: "opportunities", delegate: "opportunity", workspaceScoped: true },
  { table: "activities", delegate: "activity", workspaceScoped: true },
  { table: "tasks", delegate: "task", workspaceScoped: true },
  { table: "notes", delegate: "note", workspaceScoped: true },
  { table: "callLogs", delegate: "callLog", workspaceScoped: true },
  { table: "suppressionRecords", delegate: "suppressionRecord", workspaceScoped: true },
  { table: "exports", delegate: "export", workspaceScoped: true },
  { table: "outreachCampaigns", delegate: "outreachCampaign", workspaceScoped: true },
  { table: "campaignSequences", delegate: "campaignSequence", workspaceScoped: true },
  { table: "sequenceSteps", delegate: "sequenceStep", workspaceScoped: true },
  { table: "emailEvents", delegate: "emailEvent", workspaceScoped: true },
  { table: "smsEvents", delegate: "smsEvent", workspaceScoped: true },
  { table: "trackedCalls", delegate: "trackedCall", workspaceScoped: true },
  { table: "dataSubjectRequests", delegate: "dataSubjectRequest", workspaceScoped: true },
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
      sourceConfigs: { sources: job.sources },
      status: jobStatusValue(job.status),
      estimatedRecords: job.raw,
      rawRecordsCount: job.raw,
      normalizedRecordsCount: job.normalized,
      duplicateRecordsCount: job.duplicates,
      suppressedRecordsCount: job.suppressed,
      verifiedEmailCount: job.verified,
      verifiedPhoneCount: 0,
      enrichedRecordsCount: job.enriched,
      exportedRecordsCount: job.exported,
      pushedToCrmCount: job.pushedToCrm,
      actualCostCents: Math.round(job.actualCost * 100),
      complianceNotes: undefined,
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

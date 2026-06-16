import { randomUUID } from "node:crypto";
import { resolveSequenceComplianceStatus, suppressContact } from "@/lib/phase1/compliance";
import { isOpenOpportunityStage, userNameForId } from "@/lib/phase1/crm";
import { centsToDollars, workspaceCostMetrics } from "@/lib/phase1/money";
import { campaignViews, refreshCampaignMetrics } from "@/lib/phase1/outreach";
import type {
  AppState,
  ComplianceChecklistItem,
  ComplianceChecklistStatus,
  DeliverabilityAlert,
  ReportCategory,
  ReportMetric,
  ReportSnapshot,
  RetentionAction,
  RetentionPolicy,
  RetentionRun,
  RetentionRunMode
} from "@/lib/phase1/types";

export const reportCategories: ReportCategory[] = [
  "Executive Overview",
  "Lead Source Performance",
  "SDR Performance",
  "Campaign Performance",
  "Deliverability Health",
  "Pipeline Dashboard",
  "Data Quality",
  "Enrichment Performance",
  "Activity Volume",
  "Compliance Dashboard",
  "Revenue Attribution"
];

export const retentionActions: RetentionAction[] = [
  "Purge",
  "Anonymize",
  "Preserve",
  "Expire export",
  "Review"
];

export const retentionRunModes: RetentionRunMode[] = ["Preview", "Apply"];
export const complianceChecklistStatuses: ComplianceChecklistStatus[] = ["Pass", "Warning", "Fail"];

export function ensureReportingDefaults(state: AppState, workspaceId: string) {
  let changed = false;
  const now = new Date().toISOString();

  if (state.retentionPolicies.filter((policy) => policy.workspaceId === workspaceId).length === 0) {
    state.retentionPolicies.push(...defaultRetentionPolicies(workspaceId, now));
    changed = true;
  }

  const defaultChecklist = defaultComplianceChecklist(state, workspaceId, now);
  if (state.complianceChecklistItems.filter((item) => item.workspaceId === workspaceId).length === 0) {
    state.complianceChecklistItems.push(...defaultChecklist);
    changed = true;
  } else {
    for (const item of defaultChecklist) {
      const existing = state.complianceChecklistItems.find(
        (checklistItem) => checklistItem.id === item.id && checklistItem.workspaceId === workspaceId
      );
      if (!existing) {
        state.complianceChecklistItems.push(item);
        changed = true;
      }
    }
  }

  const alertResult = refreshDeliverabilityAlerts(state, workspaceId, now);
  changed = alertResult.changed || changed;

  if (state.reportSnapshots.filter((snapshot) => snapshot.workspaceId === workspaceId).length === 0) {
    generateReportSnapshots(state, workspaceId, state.users[0]?.id ?? "system", now);
    changed = true;
  }

  return { changed };
}

export function reportingDashboardSnapshot(state: AppState, workspaceId: string) {
  refreshCampaignMetrics(state, workspaceId);

  const workspace = state.workspaces.find((item) => item.id === workspaceId) ?? state.workspaces[0];
  const rawLeads = state.rawLeads.filter((lead) => lead.workspaceId === workspaceId);
  const normalizedRecords = state.normalizedRecords.filter((record) => record.workspaceId === workspaceId);
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const companies = state.companies.filter((company) => company.workspaceId === workspaceId);
  const verificationResults = state.verificationResults.filter((result) => result.workspaceId === workspaceId);
  const assignments = state.sdrAssignments.filter((assignment) => assignment.workspaceId === workspaceId);
  const opportunities = state.opportunities.filter((opportunity) => opportunity.workspaceId === workspaceId);
  const emailEvents = state.emailEvents.filter((event) => event.workspaceId === workspaceId);
  const smsEvents = state.smsEvents.filter((event) => event.workspaceId === workspaceId);
  const trackedCalls = state.trackedCalls.filter((call) => call.workspaceId === workspaceId);
  const activities = state.activities.filter((activity) => activity.workspaceId === workspaceId);
  const leadJobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const suppressions = state.suppressionRecords.filter((record) => record.workspaceId === workspaceId);
  const dataSubjectRequests = state.dataSubjectRequests
    .filter((request) => request.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  const reportSnapshots = state.reportSnapshots
    .filter((snapshot) => snapshot.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));

  const verifiedContacts = contacts.filter(
    (contact) => !contact.isSuppressed && (contact.grade === "A" || contact.grade === "B" || contact.grade === "C")
  );
  const enrichedContacts = contacts.filter((contact) => (contact.enrichmentCoverage ?? 0) > 0 || Boolean(contact.enrichedAt));
  const assignedContacts = contacts.filter((contact) => contact.owner && contact.owner !== "Unassigned" && contact.owner !== "Blocked");
  const contactedAssignments = assignments.filter((assignment) =>
    ["Contacted", "Opened", "Replied", "Interested", "Meeting Booked", "Qualified", "Proposal Sent", "Won"].includes(
      assignment.status
    )
  );
  const replyCount = uniqueCount([
    ...emailEvents.filter((event) => event.eventType === "Replied").map((event) => event.contactId),
    ...smsEvents.filter((event) => event.status === "Replied").map((event) => event.contactId),
    ...contacts.filter((contact) => contact.status === "Replied").map((contact) => contact.id)
  ]);
  const meetingCount = assignments.filter((assignment) => assignment.status === "Meeting Booked").length +
    activities.filter((activity) => activity.type === "Meeting").length;
  const openPipeline = opportunities
    .filter((opportunity) => isOpenOpportunityStage(opportunity.stage))
    .reduce((total, opportunity) => total + opportunity.amount, 0);
  const wonRevenue = opportunities
    .filter((opportunity) => opportunity.stage === "Closed won")
    .reduce((total, opportunity) => total + opportunity.amount, 0);
  const costMetrics = workspaceCostMetrics(state, workspaceId);
  const totalLeadCost = centsToDollars(costMetrics.actualCostCents);
  const sentEmails = emailEvents.filter((event) => event.eventType === "Sent").length;
  const bouncedEmails = emailEvents.filter((event) => event.eventType === "Bounced").length;
  const spamComplaints = emailEvents.filter((event) => event.eventType === "Spam complaint").length;
  const unsubscribes = emailEvents.filter((event) => event.eventType === "Unsubscribed").length +
    smsEvents.filter((event) => event.optOutFlag).length;
  const complianceStatusCounts = complianceStatusSummary(state, workspaceId);
  const deliverabilityOpenAlerts = state.deliverabilityAlerts.filter(
    (alert) => alert.workspaceId === workspaceId && alert.status === "Open"
  );

  const metrics = {
    rawLeads: rawLeads.length,
    normalized: normalizedRecords.length,
    verifiedContacts: verifiedContacts.length,
    enrichedContacts: enrichedContacts.length,
    assignedContacts: assignedContacts.length,
    contacted: contactedAssignments.length,
    replies: replyCount,
    meetings: meetingCount,
    opportunities: opportunities.length,
    wonDeals: opportunities.filter((opportunity) => opportunity.stage === "Closed won").length,
    openPipeline,
    wonRevenue,
    bounceRate: percent(bouncedEmails, sentEmails),
    spamComplaintRate: percent(spamComplaints, sentEmails),
    unsubscribeRate: percent(unsubscribes, sentEmails),
    actualLeadCost: totalLeadCost,
    estimatedLeadCost: centsToDollars(costMetrics.estimatedCostCents),
    projectedLeadCost: centsToDollars(costMetrics.projectedCostCents),
    costPerVerifiedLead: centsToDollars(costMetrics.costPerVerifiedEmailCents),
    costPerValidPhone: centsToDollars(costMetrics.costPerValidPhoneCents),
    costPerSdrReadyLead: centsToDollars(costMetrics.costPerSdrReadyLeadCents),
    costPerOpportunity: centsToDollars(costMetrics.costPerOpportunityCents),
    complianceWarnings: complianceStatusCounts.Warning + complianceStatusCounts.Fail,
    openDataSubjectRequests: dataSubjectRequests.filter((request) => request.status !== "Completed" && request.status !== "Rejected").length,
    openDeliverabilityAlerts: deliverabilityOpenAlerts.length,
    snapshots: reportSnapshots.length
  };

  return {
    workspace,
    metrics,
    funnelRows: [
      conversionRow("Raw to normalized", rawLeads.length, normalizedRecords.length),
      conversionRow("Normalized to verified", normalizedRecords.length, verifiedContacts.length),
      conversionRow("Raw to verified", rawLeads.length, verifiedContacts.length),
      conversionRow("Verified to enriched", verifiedContacts.length, enrichedContacts.length),
      conversionRow("Verified to assigned", verifiedContacts.length, assignedContacts.length),
      conversionRow("Assigned to contacted", assignedContacts.length, contactedAssignments.length),
      conversionRow("Contacted to reply", contactedAssignments.length, replyCount),
      conversionRow("Reply to meeting", replyCount, meetingCount),
      conversionRow("Meeting to opportunity", meetingCount, opportunities.length),
      conversionRow("Opportunity to won", opportunities.length, metrics.wonDeals)
    ],
    sourcePerformance: sourcePerformanceRows(state, workspaceId, rawLeads, normalizedRecords, contacts, opportunities, leadJobs),
    sdrPerformance: sdrPerformanceRows(state, workspaceId, assignments, opportunities, emailEvents, smsEvents),
    campaignPerformance: campaignViews(state, workspaceId).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      targetSegment: campaign.targetSegment,
      ownerName: campaign.ownerName,
      totalLeads: campaign.totalLeads,
      sent: campaign.sentCount,
      replies: campaign.replyCount,
      bounceRate: campaign.bounceRate,
      unsubscribeRate: campaign.unsubscribeRate,
      meetings: campaign.meetingsBooked,
      opportunities: campaign.opportunitiesCreated,
      revenueWon: campaign.revenueWon
    })),
    deliverabilityHealth: deliverabilityRows(state, workspaceId),
    pipeline: pipelineRows(opportunities),
    dataQuality: dataQualityRows(state, workspaceId, verificationResults, contacts),
    enrichmentPerformance: enrichmentRows(state, workspaceId),
    activityVolume: activityRows(activities, emailEvents, smsEvents, trackedCalls),
    compliance: {
      statusCounts: complianceStatusCounts,
      checklist: state.complianceChecklistItems.filter((item) => item.workspaceId === workspaceId),
      suppressions: suppressionRows(suppressions),
      dataSubjectRequests,
      openAlerts: deliverabilityOpenAlerts
    },
    revenueAttribution: revenueAttributionRows(state, workspaceId, opportunities),
    retention: retentionRows(state, workspaceId),
    snapshots: reportSnapshots
  };
}

export function generateReportSnapshots(
  state: AppState,
  workspaceId: string,
  generatedById: string,
  generatedAt = new Date().toISOString()
) {
  const dashboard = reportingDashboardSnapshot(state, workspaceId);
  const snapshots: ReportSnapshot[] = reportCategories.map((category) => ({
    id: `report-${randomUUID()}`,
    workspaceId,
    category,
    title: `${category} snapshot`,
    metrics: metricsForCategory(category, dashboard),
    generatedById,
    generatedAt
  }));

  state.reportSnapshots.unshift(...snapshots);
  state.reportSnapshots = state.reportSnapshots
    .filter((snapshot) => snapshot.workspaceId !== workspaceId || snapshot.generatedAt === generatedAt)
    .concat(
      state.reportSnapshots
        .filter((snapshot) => snapshot.workspaceId === workspaceId && snapshot.generatedAt !== generatedAt)
        .slice(0, 55 - snapshots.length)
    );

  return { count: snapshots.length, generatedAt };
}

export function refreshDeliverabilityAlerts(state: AppState, workspaceId: string, now = new Date().toISOString()) {
  let changed = false;
  const emailProvider = state.outreachProviders.find((provider) => provider.workspaceId === workspaceId && provider.kind === "Email");
  const sentEmails = state.emailEvents.filter((event) => event.workspaceId === workspaceId && event.eventType === "Sent").length;
  const catchAllResults = state.verificationResults.filter(
    (result) => result.workspaceId === workspaceId && result.catchAll
  ).length;
  const catchAllRate = percent(catchAllResults, state.verificationResults.filter((result) => result.workspaceId === workspaceId).length);

  if (emailProvider) {
    changed = upsertCurrentAlert(state, {
      id: `alert-${emailProvider.id}-bounce-rate`,
      workspaceId,
      providerId: emailProvider.id,
      trigger: "Hard bounce rate above 3%",
      currentValue: emailProvider.bounceRate,
      threshold: 3,
      severity: emailProvider.bounceRate > 8 ? "Critical" : "Warning",
      condition: emailProvider.bounceRate > 3,
      recommendation: "Pause affected campaigns, verify source quality, and suppress hard-bounced recipients.",
      now
    }) || changed;

    changed = upsertCurrentAlert(state, {
      id: `alert-${emailProvider.id}-spam-complaints`,
      workspaceId,
      providerId: emailProvider.id,
      trigger: "Spam complaint rate above 0.1%",
      currentValue: emailProvider.complaintRate,
      threshold: 0.1,
      severity: "Critical",
      condition: emailProvider.complaintRate > 0.1,
      recommendation: "Stop sends from this mailbox group and review targeting, copy, and source provenance.",
      now
    }) || changed;

    changed = upsertCurrentAlert(state, {
      id: `alert-${emailProvider.id}-unsubscribe-rate`,
      workspaceId,
      providerId: emailProvider.id,
      trigger: "Unsubscribe spike",
      currentValue: emailProvider.unsubscribeRate,
      threshold: 5,
      severity: "Warning",
      condition: emailProvider.unsubscribeRate > 5,
      recommendation: "Review list fit and message frequency before the next sequence step.",
      now
    }) || changed;

    changed = upsertCurrentAlert(state, {
      id: `alert-${emailProvider.id}-daily-limit`,
      workspaceId,
      providerId: emailProvider.id,
      trigger: "Mailbox daily limit above 90%",
      currentValue: percent(emailProvider.sentToday, emailProvider.dailyLimit),
      threshold: 90,
      severity: "Warning",
      condition: emailProvider.dailyLimit > 0 && emailProvider.sentToday / emailProvider.dailyLimit > 0.9,
      recommendation: "Throttle campaign sends or distribute volume across warmed mailbox groups.",
      now
    }) || changed;

    changed = upsertCurrentAlert(state, {
      id: `alert-${emailProvider.id}-auth-failure`,
      workspaceId,
      providerId: emailProvider.id,
      trigger: "Email authentication failure",
      currentValue: [emailProvider.spf, emailProvider.dkim, emailProvider.dmarc, emailProvider.tls].filter(Boolean).length,
      threshold: 4,
      severity: "Critical",
      condition: !emailProvider.spf || !emailProvider.dkim || !emailProvider.dmarc || !emailProvider.tls,
      recommendation: "Fix SPF, DKIM, DMARC, and TLS before sending from this domain.",
      now
    }) || changed;
  }

  changed = upsertCurrentAlert(state, {
    id: "alert-catch-all-ratio",
    workspaceId,
    trigger: "High catch-all ratio",
    currentValue: catchAllRate,
    threshold: 20,
    severity: "Warning",
    condition: sentEmails > 0 && catchAllRate > 20,
    recommendation: "Route catch-all heavy lists through additional verification before export or campaign send.",
    now
  }) || changed;

  return { changed };
}

export function runRetentionPolicy(
  state: AppState,
  workspaceId: string,
  policyId: string,
  mode: RetentionRunMode,
  runById: string
) {
  const policy = state.retentionPolicies.find((item) => item.id === policyId && item.workspaceId === workspaceId);

  if (!policy) {
    throw new Error("Retention policy not found.");
  }

  const candidates = retentionCandidates(state, workspaceId, policy);
  const canApply = mode === "Apply" && policy.active && policy.action !== "Preserve" && policy.action !== "Review";
  const affectedCount = canApply ? applyRetentionAction(state, policy, candidates) : 0;
  const now = new Date().toISOString();
  const run: RetentionRun = {
    id: `retention-run-${randomUUID()}`,
    workspaceId,
    retentionPolicyId: policy.id,
    dataType: policy.dataType,
    mode,
    action: policy.action,
    candidateCount: candidates.length,
    affectedCount,
    status: mode === "Preview" ? "Previewed" : canApply ? "Applied" : "Skipped",
    summary: retentionSummary(policy, mode, candidates.length, affectedCount),
    runById,
    runAt: now
  };

  state.retentionRuns.unshift(run);
  return run;
}

export function resolveDeliverabilityAlert(state: AppState, workspaceId: string, alertId: string, actorUserId: string) {
  const alert = state.deliverabilityAlerts.find((item) => item.id === alertId && item.workspaceId === workspaceId);

  if (!alert) {
    throw new Error("Deliverability alert not found.");
  }

  alert.status = "Resolved";
  alert.resolvedAt = new Date().toISOString();
  alert.resolvedById = actorUserId;
  return alert;
}

export function defaultRetentionPolicies(workspaceId: string, now = new Date().toISOString()): RetentionPolicy[] {
  return [
    retentionPolicy(workspaceId, "Unworked cold leads", 365, "Anonymize", "Legitimate interest", "Unworked cold records age out after 12 months."),
    retentionPolicy(workspaceId, "Verified/enriched lead data", 730, "Review", "Legitimate interest", "Review enrichment data after 12-24 months."),
    retentionPolicy(workspaceId, "Email activity logs", 730, "Purge", "Operational audit", "Keep outbound activity logs for 24 months."),
    retentionPolicy(workspaceId, "Call recordings", 365, "Anonymize", "Consent and quality", "Remove recordings/transcripts after 6-12 months."),
    retentionPolicy(workspaceId, "SMS logs", 730, "Purge", "Consent and audit", "Keep SMS logs for 12-24 months."),
    retentionPolicy(workspaceId, "Suppression list", 0, "Preserve", "Compliance obligation", "Suppression records are preserved indefinitely."),
    retentionPolicy(workspaceId, "Audit logs", 1095, "Preserve", "Security audit", "Keep audit logs for at least 24 months."),
    retentionPolicy(workspaceId, "Export files", 90, "Expire export", "Data minimization", "Expire generated export files after 30-90 days unless pinned."),
    retentionPolicy(workspaceId, "Raw source payloads", 180, "Purge", "Data minimization", "Remove raw source payloads after the processing window.", now)
  ].map((policy) => ({ ...policy, createdAt: now, updatedAt: now }));
}

function defaultComplianceChecklist(state: AppState, workspaceId: string, now: string): ComplianceChecklistItem[] {
  const emailProviders = state.outreachProviders.filter((provider) => provider.workspaceId === workspaceId && provider.kind === "Email");
  const authPass = emailProviders.length > 0 && emailProviders.every((provider) => provider.spf && provider.dkim && provider.dmarc && provider.tls);
  const suppressions = state.suppressionRecords.filter((record) => record.workspaceId === workspaceId);
  const retentionPolicies = state.retentionPolicies.filter((policy) => policy.workspaceId === workspaceId && policy.active);
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const contactsWithConsentPosture = contacts.filter(
    (contact) => contact.lawfulBasis && contact.consentStatus && contact.consentSource
  ).length;
  const emailSteps = state.sequenceSteps.filter((step) => step.workspaceId === workspaceId && step.channel === "Email");
  const compliantEmailSteps = emailSteps.filter((step) => resolveSequenceComplianceStatus(step) === "Compliant").length;
  const trackedCalls = state.trackedCalls.filter((call) => call.workspaceId === workspaceId);
  const callsWithConsent = trackedCalls.filter((call) => Boolean(call.recordingConsent)).length;

  return [
    checklistItem(
      workspaceId,
      "Outbound email",
      "SPF, DKIM, DMARC, and TLS are configured",
      "Provider connection health checks",
      authPass ? "Pass" : "Fail",
      authPass ? "All email authentication checks are passing." : "At least one email authentication check needs review.",
      "Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Outbound email",
      "Unsubscribe and bounce handling",
      "Suppression records from email events",
      suppressions.some((record) => record.type === "Unsubscribe" || record.type === "Hard bounce") ? "Pass" : "Warning",
      `${suppressions.length} suppression records are enforced before export and outreach.`,
      "Compliance Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Privacy",
      "Contact lawful basis and consent posture is captured",
      "Contact compliance fields",
      contacts.length === 0 || contactsWithConsentPosture === contacts.length ? "Pass" : "Warning",
      `${contactsWithConsentPosture} of ${contacts.length} contacts include lawful basis, consent status, and source.`,
      "Compliance Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Privacy",
      "Data subject request workflow is available",
      "Access, deletion, suppression, correction, and export requests",
      Array.isArray(state.dataSubjectRequests) ? "Pass" : "Fail",
      `${state.dataSubjectRequests.filter((request) => request.workspaceId === workspaceId).length} privacy requests are tracked.`,
      "Compliance Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Outbound email",
      "Cold email templates include unsubscribe and physical address",
      "Sequence step compliance enforcement",
      emailSteps.length === 0 || compliantEmailSteps === emailSteps.length ? "Pass" : "Warning",
      `${compliantEmailSteps} of ${emailSteps.length} email steps meet footer and address requirements.`,
      "Compliance Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Phone and SMS",
      "Call recording consent is captured before storing media",
      "Tracked call recording consent",
      trackedCalls.length === 0 || callsWithConsent === trackedCalls.length ? "Pass" : "Warning",
      `${callsWithConsent} of ${trackedCalls.length} tracked calls include recording consent status.`,
      "Compliance Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Privacy",
      "Retention TTLs exist for personal data",
      "Active retention policies",
      retentionPolicies.length >= 8 ? "Pass" : "Warning",
      `${retentionPolicies.length} active retention policies are configured.`,
      "Compliance Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Privacy",
      "Source transparency and minimization",
      "Raw source lineage and export gates",
      state.rawLeads.some((lead) => lead.workspaceId === workspaceId && lead.source) ? "Pass" : "Warning",
      "Raw leads include source labels and export rules enforce quality gates.",
      "Data Operator",
      now
    ),
    checklistItem(
      workspaceId,
      "Phone and SMS",
      "DNC, STOP, and phone suppression",
      "Phone/SMS suppression records",
      suppressions.some((record) => record.type === "Do not call" || record.type === "SMS opt-out") ? "Pass" : "Warning",
      "Phone and SMS suppressions block assignment, outreach, and reminders.",
      "Compliance Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Admin",
      "Audit logs capture critical changes",
      "Workspace audit trail",
      state.auditLogs.some((log) => log.workspaceId === workspaceId) ? "Pass" : "Fail",
      `${state.auditLogs.filter((log) => log.workspaceId === workspaceId).length} audit events are available.`,
      "Admin",
      now
    ),
    checklistItem(
      workspaceId,
      "Platform rules",
      "LinkedIn automation remains blocked",
      "Manual/import-only workflow boundary",
      "Pass",
      "Navigation supports sanctioned provider workflows only.",
      "Admin",
      now
    )
  ];
}

function sourcePerformanceRows(
  state: AppState,
  workspaceId: string,
  rawLeads: AppState["rawLeads"],
  normalizedRecords: AppState["normalizedRecords"],
  contacts: AppState["contacts"],
  opportunities: AppState["opportunities"],
  leadJobs: AppState["leadJobs"]
) {
  const sources = Array.from(
    new Set([
      ...rawLeads.map((lead) => lead.source),
      ...normalizedRecords.map((record) => record.source),
      ...contacts.flatMap((contact) => contact.sourceLineage)
    ])
  ).filter(Boolean);

  return sources.map((source) => {
    const sourceContacts = contacts.filter((contact) =>
      contact.sourceLineage.some((lineage) => lineage.toLowerCase().includes(source.toLowerCase())) ||
      normalizedRecords.some((record) => record.email === contact.email && record.source === source)
    );
    const sourceCompanyIds = new Set(sourceContacts.map((contact) => contact.companyId));
    const sourceOpportunities = opportunities.filter(
      (opportunity) =>
        sourceCompanyIds.has(opportunity.companyId) ||
        (opportunity.contactId ? sourceContacts.some((contact) => contact.id === opportunity.contactId) : false)
    );
    const sourceJobs = leadJobs.filter((job) =>
      job.sources.some((jobSource) => source.toLowerCase().includes(jobSource.toLowerCase()) || jobSource.toLowerCase().includes(source.toLowerCase()))
    );
    const cost = sourceJobs.reduce(
      (total, job) => total + centsToDollars(job.actualCostCents ?? Math.round(job.actualCost * 100)),
      0
    );
    const verified = sourceContacts.filter((contact) => contact.grade === "A" || contact.grade === "B" || contact.grade === "C").length;
    const revenue = sourceOpportunities
      .filter((opportunity) => opportunity.stage === "Closed won")
      .reduce((total, opportunity) => total + opportunity.amount, 0);

    return {
      source,
      raw: rawLeads.filter((lead) => lead.source === source).length,
      normalized: normalizedRecords.filter((record) => record.source === source).length,
      verified,
      enriched: sourceContacts.filter((contact) => (contact.enrichmentCoverage ?? 0) > 0).length,
      opportunities: sourceOpportunities.length,
      revenue,
      cost,
      costPerVerified: verified ? Math.round(cost / verified) : 0,
      conversionRate: percent(sourceOpportunities.length, verified)
    };
  }).sort((a, b) => b.verified - a.verified);
}

function sdrPerformanceRows(
  state: AppState,
  workspaceId: string,
  assignments: AppState["sdrAssignments"],
  opportunities: AppState["opportunities"],
  emailEvents: AppState["emailEvents"],
  smsEvents: AppState["smsEvents"]
) {
  const sdrIds = Array.from(new Set(assignments.map((assignment) => assignment.assignedSdrId)));

  return sdrIds.map((userId) => {
    const ownedAssignments = assignments.filter((assignment) => assignment.assignedSdrId === userId);
    const contactIds = new Set(ownedAssignments.map((assignment) => assignment.contactId));
    const ownedOpportunities = opportunities.filter((opportunity) => opportunity.contactId && contactIds.has(opportunity.contactId));
    const replies = uniqueCount([
      ...emailEvents.filter((event) => contactIds.has(event.contactId) && event.eventType === "Replied").map((event) => event.contactId),
      ...smsEvents.filter((event) => contactIds.has(event.contactId) && event.status === "Replied").map((event) => event.contactId)
    ]);
    const meetings = ownedAssignments.filter((assignment) => assignment.status === "Meeting Booked").length;
    const touched = ownedAssignments.filter((assignment) => assignment.firstTouchedAt || assignment.touchCount > 0).length;
    const onTrack = ownedAssignments.filter((assignment) => assignment.slaStatus === "On track" || assignment.slaStatus === "Due soon").length;

    return {
      userId,
      name: userNameForId(state, userId),
      assigned: ownedAssignments.length,
      touched,
      contacted: ownedAssignments.filter((assignment) => assignment.status !== "New" && assignment.status !== "Assigned").length,
      replies,
      meetings,
      opportunities: ownedOpportunities.length,
      wonRevenue: ownedOpportunities
        .filter((opportunity) => opportunity.stage === "Closed won")
        .reduce((total, opportunity) => total + opportunity.amount, 0),
      overdue: ownedAssignments.filter((assignment) => assignment.slaStatus === "Overdue").length,
      slaRate: percent(onTrack, ownedAssignments.length)
    };
  }).sort((a, b) => b.assigned - a.assigned);
}

function deliverabilityRows(state: AppState, workspaceId: string) {
  return state.outreachProviders
    .filter((provider) => provider.workspaceId === workspaceId)
    .map((provider) => {
      const openAlerts = state.deliverabilityAlerts.filter(
        (alert) => alert.workspaceId === workspaceId && alert.providerId === provider.id && alert.status === "Open"
      );
      return {
        id: provider.id,
        provider: provider.provider,
        kind: provider.kind,
        status: provider.status,
        sender: provider.senderEmail ?? provider.fromNumber ?? provider.sendingDomain ?? "Workspace provider",
        bounceRate: provider.bounceRate,
        complaintRate: provider.complaintRate,
        unsubscribeRate: provider.unsubscribeRate,
        dailyUsage: percent(provider.sentToday, provider.dailyLimit),
        authChecks: [provider.spf, provider.dkim, provider.dmarc, provider.tls].filter(Boolean).length,
        alertCount: openAlerts.length,
        recommendation: openAlerts[0]?.recommendation ?? "Provider is inside configured guardrails."
      };
    });
}

function pipelineRows(opportunities: AppState["opportunities"]) {
  const stages = ["Prospecting", "Qualified", "Discovery", "Proposal", "Closed won", "Closed lost"];

  return stages.map((stage) => {
    const stageOpportunities = opportunities.filter((opportunity) => opportunity.stage === stage);
    const amount = stageOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
    return {
      stage,
      opportunities: stageOpportunities.length,
      amount,
      weightedAmount: stageOpportunities.reduce(
        (total, opportunity) => total + Math.round(opportunity.amount * (opportunity.probability / 100)),
        0
      )
    };
  });
}

function dataQualityRows(
  state: AppState,
  workspaceId: string,
  verificationResults: AppState["verificationResults"],
  contacts: AppState["contacts"]
) {
  return [
    { label: "Open duplicates", value: state.dedupeMatches.filter((match) => match.workspaceId === workspaceId && match.status === "Open").length },
    { label: "Suppressed contacts", value: contacts.filter((contact) => contact.isSuppressed).length },
    { label: "Valid emails", value: verificationResults.filter((result) => result.emailStatus === "Valid").length },
    { label: "Risky emails", value: verificationResults.filter((result) => result.emailStatus === "Risky").length },
    { label: "Invalid emails", value: verificationResults.filter((result) => result.emailStatus === "Invalid").length },
    { label: "Catch-all emails", value: verificationResults.filter((result) => result.catchAll).length }
  ];
}

function enrichmentRows(state: AppState, workspaceId: string) {
  const providers = Array.from(
    new Set(state.enrichmentResults.filter((result) => result.workspaceId === workspaceId).map((result) => result.provider))
  );

  return providers.map((provider) => {
    const results = state.enrichmentResults.filter((result) => result.workspaceId === workspaceId && result.provider === provider);
    const cache = state.providerCache.filter((entry) => entry.workspaceId === workspaceId && entry.provider === provider);
    return {
      provider,
      records: results.length,
      avgConfidence: results.length ? Math.round(results.reduce((total, result) => total + result.confidence, 0) / results.length) : 0,
      cacheEntries: cache.length,
      cacheHits: cache.reduce((total, entry) => total + entry.hits, 0)
    };
  }).sort((a, b) => b.records - a.records);
}

function activityRows(
  activities: AppState["activities"],
  emailEvents: AppState["emailEvents"],
  smsEvents: AppState["smsEvents"],
  trackedCalls: AppState["trackedCalls"]
) {
  const rows = [
    { channel: "Email", count: emailEvents.length, lastActivityAt: latestDate(emailEvents.map(eventTime)) },
    { channel: "SMS", count: smsEvents.length, lastActivityAt: latestDate(smsEvents.map((event) => event.createdAt)) },
    { channel: "Tracked calls", count: trackedCalls.length, lastActivityAt: latestDate(trackedCalls.map((call) => call.createdAt)) },
    { channel: "CRM activities", count: activities.length, lastActivityAt: latestDate(activities.map((activity) => activity.createdAt)) }
  ];

  return rows.sort((a, b) => b.count - a.count);
}

function revenueAttributionRows(state: AppState, workspaceId: string, opportunities: AppState["opportunities"]) {
  const rowsBySource = sourcePerformanceRows(
    state,
    workspaceId,
    state.rawLeads.filter((lead) => lead.workspaceId === workspaceId),
    state.normalizedRecords.filter((record) => record.workspaceId === workspaceId),
    state.contacts.filter((contact) => contact.workspaceId === workspaceId),
    opportunities,
    state.leadJobs.filter((job) => job.workspaceId === workspaceId)
  ).map((row) => ({
    dimension: row.source,
    type: "Source",
    opportunities: row.opportunities,
    revenue: row.revenue
  }));

  const rowsByOwner = Array.from(new Set(opportunities.map((opportunity) => opportunity.ownerUserId))).map((ownerUserId) => {
    const owned = opportunities.filter((opportunity) => opportunity.ownerUserId === ownerUserId);
    return {
      dimension: userNameForId(state, ownerUserId),
      type: "SDR",
      opportunities: owned.length,
      revenue: owned.filter((opportunity) => opportunity.stage === "Closed won").reduce((total, opportunity) => total + opportunity.amount, 0)
    };
  });

  return [...rowsBySource, ...rowsByOwner].sort((a, b) => b.revenue - a.revenue || b.opportunities - a.opportunities);
}

function retentionRows(state: AppState, workspaceId: string) {
  return state.retentionPolicies
    .filter((policy) => policy.workspaceId === workspaceId)
    .map((policy) => {
      const latestRun = state.retentionRuns
        .filter((run) => run.retentionPolicyId === policy.id)
        .sort((a, b) => Date.parse(b.runAt) - Date.parse(a.runAt))[0];

      return {
        ...policy,
        candidateCount: retentionCandidates(state, workspaceId, policy).length,
        latestRun
      };
    });
}

function suppressionRows(suppressions: AppState["suppressionRecords"]) {
  return ["Unsubscribe", "Hard bounce", "Do not call", "Existing customer", "Spam complaint", "SMS opt-out", "Deletion request"].map((type) => ({
    type,
    count: suppressions.filter((record) => record.type === type).length
  }));
}

function complianceStatusSummary(state: AppState, workspaceId: string) {
  const items = state.complianceChecklistItems.filter((item) => item.workspaceId === workspaceId);
  return {
    Pass: items.filter((item) => item.status === "Pass").length,
    Warning: items.filter((item) => item.status === "Warning").length,
    Fail: items.filter((item) => item.status === "Fail").length
  };
}

function metricsForCategory(category: ReportCategory, dashboard: ReturnType<typeof reportingDashboardSnapshot>): ReportMetric[] {
  const m = dashboard.metrics;
  const map: Record<ReportCategory, ReportMetric[]> = {
    "Executive Overview": [
      metric("Raw leads", m.rawLeads),
      metric("Verified contacts", m.verifiedContacts),
      metric("Open pipeline", m.openPipeline, "currency"),
      metric("Won revenue", m.wonRevenue, "currency")
    ],
    "Lead Source Performance": [
      metric("Sources", dashboard.sourcePerformance.length),
      metric("Best source verified", dashboard.sourcePerformance[0]?.verified ?? 0),
      metric("Cost per verified lead", m.costPerVerifiedLead, "currency"),
      metric("Cost per valid phone", m.costPerValidPhone, "currency"),
      metric("Cost per SDR-ready lead", m.costPerSdrReadyLead, "currency"),
      metric("Cost per opportunity", m.costPerOpportunity, "currency")
    ],
    "SDR Performance": [
      metric("Assigned contacts", m.assignedContacts),
      metric("Contacted", m.contacted),
      metric("Replies", m.replies),
      metric("Meetings", m.meetings)
    ],
    "Campaign Performance": [
      metric("Campaigns", dashboard.campaignPerformance.length),
      metric("Email sent", dashboard.campaignPerformance.reduce((total, row) => total + row.sent, 0)),
      metric("Replies", dashboard.campaignPerformance.reduce((total, row) => total + row.replies, 0)),
      metric("Campaign revenue won", dashboard.campaignPerformance.reduce((total, row) => total + row.revenueWon, 0), "currency")
    ],
    "Deliverability Health": [
      metric("Bounce rate", m.bounceRate, "percent"),
      metric("Spam complaint rate", m.spamComplaintRate, "percent"),
      metric("Unsubscribe rate", m.unsubscribeRate, "percent"),
      metric("Open alerts", m.openDeliverabilityAlerts)
    ],
    "Pipeline Dashboard": [
      metric("Opportunities", m.opportunities),
      metric("Won deals", m.wonDeals),
      metric("Open pipeline", m.openPipeline, "currency"),
      metric("Won revenue", m.wonRevenue, "currency")
    ],
    "Data Quality": [
      metric("Normalized records", m.normalized),
      metric("Verified contacts", m.verifiedContacts),
      metric("Suppressed contacts", dashboard.dataQuality.find((row) => row.label === "Suppressed contacts")?.value ?? 0),
      metric("Open duplicates", dashboard.dataQuality.find((row) => row.label === "Open duplicates")?.value ?? 0)
    ],
    "Enrichment Performance": [
      metric("Enriched contacts", m.enrichedContacts),
      metric("Providers", dashboard.enrichmentPerformance.length),
      metric("Cache entries", dashboard.enrichmentPerformance.reduce((total, row) => total + row.cacheEntries, 0)),
      metric("Cache hits", dashboard.enrichmentPerformance.reduce((total, row) => total + row.cacheHits, 0))
    ],
    "Activity Volume": [
      metric("Email events", dashboard.activityVolume.find((row) => row.channel === "Email")?.count ?? 0),
      metric("SMS events", dashboard.activityVolume.find((row) => row.channel === "SMS")?.count ?? 0),
      metric("Calls", dashboard.activityVolume.find((row) => row.channel === "Tracked calls")?.count ?? 0),
      metric("CRM activities", dashboard.activityVolume.find((row) => row.channel === "CRM activities")?.count ?? 0)
    ],
    "Compliance Dashboard": [
      metric("Passing controls", dashboard.compliance.statusCounts.Pass),
      metric("Warnings", dashboard.compliance.statusCounts.Warning),
      metric("Failures", dashboard.compliance.statusCounts.Fail),
      metric("Open privacy requests", dashboard.metrics.openDataSubjectRequests),
      metric("Suppression records", dashboard.compliance.suppressions.reduce((total, row) => total + row.count, 0))
    ],
    "Revenue Attribution": [
      metric("Attributed rows", dashboard.revenueAttribution.length),
      metric("Won revenue", m.wonRevenue, "currency"),
      metric("Opportunities", m.opportunities),
      metric("Cost per opportunity", m.costPerOpportunity, "currency")
    ]
  };

  return map[category];
}

function retentionCandidates(state: AppState, workspaceId: string, policy: RetentionPolicy) {
  if (!policy.active || policy.retentionDays <= 0) {
    return [];
  }

  const cutoff = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000;
  const isOld = (value?: string) => Boolean(value) && Date.parse(value ?? "") < cutoff;

  if (policy.dataType === "Unworked cold leads") {
    return state.contacts
      .filter(
        (contact) =>
          contact.workspaceId === workspaceId &&
          ["New", "Assigned", "Ready for SDR", "Needs enrichment", "In review"].includes(contact.status) &&
          isOld(contact.updatedAt)
      )
      .map((contact) => contact.id);
  }

  if (policy.dataType === "Verified/enriched lead data") {
    return state.contacts
      .filter((contact) => contact.workspaceId === workspaceId && ((contact.enrichmentCoverage ?? 0) > 0 || contact.verification) && isOld(contact.updatedAt))
      .map((contact) => contact.id);
  }

  if (policy.dataType === "Email activity logs") {
    return state.emailEvents.filter((event) => event.workspaceId === workspaceId && isOld(eventTime(event))).map((event) => event.id);
  }

  if (policy.dataType === "Call recordings") {
    return state.trackedCalls
      .filter((call) => call.workspaceId === workspaceId && Boolean(call.recordingUrl || call.transcript) && isOld(call.createdAt))
      .map((call) => call.id);
  }

  if (policy.dataType === "SMS logs") {
    return state.smsEvents.filter((event) => event.workspaceId === workspaceId && isOld(event.createdAt)).map((event) => event.id);
  }

  if (policy.dataType === "Export files") {
    return state.exports.filter((item) => item.workspaceId === workspaceId && isOld(item.createdAt)).map((item) => item.id);
  }

  if (policy.dataType === "Raw source payloads") {
    return state.rawLeads
      .filter((lead) => lead.workspaceId === workspaceId && Object.keys(lead.sourcePayload).length > 0 && isOld(lead.extractedAt))
      .map((lead) => lead.id);
  }

  if (policy.dataType === "Audit logs") {
    return state.auditLogs.filter((log) => log.workspaceId === workspaceId && isOld(log.createdAt)).map((log) => log.id);
  }

  return [];
}

function applyRetentionAction(state: AppState, policy: RetentionPolicy, candidates: string[]) {
  const candidateSet = new Set(candidates);

  if (policy.dataType === "Unworked cold leads") {
    let affected = 0;
    for (const contact of state.contacts.filter((item) => candidateSet.has(item.id))) {
      suppressContact(contact, "Retention anonymization policy");
      contact.name = `Anonymized contact ${contact.id.slice(-6)}`;
      contact.title = "Anonymized";
      contact.email = "";
      contact.phone = "";
      contact.owner = "Unassigned";
      contact.updatedAt = new Date().toISOString();
      affected += 1;
    }
    return affected;
  }

  if (policy.dataType === "Verified/enriched lead data") {
    let affected = 0;
    for (const contact of state.contacts.filter((item) => candidateSet.has(item.id))) {
      contact.enrichmentCoverage = 0;
      contact.enrichedAt = undefined;
      contact.seniority = undefined;
      contact.department = undefined;
      contact.fitReason = undefined;
      contact.verification = "Retention review required";
      contact.updatedAt = new Date().toISOString();
      affected += 1;
    }
    return affected;
  }

  if (policy.dataType === "Email activity logs") {
    const before = state.emailEvents.length;
    state.emailEvents = state.emailEvents.filter((event) => !candidateSet.has(event.id));
    return before - state.emailEvents.length;
  }

  if (policy.dataType === "Call recordings") {
    let affected = 0;
    for (const call of state.trackedCalls.filter((item) => candidateSet.has(item.id))) {
      call.recordingUrl = undefined;
      call.recordingStoragePath = undefined;
      call.transcript = undefined;
      call.callSummary = call.callSummary ? "Recording metadata retained; recording content removed by retention policy." : undefined;
      affected += 1;
    }
    return affected;
  }

  if (policy.dataType === "SMS logs") {
    const before = state.smsEvents.length;
    state.smsEvents = state.smsEvents.filter((event) => !candidateSet.has(event.id));
    return before - state.smsEvents.length;
  }

  if (policy.dataType === "Export files") {
    let affected = 0;
    for (const exportRecord of state.exports.filter((item) => candidateSet.has(item.id))) {
      exportRecord.recordIds = [];
      exportRecord.recordCount = 0;
      exportRecord.status = "Draft";
      affected += 1;
    }
    return affected;
  }

  if (policy.dataType === "Raw source payloads") {
    let affected = 0;
    for (const rawLead of state.rawLeads.filter((item) => candidateSet.has(item.id))) {
      rawLead.sourcePayload = {};
      affected += 1;
    }
    return affected;
  }

  return 0;
}

function retentionSummary(policy: RetentionPolicy, mode: RetentionRunMode, candidateCount: number, affectedCount: number) {
  if (mode === "Preview") {
    return `${candidateCount} ${policy.dataType.toLowerCase()} candidate${candidateCount === 1 ? "" : "s"} match the ${policy.retentionDays}-day policy.`;
  }

  if (!policy.active) {
    return `${policy.dataType} policy is inactive; no records changed.`;
  }

  if (policy.action === "Preserve" || policy.action === "Review") {
    return `${policy.dataType} requires ${policy.action.toLowerCase()}; no automated mutation was applied.`;
  }

  return `${affectedCount} of ${candidateCount} candidate${candidateCount === 1 ? "" : "s"} processed with ${policy.action.toLowerCase()}.`;
}

function upsertCurrentAlert(
  state: AppState,
  input: {
    id: string;
    workspaceId: string;
    providerId?: string;
    trigger: string;
    severity: DeliverabilityAlert["severity"];
    currentValue: number;
    threshold: number;
    condition: boolean;
    recommendation: string;
    now: string;
  }
) {
  const existing = state.deliverabilityAlerts.find((alert) => alert.id === input.id);

  if (input.condition) {
    if (existing) {
      if (
        existing.status === "Resolved" &&
        existing.currentValue === input.currentValue &&
        existing.threshold === input.threshold &&
        existing.severity === input.severity
      ) {
        existing.recommendation = input.recommendation;
        return false;
      }

      const changed =
        existing.status !== "Open" ||
        existing.currentValue !== input.currentValue ||
        existing.threshold !== input.threshold ||
        existing.severity !== input.severity;
      existing.status = "Open";
      existing.currentValue = input.currentValue;
      existing.threshold = input.threshold;
      existing.severity = input.severity;
      existing.recommendation = input.recommendation;
      existing.resolvedAt = undefined;
      existing.resolvedById = undefined;
      return changed;
    }

    state.deliverabilityAlerts.unshift({
      id: input.id,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      trigger: input.trigger,
      severity: input.severity,
      status: "Open",
      currentValue: input.currentValue,
      threshold: input.threshold,
      recommendation: input.recommendation,
      createdAt: input.now
    });
    return true;
  }

  if (existing && existing.status === "Open") {
    existing.status = "Resolved";
    existing.resolvedAt = input.now;
    return true;
  }

  return false;
}

function retentionPolicy(
  workspaceId: string,
  dataType: string,
  retentionDays: number,
  action: RetentionAction,
  legalBasis: string,
  notes: string,
  now = new Date().toISOString()
) {
  return {
    id: `retention-${dataType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    workspaceId,
    dataType,
    retentionDays,
    action,
    active: true,
    legalBasis,
    notes,
    createdAt: now,
    updatedAt: now
  } satisfies RetentionPolicy;
}

function checklistItem(
  workspaceId: string,
  category: string,
  requirement: string,
  control: string,
  status: ComplianceChecklistStatus,
  evidence: string,
  ownerRole: ComplianceChecklistItem["ownerRole"],
  updatedAt: string
) {
  return {
    id: `check-${category}-${requirement}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    workspaceId,
    category,
    requirement,
    control,
    status,
    evidence,
    ownerRole,
    updatedAt
  } satisfies ComplianceChecklistItem;
}

function conversionRow(name: string, from: number, to: number) {
  return { name, from, to, rate: percent(to, from) };
}

function metric(label: string, value: number, unit: ReportMetric["unit"] = "count", note?: string): ReportMetric {
  return { label, value, unit, note };
}

function percent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.round((value / total) * 1000) / 10);
}

function uniqueCount(values: Array<string | undefined>) {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function latestDate(values: string[]) {
  return values.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function eventTime(event: AppState["emailEvents"][number]) {
  return (
    event.unsubscribeAt ??
    event.bouncedAt ??
    event.repliedAt ??
    event.clickedAt ??
    event.openedAt ??
    event.deliveredAt ??
    event.sentAt ??
    new Date().toISOString()
  );
}

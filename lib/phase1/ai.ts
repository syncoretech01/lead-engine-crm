import { randomUUID } from "node:crypto";
import { addActivity, userNameForId } from "@/lib/phase1/crm";
import { splitList } from "@/lib/phase1/csv";
import { reportingDashboardSnapshot } from "@/lib/phase1/reporting";
import type {
  AiAutomationKind,
  AiAutomationRun,
  AiCallSummary,
  AiDeliverabilityRecommendation,
  AiIcpRecommendation,
  AiLeadScorePrediction,
  AiPersonalization,
  AiRecordStatus,
  AiReplyClassification,
  AiReplyIntent,
  AiRevenueInsight,
  AppState,
  Contact,
  Opportunity,
  OutreachChannel,
  Priority,
  SearchProfile
} from "@/lib/phase1/types";

export const aiAutomationKinds: AiAutomationKind[] = [
  "Personalization",
  "Reply classification",
  "Call summaries",
  "Lead scoring",
  "ICP builder",
  "Deliverability advisor",
  "Revenue attribution insights",
  "Full automation suite"
];

export const aiRecordStatuses: AiRecordStatus[] = ["Generated", "Applied", "Dismissed"];

export function ensureAiDefaults(state: AppState, workspaceId: string) {
  const hasPhase8Records =
    state.aiPersonalizations.some((record) => record.workspaceId === workspaceId) ||
    state.aiReplyClassifications.some((record) => record.workspaceId === workspaceId) ||
    state.aiCallSummaries.some((record) => record.workspaceId === workspaceId) ||
    state.aiLeadScorePredictions.some((record) => record.workspaceId === workspaceId) ||
    state.aiIcpRecommendations.some((record) => record.workspaceId === workspaceId) ||
    state.aiDeliverabilityRecommendations.some((record) => record.workspaceId === workspaceId) ||
    state.aiRevenueInsights.some((record) => record.workspaceId === workspaceId);

  if (hasPhase8Records) {
    return { changed: false };
  }

  const result = runAiAutomationSuite(state, workspaceId, state.users[0]?.id ?? "system", true);
  return { changed: result.recordsCreated > 0 };
}

export function aiAutomationDashboard(state: AppState, workspaceId: string) {
  const personalizations = aiPersonalizationViews(state, workspaceId);
  const replyClassifications = aiReplyClassificationViews(state, workspaceId);
  const callSummaries = aiCallSummaryViews(state, workspaceId);
  const leadScores = aiLeadScoreViews(state, workspaceId);
  const icpRecommendations = state.aiIcpRecommendations
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const deliverabilityRecommendations = state.aiDeliverabilityRecommendations
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const revenueInsights = state.aiRevenueInsights
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => b.impactAmount - a.impactAmount || b.confidence - a.confidence);
  const automationRuns = state.aiAutomationRuns
    .filter((run) => run.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));

  return {
    metrics: {
      personalizations: personalizations.length,
      classifiedReplies: replyClassifications.length,
      callSummaries: callSummaries.length,
      leadScorePredictions: leadScores.length,
      icpRecommendations: icpRecommendations.length,
      deliverabilityRecommendations: deliverabilityRecommendations.length,
      revenueInsights: revenueInsights.length,
      appliedRecords: [
        ...personalizations,
        ...replyClassifications,
        ...callSummaries,
        ...leadScores,
        ...icpRecommendations,
        ...deliverabilityRecommendations,
        ...revenueInsights
      ].filter((record) => record.status === "Applied").length
    },
    personalizations,
    replyClassifications,
    callSummaries,
    leadScores,
    icpRecommendations,
    deliverabilityRecommendations,
    revenueInsights,
    automationRuns
  };
}

export function runAiAutomationSuite(state: AppState, workspaceId: string, actorUserId: string, seeded = false) {
  const startedAt = new Date().toISOString();
  const steps = [
    generateAiPersonalizations(state, workspaceId, actorUserId, seeded),
    classifyAiReplies(state, workspaceId, actorUserId, seeded),
    generateAiCallSummaries(state, workspaceId, actorUserId, seeded),
    generateAiLeadScores(state, workspaceId, actorUserId, seeded),
    generateAiIcpRecommendations(state, workspaceId, actorUserId, seeded),
    generateAiDeliverabilityRecommendations(state, workspaceId, actorUserId, seeded),
    generateAiRevenueInsights(state, workspaceId, actorUserId, seeded)
  ];
  const recordsAnalyzed = steps.reduce((total, step) => total + step.recordsAnalyzed, 0);
  const recordsCreated = steps.reduce((total, step) => total + step.recordsCreated, 0);
  const run = recordAutomationRun(state, {
    workspaceId,
    automationType: "Full automation suite",
    status: "Completed",
    recordsAnalyzed,
    recordsCreated,
    summary: `Generated ${recordsCreated} AI automation record${recordsCreated === 1 ? "" : "s"} across ${steps.length} automation areas.`,
    runById: actorUserId,
    startedAt,
    completedAt: new Date().toISOString()
  });

  return run;
}

export function generateAiPersonalizations(state: AppState, workspaceId: string, actorUserId: string, seeded = false) {
  const contacts = state.contacts
    .filter((contact) => contact.workspaceId === workspaceId && !contact.isSuppressed && contact.grade !== "D" && contact.grade !== "S")
    .sort((a, b) => b.score - a.score)
    .slice(0, seeded ? 8 : 16);
  let created = 0;

  for (const contact of contacts) {
    if (state.aiPersonalizations.some((record) => record.contactId === contact.id && record.workspaceId === workspaceId)) {
      continue;
    }

    const company = state.companies.find((item) => item.id === contact.companyId);
    const campaign = campaignForContact(state, workspaceId, contact);
    const channel = recommendedChannelForContact(state, contact);
    const personalization: AiPersonalization = {
      id: `ai-personalization-${randomUUID()}`,
      workspaceId,
      contactId: contact.id,
      companyId: contact.companyId,
      campaignId: campaign?.id,
      provider: "Syncore AI Local",
      firstLine: `${firstName(contact.name)}, noticed ${company?.name ?? "your team"} is tied to ${humanizeSegment(contact.segment)} while maintaining a ${contact.grade}-grade contact record.`,
      painPointAngle: painPointForContact(contact, company?.industry),
      recommendedOffer: offerForContact(contact, company?.industry),
      recommendedChannel: channel,
      confidence: clamp(62 + Math.round(contact.score / 4) + (contact.enrichmentCoverage ?? 0) / 5, 55, 96),
      status: "Generated",
      generatedById: actorUserId,
      generatedAt: new Date().toISOString()
    };

    state.aiPersonalizations.unshift(personalization);
    created += 1;
  }

  return recordAutomationRun(state, {
    workspaceId,
    automationType: "Personalization",
    status: "Completed",
    recordsAnalyzed: contacts.length,
    recordsCreated: created,
    summary: `Generated ${created} first-line and pain-point personalization suggestion${created === 1 ? "" : "s"}.`,
    runById: actorUserId
  });
}

export function classifyAiReplies(state: AppState, workspaceId: string, actorUserId: string, seeded = false) {
  const emailReplies = state.emailEvents
    .filter((event) => event.workspaceId === workspaceId && ["Replied", "Unsubscribed", "Spam complaint"].includes(event.eventType))
    .slice(0, seeded ? 8 : 20);
  const smsReplies = state.smsEvents
    .filter((event) => event.workspaceId === workspaceId && (event.status === "Replied" || event.status === "Opt-out"))
    .slice(0, seeded ? 6 : 20);
  let created = 0;

  for (const event of emailReplies) {
    if (state.aiReplyClassifications.some((record) => record.emailEventId === event.id)) {
      continue;
    }

    const intent = intentForEmailEvent(event.eventType, event.bodySnapshot);
    const classification: AiReplyClassification = {
      id: `ai-reply-${randomUUID()}`,
      workspaceId,
      contactId: event.contactId,
      companyId: event.companyId,
      campaignId: event.campaignId,
      emailEventId: event.id,
      channel: "Email",
      intent,
      sentiment: sentimentForIntent(intent),
      confidence: confidenceForIntent(intent),
      summary: replySummary(intent, event.subject),
      recommendedAction: recommendedReplyAction(intent),
      status: "Generated",
      classifiedAt: new Date().toISOString()
    };

    state.aiReplyClassifications.unshift(classification);
    created += 1;
  }

  for (const event of smsReplies) {
    if (state.aiReplyClassifications.some((record) => record.smsEventId === event.id)) {
      continue;
    }

    const intent = event.optOutFlag ? "Unsubscribe" : intentFromText(event.body);
    const classification: AiReplyClassification = {
      id: `ai-reply-${randomUUID()}`,
      workspaceId,
      contactId: event.contactId,
      companyId: event.companyId,
      campaignId: event.campaignId,
      smsEventId: event.id,
      channel: "SMS",
      intent,
      sentiment: sentimentForIntent(intent),
      confidence: confidenceForIntent(intent),
      summary: replySummary(intent, event.body),
      recommendedAction: recommendedReplyAction(intent),
      status: "Generated",
      classifiedAt: new Date().toISOString()
    };

    state.aiReplyClassifications.unshift(classification);
    created += 1;
  }

  return recordAutomationRun(state, {
    workspaceId,
    automationType: "Reply classification",
    status: "Completed",
    recordsAnalyzed: emailReplies.length + smsReplies.length,
    recordsCreated: created,
    summary: `Classified ${created} email/SMS repl${created === 1 ? "y" : "ies"} into intent buckets.`,
    runById: actorUserId
  });
}

export function generateAiCallSummaries(state: AppState, workspaceId: string, actorUserId: string, seeded = false) {
  const calls = state.trackedCalls
    .filter((call) => call.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, seeded ? 6 : 20);
  let created = 0;

  for (const call of calls) {
    if (state.aiCallSummaries.some((summary) => summary.trackedCallId === call.id)) {
      continue;
    }

    const contact = state.contacts.find((item) => item.id === call.contactId);
    const company = state.companies.find((item) => item.id === call.companyId);
    const summary: AiCallSummary = {
      id: `ai-call-${randomUUID()}`,
      workspaceId,
      trackedCallId: call.id,
      contactId: call.contactId,
      companyId: call.companyId,
      provider: "Syncore AI Local",
      summary:
        call.callSummary ??
        `${contact?.name ?? "Contact"} at ${company?.name ?? "the account"} had a ${call.disposition.toLowerCase()} ${call.direction.toLowerCase()} call lasting ${Math.round(call.durationSeconds / 60)} minutes.`,
      nextSteps: call.nextStep ? [call.nextStep] : nextStepsForCall(call.disposition),
      sentiment: call.disposition === "Interested" || call.disposition === "Meeting booked" ? "Positive" : call.disposition === "Not interested" ? "Negative" : "Neutral",
      objections: objectionsForCall(call.transcript ?? call.callSummary ?? call.disposition),
      topics: topicsForRecord(`${call.transcript ?? ""} ${call.callSummary ?? ""} ${company?.industry ?? ""} ${contact?.segment ?? ""}`),
      confidence: call.transcript || call.callSummary ? 88 : 70,
      status: "Generated",
      generatedAt: new Date().toISOString()
    };

    state.aiCallSummaries.unshift(summary);
    created += 1;
  }

  return recordAutomationRun(state, {
    workspaceId,
    automationType: "Call summaries",
    status: "Completed",
    recordsAnalyzed: calls.length,
    recordsCreated: created,
    summary: `Generated ${created} AI call summar${created === 1 ? "y" : "ies"} with next steps.`,
    runById: actorUserId
  });
}

export function generateAiLeadScores(state: AppState, workspaceId: string, actorUserId: string, seeded = false) {
  const contacts = state.contacts
    .filter((contact) => contact.workspaceId === workspaceId && !contact.isSuppressed)
    .sort((a, b) => b.score - a.score)
    .slice(0, seeded ? 14 : 30);
  let created = 0;

  for (const contact of contacts) {
    const latest = latestLeadPrediction(state, contact.id);
    if (latest && Date.now() - Date.parse(latest.generatedAt) < 60 * 60 * 1000) {
      continue;
    }

    const company = state.companies.find((item) => item.id === contact.companyId);
    const reply = state.aiReplyClassifications.find((item) => item.contactId === contact.id && item.intent === "Positive");
    const opportunity = state.opportunities.find((item) => item.contactId === contact.id || item.companyId === contact.companyId);
    const score = predictedScore(contact, Boolean(reply), opportunity);
    const prediction: AiLeadScorePrediction = {
      id: `ai-score-${randomUUID()}`,
      workspaceId,
      contactId: contact.id,
      companyId: contact.companyId,
      provider: "Syncore AI Local",
      modelVersion: "local-v1",
      score,
      conversionProbability: clamp(Math.round(score * 0.72 + (opportunity ? 18 : 0)), 5, 95),
      priority: priorityForScore(score),
      factors: scoreFactors(contact, company?.industry, Boolean(reply), opportunity),
      risks: scoreRisks(contact),
      recommendedAction: recommendedLeadAction(score, contact, Boolean(reply)),
      status: "Generated",
      generatedAt: new Date().toISOString()
    };

    state.aiLeadScorePredictions.unshift(prediction);
    created += 1;
  }

  return recordAutomationRun(state, {
    workspaceId,
    automationType: "Lead scoring",
    status: "Completed",
    recordsAnalyzed: contacts.length,
    recordsCreated: created,
    summary: `Generated ${created} predictive lead score${created === 1 ? "" : "s"} from CRM and outreach signals.`,
    runById: actorUserId
  });
}

export function generateAiIcpRecommendations(state: AppState, workspaceId: string, actorUserId: string, seeded = false) {
  const existing = state.aiIcpRecommendations.some(
    (record) => record.workspaceId === workspaceId && record.name === "Closed-won lookalike ICP"
  );

  if (existing) {
    return recordAutomationRun(state, {
      workspaceId,
      automationType: "ICP builder",
      status: "Skipped",
      recordsAnalyzed: 0,
      recordsCreated: 0,
      summary: "Closed-won lookalike ICP already exists.",
      runById: actorUserId
    });
  }

  const opportunities = state.opportunities.filter((opportunity) => opportunity.workspaceId === workspaceId);
  const won = opportunities.filter((opportunity) => opportunity.stage === "Closed won");
  const source = won.length ? won : opportunities.sort((a, b) => b.amount - a.amount).slice(0, seeded ? 4 : 8);
  const companies = source
    .map((opportunity) => state.companies.find((company) => company.id === opportunity.companyId))
    .filter((company): company is NonNullable<typeof company> => Boolean(company));
  const contacts = source
    .map((opportunity) => state.contacts.find((contact) => contact.id === opportunity.contactId))
    .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
  const recommendation = icpRecommendationFromSignals({
    workspaceId,
    actorUserId,
    name: "Closed-won lookalike ICP",
    prompt: undefined,
    companies,
    contacts,
    sourceSummary: won.length
      ? `${won.length} closed-won opportunit${won.length === 1 ? "y" : "ies"} analyzed.`
      : `${source.length} highest-value opportunit${source.length === 1 ? "y" : "ies"} analyzed.`
  });

  state.aiIcpRecommendations.unshift(recommendation);

  return recordAutomationRun(state, {
    workspaceId,
    automationType: "ICP builder",
    status: "Completed",
    recordsAnalyzed: source.length,
    recordsCreated: 1,
    summary: "Generated a closed-won lookalike ICP recommendation.",
    runById: actorUserId
  });
}

export function createIcpRecommendationFromPrompt(
  state: AppState,
  workspaceId: string,
  actorUserId: string,
  prompt: string
) {
  const now = new Date().toISOString();
  const parsed = parsePromptForIcp(prompt);
  const recommendation: AiIcpRecommendation = {
    id: `ai-icp-${randomUUID()}`,
    workspaceId,
    name: parsed.name,
    description: parsed.description,
    industries: parsed.industries,
    titles: parsed.titles,
    geographies: parsed.geographies,
    technologies: parsed.technologies,
    segments: parsed.segments,
    sourceSummary: "Generated from admin prompt.",
    fitSignals: parsed.fitSignals,
    confidence: parsed.confidence,
    prompt,
    status: "Generated",
    createdById: actorUserId,
    createdAt: now,
    updatedAt: now
  };

  state.aiIcpRecommendations.unshift(recommendation);
  recordAutomationRun(state, {
    workspaceId,
    automationType: "ICP builder",
    status: "Completed",
    recordsAnalyzed: 1,
    recordsCreated: 1,
    summary: "Generated an ICP recommendation from prompt.",
    runById: actorUserId
  });
  return recommendation;
}

export function generateAiDeliverabilityRecommendations(
  state: AppState,
  workspaceId: string,
  actorUserId: string,
  seeded = false
) {
  const dashboard = reportingDashboardSnapshot(state, workspaceId);
  const alerts = state.deliverabilityAlerts.filter((alert) => alert.workspaceId === workspaceId && alert.status === "Open");
  const providers = state.outreachProviders.filter((provider) => provider.workspaceId === workspaceId);
  let created = 0;

  for (const alert of alerts) {
    const id = `ai-deliverability-${alert.id}`;
    if (state.aiDeliverabilityRecommendations.some((record) => record.id === id)) {
      continue;
    }

    state.aiDeliverabilityRecommendations.unshift({
      id,
      workspaceId,
      providerId: alert.providerId,
      title: alert.trigger,
      severity: alert.severity,
      recommendation: alert.recommendation,
      triggerMetric: `${alert.currentValue}% current vs ${alert.threshold}% threshold`,
      expectedImpact: alert.severity === "Critical" ? "Protect sender reputation and prevent campaign auto-pause." : "Reduce risk before the next send window.",
      status: "Generated",
      createdAt: new Date().toISOString()
    });
    created += 1;
  }

  for (const provider of providers.slice(0, seeded ? 2 : providers.length)) {
    const usage = provider.dailyLimit ? Math.round((provider.sentToday / provider.dailyLimit) * 100) : 0;
    const id = `ai-deliverability-${provider.id}-warmup`;
    if (usage < 65 || state.aiDeliverabilityRecommendations.some((record) => record.id === id)) {
      continue;
    }

    state.aiDeliverabilityRecommendations.unshift({
      id,
      workspaceId,
      providerId: provider.id,
      title: "Mailbox warm-up and throttling",
      severity: usage > 90 ? "Critical" : "Warning",
      recommendation: "Throttle daily sends, rotate warmed mailbox groups, and hold lower-fit campaign segments until usage normalizes.",
      triggerMetric: `${usage}% of daily limit used`,
      expectedImpact: `Reduce bounce and spam-risk exposure across ${dashboard.metrics.openDeliverabilityAlerts} open alert${dashboard.metrics.openDeliverabilityAlerts === 1 ? "" : "s"}.`,
      status: "Generated",
      createdAt: new Date().toISOString()
    });
    created += 1;
  }

  return recordAutomationRun(state, {
    workspaceId,
    automationType: "Deliverability advisor",
    status: "Completed",
    recordsAnalyzed: alerts.length + providers.length,
    recordsCreated: created,
    summary: `Generated ${created} deliverability advisor recommendation${created === 1 ? "" : "s"}.`,
    runById: actorUserId
  });
}

export function generateAiRevenueInsights(state: AppState, workspaceId: string, actorUserId: string, seeded = false) {
  const dashboard = reportingDashboardSnapshot(state, workspaceId);
  const insightInputs = [
    ...dashboard.sourcePerformance.slice(0, seeded ? 3 : 6).map((row) => ({
      dimension: "Source" as const,
      dimensionValue: row.source,
      opportunities: row.opportunities,
      revenue: row.revenue,
      action: row.opportunities > 0 ? "Increase list-building budget and enrichment depth for this source." : "Review source quality before further spend."
    })),
    ...dashboard.campaignPerformance.slice(0, seeded ? 3 : 6).map((row) => ({
      dimension: "Campaign" as const,
      dimensionValue: row.name,
      opportunities: row.opportunities,
      revenue: row.revenueWon,
      action: row.replies > 0 ? "Clone winning sequence copy into the next active segment." : "Refresh personalization and narrow targeting before increasing send volume."
    })),
    ...dashboard.sdrPerformance.slice(0, seeded ? 2 : 5).map((row) => ({
      dimension: "SDR" as const,
      dimensionValue: row.name,
      opportunities: row.opportunities,
      revenue: row.wonRevenue,
      action: row.meetings > 0 ? "Route similar P1 leads to this SDR until capacity reaches SLA threshold." : "Review first-touch quality and SLA compliance."
    }))
  ];
  let created = 0;

  for (const input of insightInputs) {
    const existing = state.aiRevenueInsights.some(
      (insight) => insight.workspaceId === workspaceId && insight.dimension === input.dimension && insight.dimensionValue === input.dimensionValue
    );

    if (existing) {
      continue;
    }

    const insight: AiRevenueInsight = {
      id: `ai-revenue-${randomUUID()}`,
      workspaceId,
      dimension: input.dimension,
      dimensionValue: input.dimensionValue,
      insight: `${input.dimensionValue} has produced ${input.opportunities} opportunit${input.opportunities === 1 ? "y" : "ies"} and ${currency(input.revenue)} won revenue.`,
      recommendedAction: input.action,
      impactAmount: input.revenue || Math.max(0, input.opportunities * 25000),
      confidence: clamp(64 + input.opportunities * 8 + Math.round(input.revenue / 50000), 58, 94),
      status: "Generated",
      createdAt: new Date().toISOString()
    };

    state.aiRevenueInsights.unshift(insight);
    created += 1;
  }

  return recordAutomationRun(state, {
    workspaceId,
    automationType: "Revenue attribution insights",
    status: "Completed",
    recordsAnalyzed: insightInputs.length,
    recordsCreated: created,
    summary: `Generated ${created} revenue attribution insight${created === 1 ? "" : "s"}.`,
    runById: actorUserId
  });
}

export function applyAiLeadScore(state: AppState, workspaceId: string, predictionId: string, actorUserId: string) {
  const prediction = state.aiLeadScorePredictions.find((record) => record.id === predictionId && record.workspaceId === workspaceId);

  if (!prediction) {
    throw new Error("AI lead score prediction not found.");
  }

  const contact = state.contacts.find((record) => record.id === prediction.contactId && record.workspaceId === workspaceId);
  const company = state.companies.find((record) => record.id === prediction.companyId && record.workspaceId === workspaceId);

  if (!contact) {
    throw new Error("Contact not found for AI score application.");
  }

  contact.score = prediction.score;
  contact.priority = prediction.priority;
  contact.fitReason = prediction.recommendedAction;
  contact.updatedAt = new Date().toISOString();

  if (company) {
    company.score = Math.max(company.score, prediction.score);
    company.priority = priorityForScore(Math.max(company.score, prediction.score));
    company.updatedAt = new Date().toISOString();
  }

  prediction.status = "Applied";
  prediction.appliedAt = new Date().toISOString();
  addActivity(state, {
    workspaceId,
    companyId: prediction.companyId,
    contactId: prediction.contactId,
    type: "Status change",
    title: "AI lead score applied",
    body: `${prediction.score} score, ${prediction.priority} priority. ${prediction.recommendedAction}`,
    actorUserId,
    metadata: { aiPredictionId: prediction.id, conversionProbability: prediction.conversionProbability },
    createdAt: prediction.appliedAt
  });

  return prediction;
}

export function applyAiPersonalization(state: AppState, workspaceId: string, personalizationId: string, actorUserId: string) {
  const personalization = state.aiPersonalizations.find(
    (record) => record.id === personalizationId && record.workspaceId === workspaceId
  );

  if (!personalization) {
    throw new Error("AI personalization not found.");
  }

  personalization.status = "Applied";
  personalization.appliedAt = new Date().toISOString();
  addActivity(state, {
    workspaceId,
    companyId: personalization.companyId,
    contactId: personalization.contactId,
    type: "Note",
    title: "AI personalization applied",
    body: `${personalization.firstLine} ${personalization.painPointAngle}`,
    actorUserId,
    metadata: { aiPersonalizationId: personalization.id, recommendedChannel: personalization.recommendedChannel },
    createdAt: personalization.appliedAt
  });

  return personalization;
}

export function applyAiIcpRecommendation(
  state: AppState,
  workspaceId: string,
  recommendationId: string,
  actorUserId: string
) {
  const recommendation = state.aiIcpRecommendations.find(
    (record) => record.id === recommendationId && record.workspaceId === workspaceId
  );

  if (!recommendation) {
    throw new Error("AI ICP recommendation not found.");
  }

  const now = new Date().toISOString();
  const profile: SearchProfile = {
    id: `sp-ai-${randomUUID()}`,
    workspaceId,
    name: recommendation.name,
    targetMarket: recommendation.geographies.join(", ") || "US outbound",
    geographies: recommendation.geographies,
    industries: recommendation.industries,
    titles: recommendation.titles,
    sources: ["Apollo", "Hunter", "Google Places", "CSV Upload"],
    requiredFields: ["company", "contact", "email", "domain", "source"],
    scoringProfile: "AI closed-won lookalike fit",
    segmentRules: recommendation.segments,
    defaultRouting: "AI fit score, territory, then capacity",
    estimatedVolume: Math.max(120, recommendation.confidence * 8),
    complianceNote: "AI-generated ICP requires source label, suppression, and export gates before outreach.",
    createdById: actorUserId,
    createdAt: now,
    updatedAt: now
  };

  state.searchProfiles.unshift(profile);
  recommendation.status = "Applied";
  recommendation.appliedSearchProfileId = profile.id;
  recommendation.updatedAt = now;
  return { recommendation, profile };
}

export function dismissAiRecord(
  state: AppState,
  workspaceId: string,
  recordType: string,
  recordId: string
) {
  const collections: Array<Array<{ id: string; workspaceId: string; status: AiRecordStatus }>> = [
    state.aiPersonalizations,
    state.aiReplyClassifications,
    state.aiCallSummaries,
    state.aiLeadScorePredictions,
    state.aiIcpRecommendations,
    state.aiDeliverabilityRecommendations,
    state.aiRevenueInsights
  ];
  const record = collections.flat().find((item) => item.id === recordId && item.workspaceId === workspaceId);

  if (!record) {
    throw new Error(`${recordType} AI record not found.`);
  }

  record.status = "Dismissed";
  return record;
}

function aiPersonalizationViews(state: AppState, workspaceId: string) {
  return state.aiPersonalizations
    .filter((record) => record.workspaceId === workspaceId)
    .map((record) => {
      const contact = state.contacts.find((item) => item.id === record.contactId);
      const company = state.companies.find((item) => item.id === record.companyId);
      const campaign = state.outreachCampaigns.find((item) => item.id === record.campaignId);
      return {
        ...record,
        contactName: contact?.name ?? "Unknown contact",
        contactTitle: contact?.title ?? "",
        companyName: company?.name ?? "Unknown account",
        campaignName: campaign?.name ?? "No campaign"
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function aiReplyClassificationViews(state: AppState, workspaceId: string) {
  return state.aiReplyClassifications
    .filter((record) => record.workspaceId === workspaceId)
    .map((record) => ({
      ...record,
      contactName: state.contacts.find((contact) => contact.id === record.contactId)?.name ?? "Unknown contact",
      companyName: state.companies.find((company) => company.id === record.companyId)?.name ?? "Unknown account",
      campaignName: state.outreachCampaigns.find((campaign) => campaign.id === record.campaignId)?.name ?? "No campaign"
    }))
    .sort((a, b) => Date.parse(b.classifiedAt) - Date.parse(a.classifiedAt));
}

function aiCallSummaryViews(state: AppState, workspaceId: string) {
  return state.aiCallSummaries
    .filter((record) => record.workspaceId === workspaceId)
    .map((record) => ({
      ...record,
      contactName: state.contacts.find((contact) => contact.id === record.contactId)?.name ?? "Unknown contact",
      companyName: state.companies.find((company) => company.id === record.companyId)?.name ?? "Unknown account",
      sdrName: userNameForId(
        state,
        state.trackedCalls.find((call) => call.id === record.trackedCallId)?.sdrUserId ?? state.users[0]?.id
      )
    }))
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
}

function aiLeadScoreViews(state: AppState, workspaceId: string) {
  return state.aiLeadScorePredictions
    .filter((record) => record.workspaceId === workspaceId)
    .map((record) => ({
      ...record,
      contactName: state.contacts.find((contact) => contact.id === record.contactId)?.name ?? "Unknown contact",
      companyName: state.companies.find((company) => company.id === record.companyId)?.name ?? "Unknown account"
    }))
    .sort((a, b) => b.score - a.score || Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
}

function recordAutomationRun(
  state: AppState,
  input: {
    workspaceId: string;
    automationType: AiAutomationKind;
    status: AiAutomationRun["status"];
    recordsAnalyzed: number;
    recordsCreated: number;
    summary: string;
    runById: string;
    startedAt?: string;
    completedAt?: string;
  }
) {
  const now = new Date().toISOString();
  const run: AiAutomationRun = {
    id: `ai-run-${randomUUID()}`,
    workspaceId: input.workspaceId,
    automationType: input.automationType,
    status: input.status,
    recordsAnalyzed: input.recordsAnalyzed,
    recordsCreated: input.recordsCreated,
    summary: input.summary,
    runById: input.runById,
    startedAt: input.startedAt ?? now,
    completedAt: input.completedAt ?? now
  };

  state.aiAutomationRuns.unshift(run);
  return run;
}

function icpRecommendationFromSignals(input: {
  workspaceId: string;
  actorUserId: string;
  name: string;
  prompt?: string;
  companies: Array<{ industry: string; city: string; state: string; technologies?: string[]; signals?: string[]; employeeBand?: string }>;
  contacts: Contact[];
  sourceSummary: string;
}) {
  const industries = topValues(input.companies.map((company) => company.industry)).slice(0, 4);
  const titles = topValues(input.contacts.map((contact) => contact.title)).slice(0, 5);
  const geographies = topValues(
    input.companies.map((company) => [company.city, company.state].filter(Boolean).join(", "))
  ).slice(0, 5);
  const technologies = topValues(input.companies.flatMap((company) => company.technologies ?? [])).slice(0, 5);
  const segments = topValues(input.contacts.map((contact) => contact.segment)).slice(0, 5);
  const now = new Date().toISOString();

  return {
    id: `ai-icp-${randomUUID()}`,
    workspaceId: input.workspaceId,
    name: input.name,
    description: `Prioritize ${industries[0] ?? "high-fit"} accounts with proven source quality, verified contacts, and outbound-ready buying signals.`,
    industries: industries.length ? industries : ["Retail", "Automotive", "SaaS"],
    titles: titles.length ? titles : ["Owner", "Founder", "Revenue Operations", "Marketing Director"],
    geographies: geographies.length ? geographies : ["United States"],
    technologies: technologies.length ? technologies : ["Shopify", "Klaviyo", "HubSpot"],
    segments: segments.length ? segments : ["High review dealer", "Klaviyo DTC"],
    sourceSummary: input.sourceSummary,
    fitSignals: [
      "Verified A/B/C-grade contact",
      "CRM opportunity or high-value account match",
      "Enrichment coverage above baseline",
      "Clear suppression and export gates"
    ],
    confidence: clamp(74 + input.companies.length * 4 + input.contacts.length * 2, 68, 94),
    prompt: input.prompt,
    status: "Generated",
    createdById: input.actorUserId,
    createdAt: now,
    updatedAt: now
  } satisfies AiIcpRecommendation;
}

function parsePromptForIcp(prompt: string) {
  const normalized = prompt.toLowerCase();
  const industries = termsFromPrompt(prompt, ["automotive", "dealer", "retail", "ecommerce", "saas", "software", "architecture", "healthcare", "manufacturing"]);
  const titles = termsFromPrompt(prompt, ["owner", "founder", "ceo", "cmo", "marketing", "revops", "sales", "operations", "director"]);
  const geographies = termsFromPrompt(prompt, ["texas", "california", "florida", "new york", "united states", "us", "canada", "uk"]);
  const technologies = termsFromPrompt(prompt, ["shopify", "klaviyo", "hubspot", "salesforce", "woocommerce", "magento", "wordpress"]);
  const segments = splitList(prompt)
    .filter((part) => part.length > 3)
    .slice(0, 4);

  return {
    name: normalized.includes("dealer")
      ? "AI dealer owner ICP"
      : normalized.includes("shopify") || normalized.includes("ecommerce")
        ? "AI ecommerce growth ICP"
        : "AI generated ICP",
    description: `AI-generated search profile from prompt: ${prompt.slice(0, 180)}`,
    industries: industries.length ? industries : ["B2B services", "Software", "Retail"],
    titles: titles.length ? titles : ["Founder", "Owner", "Revenue Operations", "Marketing Director"],
    geographies: geographies.length ? geographies : ["United States"],
    technologies,
    segments: segments.length ? segments : ["AI recommended ICP"],
    fitSignals: [
      "Matches prompt-defined industry",
      "Contains buyer or operator title",
      "Can be verified before outreach",
      "Compatible with Syncore source and suppression gates"
    ],
    confidence: clamp(68 + industries.length * 4 + titles.length * 3 + technologies.length * 3, 60, 92)
  };
}

function campaignForContact(state: AppState, workspaceId: string, contact: Contact) {
  return state.outreachCampaigns.find(
    (campaign) =>
      campaign.workspaceId === workspaceId &&
      (contact.segment.includes(campaign.targetSegment) || campaign.targetSegment.includes(contact.segment))
  ) ?? state.outreachCampaigns.find((campaign) => campaign.workspaceId === workspaceId && campaign.status === "Active");
}

function recommendedChannelForContact(state: AppState, contact: Contact): OutreachChannel {
  const assignment = state.sdrAssignments.find((record) => record.contactId === contact.id);
  const reminder = assignment ? state.followUpReminders.find((record) => record.assignmentId === assignment.id) : undefined;

  if (reminder?.channel) {
    return reminder.channel;
  }

  if (contact.phone && contact.priority === "P1") {
    return "Call";
  }

  if (contact.email && contact.grade === "A") {
    return "Email";
  }

  if (contact.phone) {
    return "SMS";
  }

  return "LinkedIn";
}

function painPointForContact(contact: Contact, industry?: string) {
  if (contact.segment.toLowerCase().includes("klaviyo") || (industry ?? "").toLowerCase().includes("retail")) {
    return "Frame list quality around higher-intent ecommerce accounts and cleaner lifecycle outreach.";
  }

  if (contact.segment.toLowerCase().includes("dealer") || (industry ?? "").toLowerCase().includes("automotive")) {
    return "Frame Syncore around verified local-market owners and fewer wasted outbound touches.";
  }

  if (contact.priority === "P1") {
    return "Lead with speed-to-contact and a concise path from verified data to booked meetings.";
  }

  return "Focus on reducing manual research while keeping export and compliance gates intact.";
}

function offerForContact(contact: Contact, industry?: string) {
  if ((industry ?? "").toLowerCase().includes("automotive")) {
    return "Dealer owner list-quality audit";
  }

  if (contact.segment.toLowerCase().includes("klaviyo")) {
    return "Ecommerce signal-fit sample list";
  }

  if (contact.score >= 80) {
    return "High-fit outbound readiness review";
  }

  return "Verified lead source quality snapshot";
}

function intentForEmailEvent(eventType: string, text: string): AiReplyIntent {
  if (eventType === "Unsubscribed" || eventType === "Spam complaint") {
    return "Unsubscribe";
  }

  return intentFromText(text);
}

function intentFromText(text: string): AiReplyIntent {
  const normalized = text.toLowerCase();
  if (["unsubscribe", "stop", "remove me", "opt out"].some((token) => normalized.includes(token))) return "Unsubscribe";
  if (["ooo", "out of office", "vacation", "back on"].some((token) => normalized.includes(token))) return "OOO";
  if (["not interested", "no thanks", "wrong person"].some((token) => normalized.includes(token))) return "Negative";
  if (["price", "budget", "timing", "already", "objection", "concern"].some((token) => normalized.includes(token))) return "Objection";
  if (["interested", "send", "book", "meeting", "worth", "yes"].some((token) => normalized.includes(token))) return "Positive";
  return "Neutral";
}

function sentimentForIntent(intent: AiReplyIntent) {
  if (intent === "Positive") return "Positive";
  if (intent === "Negative" || intent === "Unsubscribe") return "Negative";
  return "Neutral";
}

function confidenceForIntent(intent: AiReplyIntent) {
  if (intent === "Unsubscribe") return 96;
  if (intent === "Positive") return 88;
  if (intent === "OOO") return 84;
  if (intent === "Objection") return 78;
  if (intent === "Negative") return 86;
  return 68;
}

function replySummary(intent: AiReplyIntent, text: string) {
  if (intent === "Positive") return "Reply appears positive or meeting-oriented; prioritize fast SDR follow-up.";
  if (intent === "Unsubscribe") return "Reply indicates unsubscribe or opt-out intent; suppression workflow should remain enforced.";
  if (intent === "OOO") return "Reply appears out-of-office; snooze and retry after return window.";
  if (intent === "Objection") return "Reply contains an objection or concern; respond with a concise proof point.";
  if (intent === "Negative") return "Reply appears negative; avoid additional outbound unless a clear manual reason exists.";
  return `Reply does not contain strong intent signals. Review context: ${text.slice(0, 80)}`;
}

function recommendedReplyAction(intent: AiReplyIntent) {
  if (intent === "Positive") return "Create meeting task and move assignment to Interested.";
  if (intent === "Unsubscribe") return "Confirm suppression and stop campaign sequence.";
  if (intent === "OOO") return "Snooze follow-up for three business days after return.";
  if (intent === "Objection") return "Send targeted response with one proof point and a low-friction question.";
  if (intent === "Negative") return "Mark disqualified or nurture only if manager approves.";
  return "Ask SDR to review manually before the next sequence step.";
}

function predictedScore(contact: Contact, positiveReply: boolean, opportunity?: Opportunity) {
  const gradeBoost = contact.grade === "A" ? 11 : contact.grade === "B" ? 7 : contact.grade === "C" ? 3 : -8;
  const enrichmentBoost = Math.round((contact.enrichmentCoverage ?? 0) / 8);
  const engagementBoost = positiveReply ? 14 : ["Interested", "Meeting Booked", "Qualified"].includes(contact.status) ? 10 : 0;
  const opportunityBoost = opportunity ? Math.round(opportunity.probability / 8) : 0;
  return clamp(Math.round(contact.score * 0.72 + gradeBoost + enrichmentBoost + engagementBoost + opportunityBoost), 5, 100);
}

function priorityForScore(score: number): Priority {
  if (score >= 82) return "P1";
  if (score >= 68) return "P2";
  if (score >= 50) return "P3";
  return "P4";
}

function scoreFactors(contact: Contact, industry?: string, positiveReply = false, opportunity?: Opportunity) {
  const factors = [
    `${contact.grade}-grade verification`,
    `${contact.score} current deterministic score`,
    `${contact.enrichmentCoverage ?? 0}% enrichment coverage`,
    `${contact.segment} segment fit`
  ];

  if (industry) factors.push(`${industry} industry match`);
  if (positiveReply) factors.push("Positive reply signal");
  if (opportunity) factors.push(`${opportunity.stage} opportunity context`);
  return factors;
}

function scoreRisks(contact: Contact) {
  const risks: string[] = [];
  if (!contact.phone) risks.push("No phone number for multichannel follow-up");
  if (contact.grade === "C") risks.push("Risky email grade requires cautious sequence placement");
  if ((contact.enrichmentCoverage ?? 0) < 50) risks.push("Enrichment coverage below ideal threshold");
  if (!risks.length) risks.push("No major AI risk flags detected");
  return risks;
}

function recommendedLeadAction(score: number, contact: Contact, positiveReply: boolean) {
  if (positiveReply) return "Prioritize meeting booking and create opportunity if budget/timing is confirmed.";
  if (score >= 82 && contact.phone) return "Route as P1 and start with call plus personalized email.";
  if (score >= 68) return "Add to active campaign with AI personalization and two-step follow-up.";
  if (score >= 50) return "Keep in nurture until enrichment or intent improves.";
  return "Hold from outreach until data quality improves.";
}

function latestLeadPrediction(state: AppState, contactId: string) {
  return state.aiLeadScorePredictions
    .filter((prediction) => prediction.contactId === contactId)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
}

function nextStepsForCall(disposition: string) {
  if (disposition === "Interested" || disposition === "Meeting booked") {
    return ["Send recap email", "Create discovery task", "Attach opportunity context"];
  }

  if (disposition === "Left voicemail") {
    return ["Send short follow-up email", "Retry call in two business days"];
  }

  if (disposition === "Bad number") {
    return ["Mark phone invalid", "Run enrichment for updated direct dial"];
  }

  return ["Review call notes", "Schedule next best follow-up"];
}

function objectionsForCall(text: string) {
  const normalized = text.toLowerCase();
  const objections: string[] = [];
  if (normalized.includes("price") || normalized.includes("budget")) objections.push("Pricing/budget");
  if (normalized.includes("timing") || normalized.includes("later")) objections.push("Timing");
  if (normalized.includes("already") || normalized.includes("vendor")) objections.push("Existing vendor");
  return objections.length ? objections : ["No explicit objection captured"];
}

function topicsForRecord(text: string) {
  const normalized = text.toLowerCase();
  const topics = [
    ["lead source quality", "Lead source quality"],
    ["pricing", "Pricing"],
    ["syncore", "Syncore platform"],
    ["verification", "Verification"],
    ["outbound", "Outbound workflow"],
    ["dealer", "Dealer market"],
    ["shopify", "Shopify ecommerce"]
  ]
    .filter(([token]) => normalized.includes(token))
    .map(([, label]) => label);

  return topics.length ? Array.from(new Set(topics)) : ["Discovery"];
}

function termsFromPrompt(prompt: string, candidates: string[]) {
  const normalized = prompt.toLowerCase();
  return candidates
    .filter((candidate) => normalized.includes(candidate))
    .map((candidate) => candidate.replace(/\b\w/g, (char) => char.toUpperCase()));
}

function topValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

function severityWeight(severity: string) {
  if (severity === "Critical") return 3;
  if (severity === "Warning") return 2;
  return 1;
}

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

function humanizeSegment(segment: string) {
  return segment || "your current growth segment";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

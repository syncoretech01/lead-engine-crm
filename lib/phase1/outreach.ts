import { randomUUID } from "node:crypto";
import {
  defaultPhysicalAddress,
  defaultUnsubscribeUrl,
  enforceSequenceStepCompliance,
  suppressContact
} from "@/lib/phase1/compliance";
import { addActivity, ownerUserIdForName, userNameForId } from "@/lib/phase1/crm";
import { assertWorkspaceMember, requireWorkspaceScopedRecord, workspaceStoragePath } from "@/lib/phase1/tenant-isolation";
import type {
  AppState,
  CallDisposition,
  CampaignSequence,
  CampaignStatus,
  CampaignType,
  EmailEvent,
  EmailEventType,
  OutreachCampaign,
  OutreachChannel,
  OutreachProvider,
  OutreachProviderKind,
  OutreachProviderStatus,
  RecordingConsentStatus,
  SequenceStep,
  SmsEvent,
  SmsEventStatus,
  SuppressionRecord,
  TrackedCall,
  TrackedCallStatus
} from "@/lib/phase1/types";

export const outreachProviderKinds: OutreachProviderKind[] = ["Email", "SMS", "Voice"];
export const outreachProviderStatuses: OutreachProviderStatus[] = ["Connected", "Paused", "Needs review"];
export const campaignTypes: CampaignType[] = ["Email", "SMS", "Call", "Multichannel"];
export const campaignStatuses: CampaignStatus[] = ["Draft", "Active", "Paused", "Completed"];
export const outreachChannels: OutreachChannel[] = ["Email", "Call", "SMS", "LinkedIn", "Meeting"];
export const emailEventTypes: EmailEventType[] = [
  "Sent",
  "Delivered",
  "Opened",
  "Clicked",
  "Replied",
  "Bounced",
  "Unsubscribed",
  "Spam complaint"
];
export const smsEventStatuses: SmsEventStatus[] = ["Sent", "Delivered", "Failed", "Replied", "Opt-out"];
export const trackedCallStatuses: TrackedCallStatus[] = ["Dialed", "Connected", "No answer", "Voicemail", "Busy", "Failed"];
export const callDispositions: CallDisposition[] = [
  "Interested",
  "Not interested",
  "Left voicemail",
  "No answer",
  "Bad number",
  "Meeting booked"
];

export function ensureOutreachDefaults(state: AppState, workspaceId: string) {
  let changed = false;
  const now = new Date().toISOString();

  if (migrateLegacyTelephonyProviderLabels(state, workspaceId)) {
    changed = true;
  }

  if (state.outreachProviders.filter((provider) => provider.workspaceId === workspaceId).length === 0) {
    state.outreachProviders.push(...defaultOutreachProviders(workspaceId, now));
    changed = true;
  }

  if (state.outreachCampaigns.filter((campaign) => campaign.workspaceId === workspaceId).length === 0) {
    state.outreachCampaigns.push(...defaultCampaigns(state, workspaceId, now));
    changed = true;
  }

  if (state.campaignSequences.filter((sequence) => sequence.workspaceId === workspaceId).length === 0) {
    state.campaignSequences.push(...defaultSequences(state, workspaceId, now));
    changed = true;
  }

  if (state.sequenceSteps.filter((step) => step.workspaceId === workspaceId).length === 0) {
    state.sequenceSteps.push(...defaultSequenceSteps(state, workspaceId, now));
    changed = true;
  }

  if (
    state.emailEvents.filter((event) => event.workspaceId === workspaceId).length === 0 &&
    state.outreachCampaigns.length > 0 &&
    state.sdrAssignments.length > 0
  ) {
    seedOutreachEvents(state, workspaceId, now);
    changed = true;
  }

  refreshCampaignMetrics(state, workspaceId);
  return { changed };
}

export function createEmailEvent(
  state: AppState,
  input: {
    workspaceId: string;
    contactId: string;
    campaignId?: string;
    sequenceId?: string;
    sequenceStepId?: string;
    eventType: EmailEventType;
    subject: string;
    bodySnapshot: string;
    actorUserId: string;
    bounceType?: "Hard" | "Soft";
    smtpCode?: string;
    occurredAt?: string;
    messageId?: string;
    provider?: EmailEvent["provider"];
    senderEmail?: string;
    rawPayload?: EmailEvent["rawPayload"];
  }
) {
  const contact = state.contacts.find((item) => item.id === input.contactId && item.workspaceId === input.workspaceId);

  if (!contact) {
    throw new Error("Contact not found.");
  }
  assertOutreachRelationScope(state, input.workspaceId, input);
  assertWorkspaceMember(state, input.workspaceId, input.actorUserId);

  const now = input.occurredAt ?? new Date().toISOString();
  const provider = emailProvider(state, input.workspaceId);
  const event: EmailEvent = {
    id: `email-${randomUUID()}`,
    workspaceId: input.workspaceId,
    contactId: contact.id,
    companyId: contact.companyId,
    campaignId: input.campaignId,
    sequenceId: input.sequenceId,
    sequenceStepId: input.sequenceStepId,
    messageId: input.messageId ?? `msg-${randomUUID()}`,
    provider: input.provider ?? "Syncore Mail Local",
    senderEmail: input.senderEmail ?? provider?.senderEmail ?? "outbound@syncore.tech",
    recipientEmail: contact.email,
    eventType: input.eventType,
    subject: input.subject,
    bodySnapshot: input.bodySnapshot,
    sentAt: input.eventType === "Sent" ? now : undefined,
    deliveredAt: input.eventType === "Delivered" ? now : undefined,
    openedAt: input.eventType === "Opened" ? now : undefined,
    clickedAt: input.eventType === "Clicked" ? now : undefined,
    repliedAt: input.eventType === "Replied" ? now : undefined,
    bouncedAt: input.eventType === "Bounced" ? now : undefined,
    unsubscribeAt: input.eventType === "Unsubscribed" ? now : undefined,
    bounceType: input.bounceType,
    smtpCode: input.smtpCode,
    rawPayload: input.rawPayload ?? {
      local: true,
      eventType: input.eventType,
      messageId: "generated"
    }
  };

  state.emailEvents.unshift(event);
  applyEmailEventSideEffects(state, event, input.actorUserId);
  refreshCampaignMetrics(state, input.workspaceId);
  return event;
}

export function createSmsEvent(
  state: AppState,
  input: {
    workspaceId: string;
    contactId: string;
    campaignId?: string;
    sequenceId?: string;
    sequenceStepId?: string;
    sdrUserId: string;
    direction: "Outbound" | "Inbound";
    body: string;
    status: SmsEventStatus;
    occurredAt?: string;
    rawPayload?: SmsEvent["rawPayload"];
  }
) {
  const contact = state.contacts.find((item) => item.id === input.contactId && item.workspaceId === input.workspaceId);

  if (!contact) {
    throw new Error("Contact not found.");
  }
  assertOutreachRelationScope(state, input.workspaceId, input);
  assertWorkspaceMember(state, input.workspaceId, input.sdrUserId);

  const now = input.occurredAt ?? new Date().toISOString();
  const provider = phoneProvider(state, input.workspaceId);
  const event: SmsEvent = {
    id: `sms-${randomUUID()}`,
    workspaceId: input.workspaceId,
    contactId: contact.id,
    companyId: contact.companyId,
    campaignId: input.campaignId,
    sequenceId: input.sequenceId,
    sequenceStepId: input.sequenceStepId,
    sdrUserId: input.sdrUserId,
    provider: "RingCentral Local",
    fromNumber: provider?.fromNumber ?? "+1 555 010 9000",
    toNumber: contact.phone,
    direction: input.direction,
    body: input.body,
    status: input.status,
    deliveredAt: input.status === "Delivered" ? now : undefined,
    repliedAt: input.status === "Replied" || input.status === "Opt-out" ? now : undefined,
    failedAt: input.status === "Failed" ? now : undefined,
    optOutFlag: input.status === "Opt-out",
    rawPayload: input.rawPayload ?? { local: true, status: input.status },
    createdAt: now
  };

  state.smsEvents.unshift(event);

  if (event.optOutFlag) {
    applyHardSuppression(state, {
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      type: "SMS opt-out",
      phone: event.toNumber,
      reason: "SMS STOP/opt-out event",
      source: "RingCentral Local"
    });
  }

  addActivity(state, {
    workspaceId: event.workspaceId,
    companyId: event.companyId,
    contactId: event.contactId,
    type: "SMS",
    title: `SMS ${event.status.toLowerCase()}`,
    body: event.body,
    actorUserId: input.sdrUserId,
    metadata: { smsEventId: event.id, status: event.status },
    createdAt: now
  });

  refreshCampaignMetrics(state, input.workspaceId);
  return event;
}

export function createTrackedCall(
  state: AppState,
  input: {
    workspaceId: string;
    contactId: string;
    sdrUserId: string;
    direction: "Outbound" | "Inbound";
    callStatus: TrackedCallStatus;
    disposition: CallDisposition;
    durationSeconds: number;
    recordingConsent?: RecordingConsentStatus;
    recordingConsentSource?: string;
    recordingUrl?: string;
    transcript?: string;
    callSummary?: string;
    nextStep?: string;
  }
) {
  const contact = state.contacts.find((item) => item.id === input.contactId && item.workspaceId === input.workspaceId);

  if (!contact) {
    throw new Error("Contact not found.");
  }
  assertWorkspaceMember(state, input.workspaceId, input.sdrUserId);

  const now = new Date().toISOString();
  const recordingRequested = Boolean(input.recordingUrl || input.transcript);
  const recordingConsent = recordingRequested ? input.recordingConsent ?? "Unknown" : "Not recorded";
  const canStoreRecording = recordingConsent === "Granted";
  const call: TrackedCall = {
    id: `tracked-call-${randomUUID()}`,
    workspaceId: input.workspaceId,
    contactId: contact.id,
    companyId: contact.companyId,
    sdrUserId: input.sdrUserId,
    phoneNumber: contact.phone,
    direction: input.direction,
    callStatus: input.callStatus,
    disposition: input.disposition,
    durationSeconds: input.durationSeconds,
    recordingConsent,
    recordingConsentSource: input.recordingConsentSource ?? (recordingConsent === "Not recorded" ? "No recording captured" : "Manual disclosure"),
    recordingConsentCapturedAt: recordingRequested ? now : undefined,
    recordingUrl: canStoreRecording ? input.recordingUrl : undefined,
    recordingStoragePath: canStoreRecording && input.recordingUrl
      ? workspaceStoragePath(input.workspaceId, "recordings", contact.id, `${Date.now()}.mp3`)
      : undefined,
    transcript: canStoreRecording ? input.transcript : undefined,
    callSummary: input.callSummary,
    nextStep: input.nextStep,
    createdAt: now
  };

  state.trackedCalls.unshift(call);
  addActivity(state, {
    workspaceId: call.workspaceId,
    companyId: call.companyId,
    contactId: call.contactId,
    type: "Call",
    title: `RingCentral call ${call.callStatus.toLowerCase()}`,
    body: call.callSummary ?? call.nextStep,
    actorUserId: input.sdrUserId,
    metadata: {
      callId: call.id,
      disposition: call.disposition,
      durationSeconds: call.durationSeconds,
      recording: Boolean(call.recordingUrl)
    },
    createdAt: now
  });

  return call;
}

export function simulateCampaignSend(state: AppState, workspaceId: string, campaignId: string, actorUserId: string) {
  const campaign = state.outreachCampaigns.find((item) => item.id === campaignId && item.workspaceId === workspaceId);

  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const sequence = state.campaignSequences.find((item) => item.campaignId === campaign.id);
  const firstStep = sequence
    ? state.sequenceSteps.find((step) => step.sequenceId === sequence.id && step.stepNumber === 1)
    : undefined;
  const candidates = campaignContacts(state, campaign).slice(0, 5);
  let created = 0;

  for (const contact of candidates) {
    if (contact.isSuppressed || !contact.email || contact.grade === "S" || contact.grade === "D") {
      continue;
    }

    createEmailEvent(state, {
      workspaceId,
      contactId: contact.id,
      campaignId: campaign.id,
      sequenceId: sequence?.id,
      sequenceStepId: firstStep?.id,
      eventType: "Sent",
      subject: firstStep?.subject ?? `${campaign.name} intro`,
      bodySnapshot: personalize(firstStep?.bodyTemplate ?? "Hi {{first_name}}, quick question about {{company}}.", contact.name, companyName(state, contact.companyId)),
      actorUserId
    });
    createEmailEvent(state, {
      workspaceId,
      contactId: contact.id,
      campaignId: campaign.id,
      sequenceId: sequence?.id,
      sequenceStepId: firstStep?.id,
      eventType: "Delivered",
      subject: firstStep?.subject ?? `${campaign.name} intro`,
      bodySnapshot: "Delivered by local provider simulator.",
      actorUserId
    });
    created += 2;
  }

  campaign.status = "Active";
  campaign.updatedAt = new Date().toISOString();
  refreshCampaignMetrics(state, workspaceId);
  return { eventsCreated: created };
}

export function createCampaign(input: {
  workspaceId: string;
  name: string;
  campaignType: CampaignType;
  targetSegment: string;
  ownerUserId: string;
  sendingDomain: string;
  mailboxGroup: string;
  status: CampaignStatus;
  sourceJobIds: string[];
}) {
  const now = new Date().toISOString();

  return {
    id: `campaign-${randomUUID()}`,
    workspaceId: input.workspaceId,
    name: input.name,
    campaignType: input.campaignType,
    targetSegment: input.targetSegment,
    sourceJobIds: input.sourceJobIds,
    ownerUserId: input.ownerUserId,
    sendingDomain: input.sendingDomain,
    mailboxGroup: input.mailboxGroup,
    status: input.status,
    startDate: now.slice(0, 10),
    totalLeads: 0,
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    replyCount: 0,
    bounceCount: 0,
    unsubscribeCount: 0,
    meetingsBooked: 0,
    opportunitiesCreated: 0,
    revenueWon: 0,
    createdAt: now,
    updatedAt: now
  } satisfies OutreachCampaign;
}

export function createSequence(input: {
  workspaceId: string;
  campaignId: string;
  name: string;
  targetSegment: string;
  createdById: string;
}) {
  const now = new Date().toISOString();

  return {
    id: `sequence-${randomUUID()}`,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    name: input.name,
    targetSegment: input.targetSegment,
    defaultDelayRules: "Step 1 immediate, step 2 after 2 business days, step 3 after 5 business days.",
    stopOnReply: true,
    stopOnBounce: true,
    stopOnUnsubscribe: true,
    createdById: input.createdById,
    status: "Active",
    createdAt: now,
    updatedAt: now
  } satisfies CampaignSequence;
}

export function createSequenceStep(input: {
  workspaceId: string;
  sequenceId: string;
  stepNumber: number;
  channel: OutreachChannel;
  delayDays: number;
  subject?: string;
  bodyTemplate?: string;
  callScript?: string;
  smsTemplate?: string;
  manualTaskInstruction?: string;
  personalizationVariables: string[];
  requiredFields: string[];
  physicalAddress?: string;
}) {
  const now = new Date().toISOString();

  return enforceSequenceStepCompliance({
    id: `step-${randomUUID()}`,
    workspaceId: input.workspaceId,
    sequenceId: input.sequenceId,
    stepNumber: input.stepNumber,
    channel: input.channel,
    delayDays: input.delayDays,
    subject: input.subject,
    bodyTemplate: input.bodyTemplate,
    callScript: input.callScript,
    smsTemplate: input.smsTemplate,
    manualTaskInstruction: input.manualTaskInstruction,
    personalizationVariables: input.personalizationVariables,
    requiredFields: input.requiredFields,
    physicalAddress: input.physicalAddress,
    active: true,
    createdAt: now,
    updatedAt: now
  } satisfies Omit<SequenceStep, "unsubscribeFooterRequired" | "complianceStatus">);
}

export function campaignViews(state: AppState, workspaceId: string) {
  refreshCampaignMetrics(state, workspaceId);
  return state.outreachCampaigns
    .filter((campaign) => campaign.workspaceId === workspaceId)
    .map((campaign) => ({
      ...campaign,
      ownerName: userNameForId(state, campaign.ownerUserId),
      sequenceCount: state.campaignSequences.filter((sequence) => sequence.campaignId === campaign.id).length,
      eventCount: state.emailEvents.filter((event) => event.campaignId === campaign.id).length +
        state.smsEvents.filter((event) => event.campaignId === campaign.id).length,
      replyRate: campaign.sentCount ? Math.round((campaign.replyCount / campaign.sentCount) * 100) : 0,
      bounceRate: campaign.sentCount ? Math.round((campaign.bounceCount / campaign.sentCount) * 100) : 0,
      unsubscribeRate: campaign.sentCount ? Math.round((campaign.unsubscribeCount / campaign.sentCount) * 100) : 0
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function outreachDashboardSnapshot(state: AppState, workspaceId: string) {
  refreshCampaignMetrics(state, workspaceId);
  const campaigns = campaignViews(state, workspaceId);
  const emailEvents = state.emailEvents.filter((event) => event.workspaceId === workspaceId);
  const smsEvents = state.smsEvents.filter((event) => event.workspaceId === workspaceId);
  const calls = state.trackedCalls.filter((call) => call.workspaceId === workspaceId);
  const webhookEvents = state.webhookEvents.filter((event) => event.workspaceId === workspaceId);
  const sent = emailEvents.filter((event) => event.eventType === "Sent").length;
  const bounced = emailEvents.filter((event) => event.eventType === "Bounced").length;
  const unsubscribed = emailEvents.filter((event) => event.eventType === "Unsubscribed").length +
    smsEvents.filter((event) => event.optOutFlag).length;

  return {
    metrics: {
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "Active").length,
      sent,
      replyRate: sent ? Math.round((emailEvents.filter((event) => event.eventType === "Replied").length / sent) * 100) : 0,
      bounceRate: sent ? Math.round((bounced / sent) * 100) : 0,
      suppressions: unsubscribed + bounced,
      callsRecorded: calls.filter((call) => call.recordingUrl).length,
      webhooksProcessed: webhookEvents.filter((event) => event.status === "Processed").length,
      webhookDuplicates: webhookEvents.filter((event) => event.status === "Duplicate").length
    },
    campaigns,
    providers: state.outreachProviders.filter((provider) => provider.workspaceId === workspaceId),
    emailEvents: emailEventViews(state, workspaceId),
    smsEvents: smsEventViews(state, workspaceId),
    webhookEvents: webhookEvents.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)),
    calls: trackedCallViews(state, workspaceId)
  };
}

export function emailEventViews(state: AppState, workspaceId: string) {
  return state.emailEvents
    .filter((event) => event.workspaceId === workspaceId)
    .map((event) => {
      const contact = state.contacts.find((item) => item.id === event.contactId && item.workspaceId === workspaceId);
      const campaign = state.outreachCampaigns.find(
        (item) => item.id === event.campaignId && item.workspaceId === workspaceId
      );
      return {
        ...event,
        contactName: contact?.name ?? "Unknown contact",
        companyName: companyName(state, event.companyId, workspaceId),
        campaignName: campaign?.name ?? "No campaign"
      };
    })
    .sort((a, b) => Date.parse(eventTime(b)) - Date.parse(eventTime(a)));
}

export function smsEventViews(state: AppState, workspaceId: string) {
  return state.smsEvents
    .filter((event) => event.workspaceId === workspaceId)
    .map((event) => ({
      ...event,
      contactName: state.contacts.find((contact) => contact.id === event.contactId && contact.workspaceId === workspaceId)?.name ?? "Unknown contact",
      companyName: companyName(state, event.companyId, workspaceId),
      sdrName: userNameForId(state, event.sdrUserId)
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function trackedCallViews(state: AppState, workspaceId: string) {
  return state.trackedCalls
    .filter((call) => call.workspaceId === workspaceId)
    .map((call) => ({
      ...call,
      contactName: state.contacts.find((contact) => contact.id === call.contactId && contact.workspaceId === workspaceId)?.name ?? "Unknown contact",
      companyName: companyName(state, call.companyId, workspaceId),
      sdrName: userNameForId(state, call.sdrUserId)
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function assertOutreachRelationScope(
  state: AppState,
  workspaceId: string,
  input: {
    campaignId?: string;
    sequenceId?: string;
    sequenceStepId?: string;
  }
) {
  if (input.campaignId) {
    requireWorkspaceScopedRecord(
      state.outreachCampaigns.find((campaign) => campaign.id === input.campaignId),
      workspaceId,
      "Outreach campaign"
    );
  }

  if (input.sequenceId) {
    requireWorkspaceScopedRecord(
      state.campaignSequences.find((sequence) => sequence.id === input.sequenceId),
      workspaceId,
      "Outreach sequence"
    );
  }

  if (input.sequenceStepId) {
    requireWorkspaceScopedRecord(
      state.sequenceSteps.find((step) => step.id === input.sequenceStepId),
      workspaceId,
      "Outreach sequence step"
    );
  }
}

function defaultOutreachProviders(workspaceId: string, now: string): OutreachProvider[] {
  return [
    {
      id: "provider-syncore-mail",
      workspaceId,
      kind: "Email",
      provider: "Syncore Mail Local",
      status: "Connected",
      sendingDomain: "outbound.syncore.tech",
      mailboxGroup: "syncore-sdr",
      senderEmail: "outbound@syncore.tech",
      dailyLimit: 450,
      sentToday: 0,
      bounceRate: 0,
      complaintRate: 0,
      unsubscribeRate: 0,
      warmupStage: "Production warmup",
      spf: true,
      dkim: true,
      dmarc: true,
      tls: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "provider-ringcentral-sms",
      workspaceId,
      kind: "SMS",
      provider: "RingCentral Local",
      status: "Connected",
      fromNumber: "+1 555 010 9000",
      dailyLimit: 300,
      sentToday: 0,
      bounceRate: 0,
      complaintRate: 0,
      unsubscribeRate: 0,
      warmupStage: "Verified toll-free sender",
      spf: false,
      dkim: false,
      dmarc: false,
      tls: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "provider-ringcentral-voice",
      workspaceId,
      kind: "Voice",
      provider: "RingCentral Local",
      status: "Connected",
      fromNumber: "+1 555 010 9000",
      dailyLimit: 250,
      sentToday: 0,
      bounceRate: 0,
      complaintRate: 0,
      unsubscribeRate: 0,
      warmupStage: "Call recording enabled",
      spf: false,
      dkim: false,
      dmarc: false,
      tls: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function defaultCampaigns(state: AppState, workspaceId: string, now: string): OutreachCampaign[] {
  const ownerUserId = ownerUserIdForName(state, "Nora West");
  return [
    {
      id: "campaign-texas-dealer-first-touch",
      workspaceId,
      name: "Texas dealer first touch",
      campaignType: "Multichannel",
      targetSegment: "High review dealer",
      sourceJobIds: ["job-1042"],
      ownerUserId,
      sendingDomain: "outbound.syncore.tech",
      mailboxGroup: "syncore-sdr",
      status: "Active",
      startDate: now.slice(0, 10),
      totalLeads: 0,
      sentCount: 0,
      openCount: 0,
      clickCount: 0,
      replyCount: 0,
      bounceCount: 0,
      unsubscribeCount: 0,
      meetingsBooked: 0,
      opportunitiesCreated: 0,
      revenueWon: 0,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "campaign-shopify-klaviyo-follow-up",
      workspaceId,
      name: "Shopify Klaviyo follow-up",
      campaignType: "Email",
      targetSegment: "Klaviyo DTC",
      sourceJobIds: ["job-1038"],
      ownerUserId,
      sendingDomain: "outbound.syncore.tech",
      mailboxGroup: "syncore-sdr",
      status: "Active",
      startDate: now.slice(0, 10),
      totalLeads: 0,
      sentCount: 0,
      openCount: 0,
      clickCount: 0,
      replyCount: 0,
      bounceCount: 0,
      unsubscribeCount: 0,
      meetingsBooked: 0,
      opportunitiesCreated: 0,
      revenueWon: 0,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function defaultSequences(state: AppState, workspaceId: string, now: string): CampaignSequence[] {
  return state.outreachCampaigns
    .filter((campaign) => campaign.workspaceId === workspaceId)
    .map((campaign) => ({
      id: `sequence-${campaign.id}`,
      workspaceId,
      campaignId: campaign.id,
      name: `${campaign.name} sequence`,
      targetSegment: campaign.targetSegment,
      defaultDelayRules: "Email day 0, call day 2, SMS day 5 where phone is present.",
      stopOnReply: true,
      stopOnBounce: true,
      stopOnUnsubscribe: true,
      createdById: campaign.ownerUserId,
      status: "Active",
      createdAt: now,
      updatedAt: now
    }));
}

function defaultSequenceSteps(state: AppState, workspaceId: string, now: string): SequenceStep[] {
  const steps: SequenceStep[] = [];
  for (const sequence of state.campaignSequences.filter((item) => item.workspaceId === workspaceId)) {
    steps.push(
      enforceSequenceStepCompliance({
        id: `step-${sequence.id}-1`,
        workspaceId,
        sequenceId: sequence.id,
        stepNumber: 1,
        channel: "Email",
        delayDays: 0,
        subject: "{{company}} growth list quality",
        bodyTemplate: "Hi {{first_name}}, Syncore found a few signals at {{company}} that may make outbound quality worth a look.",
        personalizationVariables: ["first_name", "company", "segment"],
        requiredFields: ["email", "company"],
        physicalAddress: defaultPhysicalAddress,
        active: true,
        createdAt: now,
        updatedAt: now
      }),
      enforceSequenceStepCompliance({
        id: `step-${sequence.id}-2`,
        workspaceId,
        sequenceId: sequence.id,
        stepNumber: 2,
        channel: "Call",
        delayDays: 2,
        callScript: "Reference the source signal, confirm the business priority, and ask for the right owner if misrouted.",
        personalizationVariables: ["company", "source_signal"],
        requiredFields: ["phone"],
        active: true,
        createdAt: now,
        updatedAt: now
      }),
      enforceSequenceStepCompliance({
        id: `step-${sequence.id}-3`,
        workspaceId,
        sequenceId: sequence.id,
        stepNumber: 3,
        channel: "SMS",
        delayDays: 5,
        smsTemplate: "Quick Syncore note for {{company}} - worth a short follow-up this week?",
        personalizationVariables: ["company"],
        requiredFields: ["phone"],
        active: true,
        createdAt: now,
        updatedAt: now
      })
    );
  }
  return steps;
}

function seedOutreachEvents(state: AppState, workspaceId: string, now: string) {
  const campaigns = state.outreachCampaigns.filter((campaign) => campaign.workspaceId === workspaceId);
  const contacts = state.sdrAssignments
    .filter((assignment) => assignment.workspaceId === workspaceId)
    .map((assignment) => state.contacts.find(
      (contact) => contact.id === assignment.contactId && contact.workspaceId === workspaceId
    ))
    .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
  const actorUserId = ownerUserIdForName(state, "Nora West");

  for (const [index, contact] of contacts.slice(0, 5).entries()) {
    const campaign = campaigns.find((item) => contact.segment.includes(item.targetSegment)) ?? campaigns[index % campaigns.length];
    const sequence = state.campaignSequences.find((item) => item.campaignId === campaign?.id);
    const step = state.sequenceSteps.find((item) => item.sequenceId === sequence?.id && item.stepNumber === 1);

    if (!campaign || !sequence || !step || !contact.email || contact.grade === "S") {
      continue;
    }

    createEmailEvent(state, {
      workspaceId,
      contactId: contact.id,
      campaignId: campaign.id,
      sequenceId: sequence.id,
      sequenceStepId: step.id,
      eventType: "Sent",
      subject: step.subject ?? "Syncore intro",
      bodySnapshot: personalize(step.bodyTemplate ?? "Hi {{first_name}}", contact.name, companyName(state, contact.companyId)),
      actorUserId,
      occurredAt: offsetHours(now, -(12 - index))
    });

    createEmailEvent(state, {
      workspaceId,
      contactId: contact.id,
      campaignId: campaign.id,
      sequenceId: sequence.id,
      sequenceStepId: step.id,
      eventType: index === 3 ? "Bounced" : index === 4 ? "Replied" : "Opened",
      subject: step.subject ?? "Syncore intro",
      bodySnapshot: index === 3 ? "Hard bounce webhook from local provider." : "Engagement webhook from local provider.",
      actorUserId,
      bounceType: index === 3 ? "Hard" : undefined,
      smtpCode: index === 3 ? "550" : undefined,
      occurredAt: offsetHours(now, -(8 - index))
    });
  }

  const smsContact = contacts.find((contact) => contact.phone && !contact.isSuppressed);
  if (smsContact) {
    createSmsEvent(state, {
      workspaceId,
      contactId: smsContact.id,
      sdrUserId: ownerUserIdForName(state, smsContact.owner),
      direction: "Outbound",
      body: "Quick Syncore follow-up - is this worth a short look?",
      status: "Delivered",
      occurredAt: offsetHours(now, -4)
    });
  }

  const callContact = contacts.find((contact) => contact.phone && !contact.isSuppressed);
  if (callContact) {
    createTrackedCall(state, {
      workspaceId,
      contactId: callContact.id,
      sdrUserId: ownerUserIdForName(state, callContact.owner),
      direction: "Outbound",
      callStatus: "Connected",
      disposition: "Interested",
      durationSeconds: 384,
      recordingConsent: "Granted",
      recordingConsentSource: "Demo call disclosure",
      recordingUrl: "https://recordings.syncore.local/demo-call.mp3",
      transcript: "SDR introduced Syncore and confirmed the account wants better lead source quality.",
      callSummary: "Connected call confirmed interest and pricing follow-up.",
      nextStep: "Send ROI one-pager and book discovery."
    });
  }
}

function applyEmailEventSideEffects(state: AppState, event: EmailEvent, actorUserId: string) {
  const contact = state.contacts.find((item) => item.id === event.contactId && item.workspaceId === event.workspaceId);
  const statusByEvent: Partial<Record<EmailEventType, string>> = {
    Opened: "Opened",
    Replied: "Replied",
    Clicked: "Interested",
    Unsubscribed: "Unsubscribed",
    "Spam complaint": "Suppressed",
    Bounced: event.bounceType === "Hard" ? "Invalid" : "Contacted"
  };

  if (contact && statusByEvent[event.eventType]) {
    contact.status = statusByEvent[event.eventType] as typeof contact.status;
    contact.updatedAt = eventTime(event);
  }

  const assignment = state.sdrAssignments.find(
    (item) => item.contactId === event.contactId && item.workspaceId === event.workspaceId
  );
  if (assignment && statusByEvent[event.eventType]) {
    assignment.status = statusByEvent[event.eventType] as typeof assignment.status;
    assignment.lastTouchAt = eventTime(event);
    assignment.touchCount += event.eventType === "Sent" ? 1 : 0;
    assignment.updatedAt = eventTime(event);
  }

  if (event.eventType === "Bounced" && event.bounceType === "Hard") {
    applyHardSuppression(state, {
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      type: "Hard bounce",
      email: event.recipientEmail,
      reason: `Hard bounce ${event.smtpCode ?? ""}`.trim(),
      source: event.provider
    });
  }

  if (event.eventType === "Unsubscribed" || event.eventType === "Spam complaint") {
    applyHardSuppression(state, {
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      type: event.eventType === "Spam complaint" ? "Spam complaint" : "Unsubscribe",
      email: event.recipientEmail,
      reason: event.eventType,
      source: event.provider
    });
  }

  addActivity(state, {
    workspaceId: event.workspaceId,
    companyId: event.companyId,
    contactId: event.contactId,
    type: "Email",
    title: `Email ${event.eventType.toLowerCase()}`,
    body: event.subject,
    actorUserId,
    metadata: { emailEventId: event.id, campaignId: event.campaignId, messageId: event.messageId },
    createdAt: eventTime(event)
  });
}

function applyHardSuppression(
  state: AppState,
  input: {
    workspaceId: string;
    contactId: string;
    type: SuppressionRecord["type"];
    email?: string;
    phone?: string;
    reason: string;
    source: string;
  }
) {
  const contact = state.contacts.find((item) => item.id === input.contactId && item.workspaceId === input.workspaceId);
  const exists = state.suppressionRecords.some(
    (record) =>
      record.workspaceId === input.workspaceId &&
      record.type === input.type &&
      ((input.email && record.email === input.email) || (input.phone && record.phone === input.phone))
  );

  if (!exists) {
    state.suppressionRecords.unshift({
      id: `supp-${randomUUID()}`,
      workspaceId: input.workspaceId,
      type: input.type,
      email: input.email,
      phone: input.phone,
      reason: input.reason,
      source: input.source,
      createdAt: new Date().toISOString()
    });
  }

  if (contact) {
    suppressContact(contact, input.reason);
    contact.status = input.type === "Hard bounce" ? "Invalid" : input.type === "SMS opt-out" ? "Unsubscribed" : "Suppressed";
  }

  const assignment = state.sdrAssignments.find(
    (item) => item.contactId === input.contactId && item.workspaceId === input.workspaceId
  );
  if (assignment) {
    assignment.status = input.type === "Hard bounce" ? "Invalid" : "Suppressed";
    assignment.slaStatus = "Paused";
    assignment.updatedAt = new Date().toISOString();
  }

  for (const reminder of state.followUpReminders.filter(
    (item) => item.contactId === input.contactId && item.workspaceId === input.workspaceId && item.status !== "Completed"
  )) {
    reminder.status = "Completed";
    reminder.completedAt = new Date().toISOString();
  }
}

export function refreshCampaignMetrics(state: AppState, workspaceId: string) {
  for (const campaign of state.outreachCampaigns.filter((item) => item.workspaceId === workspaceId)) {
    const emailEvents = state.emailEvents.filter(
      (event) => event.campaignId === campaign.id && event.workspaceId === workspaceId
    );
    const smsEvents = state.smsEvents.filter(
      (event) => event.campaignId === campaign.id && event.workspaceId === workspaceId
    );
    const contacts = campaignContacts(state, campaign);
    campaign.totalLeads = contacts.length;
    campaign.sentCount = emailEvents.filter((event) => event.eventType === "Sent").length +
      smsEvents.filter((event) => event.status === "Sent" || event.status === "Delivered").length;
    campaign.openCount = emailEvents.filter((event) => event.eventType === "Opened").length;
    campaign.clickCount = emailEvents.filter((event) => event.eventType === "Clicked").length;
    campaign.replyCount = emailEvents.filter((event) => event.eventType === "Replied").length +
      smsEvents.filter((event) => event.status === "Replied").length;
    campaign.bounceCount = emailEvents.filter((event) => event.eventType === "Bounced").length;
    campaign.unsubscribeCount = emailEvents.filter((event) => event.eventType === "Unsubscribed" || event.eventType === "Spam complaint").length +
      smsEvents.filter((event) => event.optOutFlag).length;
    campaign.meetingsBooked = state.sdrAssignments.filter(
      (assignment) =>
        assignment.workspaceId === workspaceId &&
        contacts.some((contact) => contact.id === assignment.contactId) &&
        assignment.status === "Meeting Booked"
    ).length;
    campaign.opportunitiesCreated = state.opportunities.filter((opportunity) =>
      opportunity.workspaceId === workspaceId && contacts.some((contact) => contact.id === opportunity.contactId)
    ).length;
    campaign.revenueWon = state.opportunities
      .filter(
        (opportunity) =>
          opportunity.workspaceId === workspaceId &&
          opportunity.stage === "Closed won" &&
          contacts.some((contact) => contact.id === opportunity.contactId)
      )
      .reduce((total, opportunity) => total + opportunity.amount, 0);
    campaign.updatedAt = new Date().toISOString();
  }

  for (const provider of state.outreachProviders.filter((item) => item.workspaceId === workspaceId)) {
    if (provider.kind === "Email") {
      const sent = state.emailEvents.filter((event) => event.workspaceId === workspaceId && event.eventType === "Sent").length;
      provider.sentToday = sent;
      provider.bounceRate = sent
        ? Math.round((state.emailEvents.filter((event) => event.workspaceId === workspaceId && event.eventType === "Bounced").length / sent) * 100)
        : 0;
      provider.unsubscribeRate = sent
        ? Math.round((state.emailEvents.filter((event) => event.workspaceId === workspaceId && event.eventType === "Unsubscribed").length / sent) * 100)
        : 0;
      provider.complaintRate = sent
        ? Math.round((state.emailEvents.filter((event) => event.workspaceId === workspaceId && event.eventType === "Spam complaint").length / sent) * 100)
        : 0;
      provider.status = provider.bounceRate > 3 || provider.complaintRate > 0 ? "Needs review" : "Connected";
    }
    provider.updatedAt = new Date().toISOString();
  }
}

function campaignContacts(state: AppState, campaign: OutreachCampaign) {
  const contacts = state.contacts.filter(
    (contact) =>
      contact.workspaceId === campaign.workspaceId &&
      !contact.isSuppressed &&
      (contact.segment.includes(campaign.targetSegment) ||
        campaign.targetSegment.includes(contact.segment) ||
        contact.sourceLineage.some((source) => campaign.sourceJobIds.some((jobId) => source.includes(jobId))))
  );

  return contacts.length ? contacts : state.contacts.filter((contact) => contact.workspaceId === campaign.workspaceId && !contact.isSuppressed).slice(0, 8);
}

function emailProvider(state: AppState, workspaceId: string) {
  return state.outreachProviders.find((provider) => provider.workspaceId === workspaceId && provider.kind === "Email");
}

function phoneProvider(state: AppState, workspaceId: string) {
  return state.outreachProviders.find((provider) => provider.workspaceId === workspaceId && provider.provider === "RingCentral Local");
}

function migrateLegacyTelephonyProviderLabels(state: AppState, workspaceId: string) {
  let changed = false;

  for (const provider of state.outreachProviders.filter((item) => item.workspaceId === workspaceId)) {
    if ((provider.provider as string) === "Twilio Local") {
      provider.provider = "RingCentral Local";
      provider.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  for (const event of state.smsEvents.filter((item) => item.workspaceId === workspaceId)) {
    if ((event.provider as string) === "Twilio Local") {
      event.provider = "RingCentral Local";
      changed = true;
    }
  }

  for (const event of state.webhookEvents.filter((item) => item.workspaceId === workspaceId)) {
    if ((event.provider as string) === "Twilio Local") {
      event.provider = "RingCentral Local";
      event.idempotencyKey = event.idempotencyKey.replace("Twilio Local:", "RingCentral Local:");
      changed = true;
    }
  }

  for (const record of state.suppressionRecords.filter((item) => item.workspaceId === workspaceId)) {
    if (record.source === "Twilio Local") {
      record.source = "RingCentral Local";
      changed = true;
    }
  }

  return changed;
}

function companyName(state: AppState, companyId: string, workspaceId?: string) {
  return state.companies.find((company) => company.id === companyId && (!workspaceId || company.workspaceId === workspaceId))?.name ?? "Unknown account";
}

function personalize(template: string, contactName: string, company: string) {
  const firstName = contactName.split(" ")[0] ?? contactName;
  return template
    .replaceAll("{{first_name}}", firstName)
    .replaceAll("{{company}}", company)
    .replaceAll("{{segment}}", "target segment")
    .replaceAll("{{unsubscribe_url}}", defaultUnsubscribeUrl.replace("{{contact_id}}", encodeURIComponent(contactName)))
    .replaceAll("{{physical_address}}", defaultPhysicalAddress);
}

function eventTime(event: EmailEvent) {
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

function offsetHours(value: string, hours: number) {
  const date = new Date(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

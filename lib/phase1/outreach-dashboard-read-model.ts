import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  AppState,
  CampaignSequence,
  EmailEvent,
  OutreachCampaign,
  OutreachProvider,
  SequenceStep,
  Session,
  SmsEvent,
  TrackedCall,
  User,
  WebhookEvent
} from "@/lib/phase1/types";
import {
  callDirectionValue,
  callDispositionValue,
  campaignStatusValue,
  campaignTypeValue,
  createFastState,
  emailEventTypeValue,
  consentStatusValue,
  lawfulBasisValue,
  leadGradeValue,
  leadStatusValue,
  optionalIso,
  outreachChannelValue,
  outreachProviderKindValue,
  outreachProviderStatusValue,
  priorityValue,
  recordFromJson,
  recordingConsentValue,
  sequenceComplianceStatusValue,
  sequenceStatusValue,
  smsEventStatusValue,
  stringArray,
  trackedCallStatusValue,
  uniqueUsers,
  userFromPrisma,
  workspaceMemberFromPrisma
} from "@/lib/phase1/fast-read-utils";

export type FastCampaignView = OutreachCampaign & {
  ownerName: string;
  sequenceCount: number;
  eventCount: number;
  replyRate: number;
  bounceRate: number;
  unsubscribeRate: number;
};

export type FastEmailEventView = EmailEvent & {
  contactName: string;
  companyName: string;
  campaignName: string;
};

export type FastSmsEventView = SmsEvent & {
  contactName: string;
  companyName: string;
  sdrName: string;
};

export type FastTrackedCallView = TrackedCall & {
  contactName: string;
  companyName: string;
  sdrName: string;
};

export type FastOutreachDashboardSnapshot = {
  metrics: {
    activeCampaigns: number;
    sent: number;
    replyRate: number;
    bounceRate: number;
    suppressions: number;
    callsRecorded: number;
    webhooksProcessed: number;
    webhookDuplicates: number;
  };
  campaigns: FastCampaignView[];
  providers: OutreachProvider[];
  emailEvents: FastEmailEventView[];
  smsEvents: FastSmsEventView[];
  webhookEvents: WebhookEvent[];
  calls: FastTrackedCallView[];
};

export type FastOutreachDashboardModel = {
  state: AppState;
  snapshot: FastOutreachDashboardSnapshot;
  users: User[];
  sequences: CampaignSequence[];
  steps: SequenceStep[];
};

export async function readFastOutreachDashboardModel(
  session: Session,
  workspaceId: string,
  options: { scopedToOwnedRecords?: boolean } = {}
): Promise<FastOutreachDashboardModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const scopedContactIds = options.scopedToOwnedRecords && !session.permissions.includes("view_all_records")
    ? await ownedContactIds(session, workspaceId)
    : undefined;
  const eventContactWhere = scopedContactIds ? { in: scopedContactIds.length ? scopedContactIds : ["__none__"] } : undefined;
  const [
    memberRows,
    providers,
    campaigns,
    sequences,
    steps,
    emailEvents,
    smsEvents,
    trackedCalls,
    contacts
  ] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: [{ role: "asc" }, { id: "asc" }]
    }),
    prisma.outreachProvider.findMany({
      where: { workspaceId },
      orderBy: [{ kind: "asc" }, { id: "asc" }]
    }),
    prisma.outreachCampaign.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.campaignSequence.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.sequenceStep.findMany({
      where: { workspaceId },
      orderBy: [{ sequenceId: "asc" }, { stepNumber: "asc" }, { id: "asc" }]
    }),
    prisma.emailEvent.findMany({
      where: { workspaceId, ...(eventContactWhere ? { contactId: eventContactWhere } : {}) },
      include: {
        contact: {
          include: {
            account: true,
            contact: true
          }
        },
        account: true,
        campaign: true
      },
      orderBy: [
        { unsubscribeAt: "desc" },
        { bouncedAt: "desc" },
        { repliedAt: "desc" },
        { clickedAt: "desc" },
        { openedAt: "desc" },
        { deliveredAt: "desc" },
        { sentAt: "desc" },
        { id: "asc" }
      ],
      take: 1500
    }),
    prisma.smsEvent.findMany({
      where: { workspaceId, ...(eventContactWhere ? { contactId: eventContactWhere } : {}) },
      include: {
        contact: {
          include: {
            account: true,
            contact: true
          }
        },
        account: true,
        campaign: true,
        sdr: true
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 1000
    }),
    prisma.trackedCall.findMany({
      where: { workspaceId, ...(eventContactWhere ? { contactId: eventContactWhere } : {}) },
      include: {
        contact: {
          include: {
            account: true,
            contact: true
          }
        },
        account: true,
        sdr: true
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 1000
    }),
    prisma.contact.findMany({
      where: { workspaceId, ...(scopedContactIds ? { id: { in: scopedContactIds } } : {}) },
      include: { company: true },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 500
    })
  ]);

  const users = uniqueUsers(memberRows.map(({ user }) => userFromPrisma(user)));
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const mappedProviders = providers.map(providerFromPrisma);
  const mappedSequences = sequences.map(sequenceFromPrisma);
  const mappedSteps = steps.map(stepFromPrisma);
  const mappedEmailEvents = emailEvents.map((event) => {
    const mapped = emailEventFromPrisma(event);
    const crmContact = event.contact;
    const leadContact = crmContact?.contact;
    const account = event.account ?? crmContact?.account;
    return {
      ...mapped,
      contactName: leadContact?.fullName ?? crmContact?.fullName ?? "Unknown contact",
      companyName: account?.name ?? "Unknown account",
      campaignName: event.campaign?.name ?? "No campaign"
    } satisfies FastEmailEventView;
  }).sort((a, b) => Date.parse(emailEventTime(b)) - Date.parse(emailEventTime(a)));
  const mappedSmsEvents = smsEvents.map((event) => {
    const mapped = smsEventFromPrisma(event);
    const crmContact = event.contact;
    const leadContact = crmContact?.contact;
    const account = event.account ?? crmContact?.account;
    return {
      ...mapped,
      contactName: leadContact?.fullName ?? crmContact?.fullName ?? "Unknown contact",
      companyName: account?.name ?? "Unknown account",
      sdrName: event.sdr?.name ?? userNames.get(mapped.sdrUserId) ?? "Unassigned"
    } satisfies FastSmsEventView;
  });
  const mappedTrackedCalls = trackedCalls.map((call) => {
    const mapped = trackedCallFromPrisma(call);
    const crmContact = call.contact;
    const leadContact = crmContact?.contact;
    const account = call.account ?? crmContact?.account;
    return {
      ...mapped,
      contactName: leadContact?.fullName ?? crmContact?.fullName ?? "Unknown contact",
      companyName: account?.name ?? "Unknown account",
      sdrName: call.sdr?.name ?? userNames.get(mapped.sdrUserId) ?? "Unassigned"
    } satisfies FastTrackedCallView;
  });
  const mappedCampaigns = campaignViews({
    campaigns: campaigns.map(campaignFromPrisma),
    sequences: mappedSequences,
    emailEvents: mappedEmailEvents,
    smsEvents: mappedSmsEvents,
    userNames
  });
  const sent = mappedEmailEvents.filter((event) => event.eventType === "Sent").length;
  const bounced = mappedEmailEvents.filter((event) => event.eventType === "Bounced").length;
  const unsubscribed = mappedEmailEvents.filter((event) => event.eventType === "Unsubscribed").length +
    mappedSmsEvents.filter((event) => event.optOutFlag).length;
  const mappedContacts = contacts.map((contact) => ({
    id: contact.id,
    workspaceId: contact.workspaceId,
    companyId: contact.companyId ?? "",
    name: contact.fullName,
    title: contact.title ?? "",
    seniority: contact.seniority ?? undefined,
    department: contact.department ?? undefined,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    grade: leadGradeValue(contact.grade),
    score: contact.score,
    priority: priorityValue(contact.priority),
    status: leadStatusValue(contact.status),
    segment: contact.segment ?? "Unsegmented",
    owner: contact.owner ?? "Unassigned",
    sourceLineage: stringArray(contact.sourceLineage),
    verification: contact.verification ?? "No verification yet",
    enrichmentCoverage: contact.enrichmentCoverage ?? contact.confidence,
    fitReason: contact.fitReason ?? undefined,
    enrichedAt: optionalIso(contact.enrichedAt),
    lawfulBasis: lawfulBasisValue(contact.lawfulBasis),
    consentStatus: consentStatusValue(contact.consentStatus),
    consentSource: contact.consentSource ?? "Unknown",
    consentCapturedAt: optionalIso(contact.consentCapturedAt),
    doNotContact: contact.doNotContact,
    isSuppressed: contact.isSuppressed,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString()
  }));
  const mappedCompanies = Array.from(
    new Map(
      contacts
        .map((contact) => contact.company)
        .filter((company): company is NonNullable<typeof company> => Boolean(company))
        .map((company) => [
          company.id,
          {
            id: company.id,
            workspaceId: company.workspaceId,
            name: company.name,
            normalizedName: company.normalizedName,
            domain: company.rootDomain ?? "",
            website: company.website ?? "",
            phone: company.phone ?? "",
            industry: company.industry ?? "",
            employeeBand: company.employeeBand ?? undefined,
            revenueBand: company.revenueBand ?? undefined,
            technologies: [],
            signals: [],
            enrichmentCoverage: company.confidence,
            city: company.city ?? "",
            state: company.state ?? "",
            country: company.country ?? "",
            sourceLineage: stringArray(company.sourceLineage),
            score: company.score,
            priority: priorityValue(company.priority),
            createdAt: company.createdAt.toISOString(),
            updatedAt: company.updatedAt.toISOString()
          }
        ])
    ).values()
  );
  const state = createFastState(session, {
    users,
    workspaceMembers: memberRows.map(workspaceMemberFromPrisma),
    contacts: mappedContacts,
    companies: mappedCompanies,
    outreachProviders: mappedProviders,
    outreachCampaigns: mappedCampaigns,
    campaignSequences: mappedSequences,
    sequenceSteps: mappedSteps,
    emailEvents: mappedEmailEvents,
    smsEvents: mappedSmsEvents,
    trackedCalls: mappedTrackedCalls
  });

  return {
    state,
    snapshot: {
      metrics: {
        activeCampaigns: mappedCampaigns.filter((campaign) => campaign.status === "Active").length,
        sent,
        replyRate: sent ? Math.round((mappedEmailEvents.filter((event) => event.eventType === "Replied").length / sent) * 100) : 0,
        bounceRate: sent ? Math.round((bounced / sent) * 100) : 0,
        suppressions: unsubscribed + bounced,
        callsRecorded: mappedTrackedCalls.filter((call) => call.recordingUrl).length,
        webhooksProcessed: 0,
        webhookDuplicates: 0
      },
      campaigns: mappedCampaigns,
      providers: mappedProviders,
      emailEvents: mappedEmailEvents,
      smsEvents: mappedSmsEvents,
      webhookEvents: [],
      calls: mappedTrackedCalls
    },
    users,
    sequences: mappedSequences,
    steps: mappedSteps
  };
}

async function ownedContactIds(session: Session, workspaceId: string) {
  const { prisma } = await import("@/lib/prisma");
  const [assignments, ownedContacts, opportunities] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: { workspaceId, assignedSdrId: session.user.id },
      select: { contactId: true }
    }),
    prisma.contact.findMany({
      where: { workspaceId, owner: session.user.name },
      select: { id: true }
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, ownerUserId: session.user.id },
      select: { contactId: true }
    })
  ]);

  return Array.from(new Set([
    ...assignments.map((assignment) => assignment.contactId),
    ...ownedContacts.map((contact) => contact.id),
    ...opportunities.map((opportunity) => opportunity.contactId)
  ].filter((id): id is string => Boolean(id))));
}

function providerFromPrisma(row: {
  id: string;
  workspaceId: string;
  kind: string;
  provider: string;
  status: string;
  sendingDomain: string | null;
  mailboxGroup: string | null;
  senderEmail: string | null;
  fromNumber: string | null;
  dailyLimit: number;
  sentToday: number;
  bounceRate: number;
  complaintRate: number;
  unsubscribeRate: number;
  warmupStage: string | null;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  tls: boolean;
  createdAt: Date;
  updatedAt: Date;
}): OutreachProvider {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: outreachProviderKindValue(row.kind),
    provider: row.provider === "RingCentral Local" ? "RingCentral Local" : "Syncore Mail Local",
    status: outreachProviderStatusValue(row.status),
    sendingDomain: row.sendingDomain ?? undefined,
    mailboxGroup: row.mailboxGroup ?? undefined,
    senderEmail: row.senderEmail ?? undefined,
    fromNumber: row.fromNumber ?? undefined,
    dailyLimit: row.dailyLimit,
    sentToday: row.sentToday,
    bounceRate: row.bounceRate,
    complaintRate: row.complaintRate,
    unsubscribeRate: row.unsubscribeRate,
    warmupStage: row.warmupStage ?? "",
    spf: row.spf,
    dkim: row.dkim,
    dmarc: row.dmarc,
    tls: row.tls,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function campaignFromPrisma(row: {
  id: string;
  workspaceId: string;
  name: string;
  campaignType: string;
  targetSegment: string;
  sourceJobIds: string[];
  ownerUserId: string | null;
  sendingDomain: string | null;
  mailboxGroup: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  totalLeads: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  meetingsBooked: number;
  opportunitiesCreated: number;
  revenueWonCents: number;
  createdAt: Date;
  updatedAt: Date;
}): OutreachCampaign {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    campaignType: campaignTypeValue(row.campaignType),
    targetSegment: row.targetSegment,
    sourceJobIds: row.sourceJobIds,
    ownerUserId: row.ownerUserId ?? "",
    sendingDomain: row.sendingDomain ?? "",
    mailboxGroup: row.mailboxGroup ?? "",
    status: campaignStatusValue(row.status),
    startDate: optionalIso(row.startDate),
    endDate: optionalIso(row.endDate),
    totalLeads: row.totalLeads,
    sentCount: row.sentCount,
    openCount: row.openCount,
    clickCount: row.clickCount,
    replyCount: row.replyCount,
    bounceCount: row.bounceCount,
    unsubscribeCount: row.unsubscribeCount,
    meetingsBooked: row.meetingsBooked,
    opportunitiesCreated: row.opportunitiesCreated,
    revenueWon: row.revenueWonCents / 100,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function sequenceFromPrisma(row: {
  id: string;
  workspaceId: string;
  campaignId: string;
  name: string;
  targetSegment: string;
  defaultDelayRules: string | null;
  stopOnReply: boolean;
  stopOnBounce: boolean;
  stopOnUnsubscribe: boolean;
  createdById: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CampaignSequence {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    name: row.name,
    targetSegment: row.targetSegment,
    defaultDelayRules: row.defaultDelayRules ?? "",
    stopOnReply: row.stopOnReply,
    stopOnBounce: row.stopOnBounce,
    stopOnUnsubscribe: row.stopOnUnsubscribe,
    createdById: row.createdById ?? "",
    status: sequenceStatusValue(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function stepFromPrisma(row: {
  id: string;
  workspaceId: string;
  sequenceId: string;
  stepNumber: number;
  channel: string;
  delayDays: number;
  subject: string | null;
  bodyTemplate: string | null;
  callScript: string | null;
  smsTemplate: string | null;
  manualTaskInstruction: string | null;
  personalizationVariables: string[];
  requiredFields: string[];
  unsubscribeFooterRequired: boolean;
  physicalAddress: string | null;
  complianceStatus: string;
  complianceNotes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SequenceStep {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sequenceId: row.sequenceId,
    stepNumber: row.stepNumber,
    channel: outreachChannelValue(row.channel),
    delayDays: row.delayDays,
    subject: row.subject ?? undefined,
    bodyTemplate: row.bodyTemplate ?? undefined,
    callScript: row.callScript ?? undefined,
    smsTemplate: row.smsTemplate ?? undefined,
    manualTaskInstruction: row.manualTaskInstruction ?? undefined,
    personalizationVariables: row.personalizationVariables,
    requiredFields: row.requiredFields,
    unsubscribeFooterRequired: row.unsubscribeFooterRequired,
    physicalAddress: row.physicalAddress ?? undefined,
    complianceStatus: sequenceComplianceStatusValue(row.complianceStatus),
    complianceNotes: row.complianceNotes ?? undefined,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function emailEventFromPrisma(row: {
  id: string;
  workspaceId: string;
  contactId: string | null;
  accountId: string | null;
  campaignId: string | null;
  sequenceId: string | null;
  sequenceStepId: string | null;
  messageId: string;
  provider: string;
  senderEmail: string;
  recipientEmail: string;
  eventType: string;
  subject: string;
  bodySnapshot: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  repliedAt: Date | null;
  bouncedAt: Date | null;
  unsubscribeAt: Date | null;
  bounceType: string | null;
  smtpCode: string | null;
  rawPayload: unknown;
}): EmailEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contactId ?? "",
    companyId: row.accountId ?? "",
    campaignId: row.campaignId ?? undefined,
    sequenceId: row.sequenceId ?? undefined,
    sequenceStepId: row.sequenceStepId ?? undefined,
    messageId: row.messageId,
    provider: row.provider === "Amazon SES" ? "Amazon SES" : "Syncore Mail Local",
    senderEmail: row.senderEmail,
    recipientEmail: row.recipientEmail,
    eventType: emailEventTypeValue(row.eventType),
    subject: row.subject,
    bodySnapshot: row.bodySnapshot,
    sentAt: optionalIso(row.sentAt),
    deliveredAt: optionalIso(row.deliveredAt),
    openedAt: optionalIso(row.openedAt),
    clickedAt: optionalIso(row.clickedAt),
    repliedAt: optionalIso(row.repliedAt),
    bouncedAt: optionalIso(row.bouncedAt),
    unsubscribeAt: optionalIso(row.unsubscribeAt),
    bounceType: row.bounceType === "Hard" || row.bounceType === "Soft" ? row.bounceType : undefined,
    smtpCode: row.smtpCode ?? undefined,
    rawPayload: recordFromJson(row.rawPayload)
  };
}

function smsEventFromPrisma(row: {
  id: string;
  workspaceId: string;
  contactId: string | null;
  accountId: string | null;
  campaignId: string | null;
  sequenceId: string | null;
  sequenceStepId: string | null;
  sdrUserId: string | null;
  provider: string;
  fromNumber: string;
  toNumber: string;
  direction: string;
  body: string;
  status: string;
  deliveredAt: Date | null;
  repliedAt: Date | null;
  failedAt: Date | null;
  optOutFlag: boolean;
  rawPayload: unknown;
  createdAt: Date;
}): SmsEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contactId ?? "",
    companyId: row.accountId ?? "",
    campaignId: row.campaignId ?? undefined,
    sequenceId: row.sequenceId ?? undefined,
    sequenceStepId: row.sequenceStepId ?? undefined,
    sdrUserId: row.sdrUserId ?? "",
    provider: "RingCentral Local",
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    direction: row.direction === "Inbound" ? "Inbound" : "Outbound",
    body: row.body,
    status: smsEventStatusValue(row.status),
    deliveredAt: optionalIso(row.deliveredAt),
    repliedAt: optionalIso(row.repliedAt),
    failedAt: optionalIso(row.failedAt),
    optOutFlag: row.optOutFlag,
    rawPayload: recordFromJson(row.rawPayload),
    createdAt: row.createdAt.toISOString()
  };
}

function trackedCallFromPrisma(row: {
  id: string;
  workspaceId: string;
  contactId: string | null;
  accountId: string | null;
  leadContactId: string | null;
  companyId: string | null;
  sdrUserId: string | null;
  phoneNumber: string;
  direction: string;
  callStatus: string;
  disposition: string;
  durationSeconds: number;
  recordingConsent: string;
  recordingConsentSource: string | null;
  recordingConsentCapturedAt: Date | null;
  recordingUrl: string | null;
  recordingStoragePath: string | null;
  transcript: string | null;
  callSummary: string | null;
  nextStep: string | null;
  createdAt: Date;
}): TrackedCall {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.leadContactId ?? row.contactId ?? "",
    companyId: row.companyId ?? row.accountId ?? "",
    sdrUserId: row.sdrUserId ?? "",
    phoneNumber: row.phoneNumber,
    direction: callDirectionValue(row.direction),
    callStatus: trackedCallStatusValue(row.callStatus),
    disposition: callDispositionValue(row.disposition),
    durationSeconds: row.durationSeconds,
    recordingConsent: recordingConsentValue(row.recordingConsent),
    recordingConsentSource: row.recordingConsentSource ?? undefined,
    recordingConsentCapturedAt: optionalIso(row.recordingConsentCapturedAt),
    recordingUrl: row.recordingUrl ?? undefined,
    recordingStoragePath: row.recordingStoragePath ?? undefined,
    transcript: row.transcript ?? undefined,
    callSummary: row.callSummary ?? undefined,
    nextStep: row.nextStep ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

function campaignViews(input: {
  campaigns: OutreachCampaign[];
  sequences: CampaignSequence[];
  emailEvents: EmailEvent[];
  smsEvents: SmsEvent[];
  userNames: Map<string, string>;
}): FastCampaignView[] {
  return input.campaigns
    .map((campaign) => {
      const campaignEmails = input.emailEvents.filter((event) => event.campaignId === campaign.id);
      const campaignSms = input.smsEvents.filter((event) => event.campaignId === campaign.id);
      const sentCount = campaignEmails.filter((event) => event.eventType === "Sent").length +
        campaignSms.filter((event) => event.status === "Sent" || event.status === "Delivered").length;
      const replyCount = campaignEmails.filter((event) => event.eventType === "Replied").length +
        campaignSms.filter((event) => event.status === "Replied").length;
      const bounceCount = campaignEmails.filter((event) => event.eventType === "Bounced").length;
      const unsubscribeCount = campaignEmails.filter(
        (event) => event.eventType === "Unsubscribed" || event.eventType === "Spam complaint"
      ).length + campaignSms.filter((event) => event.optOutFlag).length;

      return {
        ...campaign,
        sentCount: sentCount || campaign.sentCount,
        replyCount: replyCount || campaign.replyCount,
        bounceCount: bounceCount || campaign.bounceCount,
        unsubscribeCount: unsubscribeCount || campaign.unsubscribeCount,
        ownerName: input.userNames.get(campaign.ownerUserId) ?? "Syncore user",
        sequenceCount: input.sequences.filter((sequence) => sequence.campaignId === campaign.id).length,
        eventCount: campaignEmails.length + campaignSms.length,
        replyRate: sentCount ? Math.round((replyCount / sentCount) * 100) : 0,
        bounceRate: sentCount ? Math.round((bounceCount / sentCount) * 100) : 0,
        unsubscribeRate: sentCount ? Math.round((unsubscribeCount / sentCount) * 100) : 0
      } satisfies FastCampaignView;
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function emailEventTime(event: EmailEvent) {
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

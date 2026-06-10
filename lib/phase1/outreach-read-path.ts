import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  AppState,
  CallDirection,
  CallDisposition,
  EmailEvent,
  EmailEventType,
  RecordingConsentStatus,
  SmsEvent,
  SmsEventStatus,
  TrackedCall,
  TrackedCallStatus
} from "@/lib/phase1/types";

export type OutreachEventReadRows = {
  emailEvents: EmailEvent[];
  smsEvents: SmsEvent[];
  trackedCalls: TrackedCall[];
};

type AccountRelation = { companyId: string | null } | null;
type CrmContactRelation = { contactId: string | null } | null;

type PrismaEmailEventReadRow = {
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
  sentAt: Date | string | null;
  deliveredAt: Date | string | null;
  openedAt: Date | string | null;
  clickedAt: Date | string | null;
  repliedAt: Date | string | null;
  bouncedAt: Date | string | null;
  unsubscribeAt: Date | string | null;
  bounceType: string | null;
  smtpCode: string | null;
  rawPayload: unknown;
  account: AccountRelation;
  contact: CrmContactRelation;
};

type PrismaSmsEventReadRow = {
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
  deliveredAt: Date | string | null;
  repliedAt: Date | string | null;
  failedAt: Date | string | null;
  optOutFlag: boolean;
  rawPayload: unknown;
  createdAt: Date | string;
  account: AccountRelation;
  contact: CrmContactRelation;
};

type PrismaTrackedCallReadRow = {
  id: string;
  workspaceId: string;
  contactId: string | null;
  accountId: string | null;
  sdrUserId: string | null;
  leadContactId: string | null;
  companyId: string | null;
  phoneNumber: string;
  direction: string;
  callStatus: string;
  disposition: string;
  durationSeconds: number;
  recordingConsent: string;
  recordingConsentSource: string | null;
  recordingConsentCapturedAt: Date | string | null;
  recordingUrl: string | null;
  recordingStoragePath: string | null;
  transcript: string | null;
  callSummary: string | null;
  nextStep: string | null;
  createdAt: Date | string;
  account: AccountRelation;
  contact: CrmContactRelation;
};

export async function outreachEventReadRowsForWorkspace(
  state: AppState,
  workspaceId: string
): Promise<OutreachEventReadRows> {
  const snapshotRows = outreachEventReadRowsFromState(state, workspaceId);

  if (resolveStorageDriver() !== "prisma") {
    return snapshotRows;
  }

  try {
    const normalizedRows = await readNormalizedOutreachEventRowsFromPrisma(workspaceId);
    const snapshotHasRows = hasOutreachEventRows(snapshotRows);
    const normalizedHasRows = hasOutreachEventRows(normalizedRows);

    if (snapshotHasRows && !normalizedHasRows) {
      return snapshotRows;
    }

    return normalizedRows;
  } catch (error) {
    console.warn("Falling back to snapshot outreach event rows after normalized Prisma read failed.", error);
    return snapshotRows;
  }
}

export function outreachEventReadRowsFromState(state: AppState, workspaceId: string): OutreachEventReadRows {
  return {
    emailEvents: state.emailEvents.filter((event) => event.workspaceId === workspaceId),
    smsEvents: state.smsEvents.filter((event) => event.workspaceId === workspaceId),
    trackedCalls: state.trackedCalls.filter((call) => call.workspaceId === workspaceId)
  };
}

export function stateWithOutreachEventReadRows(
  state: AppState,
  workspaceId: string,
  rows: OutreachEventReadRows
): AppState {
  return {
    ...state,
    emailEvents: [
      ...state.emailEvents.filter((event) => event.workspaceId !== workspaceId),
      ...rows.emailEvents
    ],
    smsEvents: [
      ...state.smsEvents.filter((event) => event.workspaceId !== workspaceId),
      ...rows.smsEvents
    ],
    trackedCalls: [
      ...state.trackedCalls.filter((call) => call.workspaceId !== workspaceId),
      ...rows.trackedCalls
    ]
  };
}

async function readNormalizedOutreachEventRowsFromPrisma(workspaceId: string): Promise<OutreachEventReadRows> {
  const { prisma } = await import("@/lib/prisma");
  const accountSelect = { select: { companyId: true } };
  const contactSelect = { select: { contactId: true } };
  const [emailRows, smsRows, callRows] = await Promise.all([
    prisma.emailEvent.findMany({
      where: { workspaceId },
      orderBy: [{ sentAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        contactId: true,
        accountId: true,
        campaignId: true,
        sequenceId: true,
        sequenceStepId: true,
        messageId: true,
        provider: true,
        senderEmail: true,
        recipientEmail: true,
        eventType: true,
        subject: true,
        bodySnapshot: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        clickedAt: true,
        repliedAt: true,
        bouncedAt: true,
        unsubscribeAt: true,
        bounceType: true,
        smtpCode: true,
        rawPayload: true,
        account: accountSelect,
        contact: contactSelect
      }
    }),
    prisma.smsEvent.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        contactId: true,
        accountId: true,
        campaignId: true,
        sequenceId: true,
        sequenceStepId: true,
        sdrUserId: true,
        provider: true,
        fromNumber: true,
        toNumber: true,
        direction: true,
        body: true,
        status: true,
        deliveredAt: true,
        repliedAt: true,
        failedAt: true,
        optOutFlag: true,
        rawPayload: true,
        createdAt: true,
        account: accountSelect,
        contact: contactSelect
      }
    }),
    prisma.trackedCall.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        contactId: true,
        accountId: true,
        sdrUserId: true,
        leadContactId: true,
        companyId: true,
        phoneNumber: true,
        direction: true,
        callStatus: true,
        disposition: true,
        durationSeconds: true,
        recordingConsent: true,
        recordingConsentSource: true,
        recordingConsentCapturedAt: true,
        recordingUrl: true,
        recordingStoragePath: true,
        transcript: true,
        callSummary: true,
        nextStep: true,
        createdAt: true,
        account: accountSelect,
        contact: contactSelect
      }
    })
  ]);

  return {
    emailEvents: emailRows.map((row) => emailEventFromPrisma(row)),
    smsEvents: smsRows.map((row) => smsEventFromPrisma(row)),
    trackedCalls: callRows.map((row) => trackedCallFromPrisma(row))
  };
}

function emailEventFromPrisma(row: PrismaEmailEventReadRow): EmailEvent {
  const payload = primitiveRecord(row.rawPayload) ?? {};

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contact?.contactId ?? stringValue(payload.leadContactId) ?? row.contactId ?? "",
    companyId: row.account?.companyId ?? stringValue(payload.companyId) ?? row.accountId ?? "",
    campaignId: row.campaignId ?? undefined,
    sequenceId: row.sequenceId ?? undefined,
    sequenceStepId: row.sequenceStepId ?? undefined,
    messageId: row.messageId,
    provider: "Syncore Mail Local",
    senderEmail: row.senderEmail,
    recipientEmail: row.recipientEmail,
    eventType: emailEventTypeValue(row.eventType),
    subject: row.subject,
    bodySnapshot: row.bodySnapshot,
    sentAt: optionalIsoString(row.sentAt),
    deliveredAt: optionalIsoString(row.deliveredAt),
    openedAt: optionalIsoString(row.openedAt),
    clickedAt: optionalIsoString(row.clickedAt),
    repliedAt: optionalIsoString(row.repliedAt),
    bouncedAt: optionalIsoString(row.bouncedAt),
    unsubscribeAt: optionalIsoString(row.unsubscribeAt),
    bounceType: bounceTypeValue(row.bounceType),
    smtpCode: row.smtpCode ?? undefined,
    rawPayload: payload
  };
}

function smsEventFromPrisma(row: PrismaSmsEventReadRow): SmsEvent {
  const payload = primitiveRecord(row.rawPayload) ?? {};

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contact?.contactId ?? stringValue(payload.leadContactId) ?? row.contactId ?? "",
    companyId: row.account?.companyId ?? stringValue(payload.companyId) ?? row.accountId ?? "",
    campaignId: row.campaignId ?? undefined,
    sequenceId: row.sequenceId ?? undefined,
    sequenceStepId: row.sequenceStepId ?? undefined,
    sdrUserId: row.sdrUserId ?? "system",
    provider: "RingCentral Local",
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    direction: callDirectionValue(row.direction),
    body: row.body,
    status: smsEventStatusValue(row.status),
    deliveredAt: optionalIsoString(row.deliveredAt),
    repliedAt: optionalIsoString(row.repliedAt),
    failedAt: optionalIsoString(row.failedAt),
    optOutFlag: row.optOutFlag,
    rawPayload: payload,
    createdAt: isoString(row.createdAt)
  };
}

function trackedCallFromPrisma(row: PrismaTrackedCallReadRow): TrackedCall {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contact?.contactId ?? row.leadContactId ?? row.contactId ?? "",
    companyId: row.account?.companyId ?? row.companyId ?? row.accountId ?? "",
    sdrUserId: row.sdrUserId ?? "system",
    phoneNumber: row.phoneNumber,
    direction: callDirectionValue(row.direction),
    callStatus: trackedCallStatusValue(row.callStatus),
    disposition: callDispositionValue(row.disposition),
    durationSeconds: row.durationSeconds,
    recordingConsent: recordingConsentValue(row.recordingConsent),
    recordingConsentSource: row.recordingConsentSource ?? undefined,
    recordingConsentCapturedAt: optionalIsoString(row.recordingConsentCapturedAt),
    recordingUrl: row.recordingUrl ?? undefined,
    recordingStoragePath: row.recordingStoragePath ?? undefined,
    transcript: row.transcript ?? undefined,
    callSummary: row.callSummary ?? undefined,
    nextStep: row.nextStep ?? undefined,
    createdAt: isoString(row.createdAt)
  };
}

function hasOutreachEventRows(rows: OutreachEventReadRows) {
  return rows.emailEvents.length > 0 || rows.smsEvents.length > 0 || rows.trackedCalls.length > 0;
}

function emailEventTypeValue(value: string): EmailEventType {
  const values: EmailEventType[] = [
    "Sent",
    "Delivered",
    "Opened",
    "Clicked",
    "Replied",
    "Bounced",
    "Unsubscribed",
    "Spam complaint"
  ];

  return values.includes(value as EmailEventType) ? value as EmailEventType : "Sent";
}

function smsEventStatusValue(value: string): SmsEventStatus {
  const values: SmsEventStatus[] = ["Sent", "Delivered", "Failed", "Replied", "Opt-out"];
  return values.includes(value as SmsEventStatus) ? value as SmsEventStatus : "Sent";
}

function callDirectionValue(value: string): CallDirection {
  return value === "Inbound" ? "Inbound" : "Outbound";
}

function trackedCallStatusValue(value: string): TrackedCallStatus {
  const values: TrackedCallStatus[] = ["Dialed", "Connected", "No answer", "Voicemail", "Busy", "Failed"];
  return values.includes(value as TrackedCallStatus) ? value as TrackedCallStatus : "Dialed";
}

function callDispositionValue(value: string): CallDisposition {
  const values: CallDisposition[] = [
    "Interested",
    "Not interested",
    "Left voicemail",
    "No answer",
    "Bad number",
    "Meeting booked"
  ];

  return values.includes(value as CallDisposition) ? value as CallDisposition : "No answer";
}

function recordingConsentValue(value: string): RecordingConsentStatus {
  const values: RecordingConsentStatus[] = ["Granted", "Denied", "Unknown", "Not recorded"];
  return values.includes(value as RecordingConsentStatus) ? value as RecordingConsentStatus : "Unknown";
}

function bounceTypeValue(value: string | null): "Hard" | "Soft" | undefined {
  if (value === "Hard" || value === "Soft") {
    return value;
  }

  return undefined;
}

function primitiveRecord(value: unknown): Record<string, string | number | boolean | undefined> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, item]) =>
      item === undefined || typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    )
  );
}

function stringValue(value: string | number | boolean | undefined) {
  return typeof value === "string" ? value : undefined;
}

function isoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return isoString(value);
}

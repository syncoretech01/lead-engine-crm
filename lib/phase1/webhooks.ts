import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { createEmailEvent, createSmsEvent } from "@/lib/phase1/outreach";
import {
  assertWorkspaceExists,
  assertWorkspaceMember,
  requireWorkspaceScopedRecord
} from "@/lib/phase1/tenant-isolation";
import type {
  AppState,
  EmailEventType,
  Session,
  SmsEventStatus,
  WebhookEvent,
  WebhookProvider,
  WebhookEventTarget
} from "@/lib/phase1/types";

const defaultWebhookSecret = "syncore-local-webhook-secret";

type EmailWebhookPayload = {
  workspaceId: string;
  contactId: string;
  eventType: EmailEventType;
  providerEventId?: string;
  messageId?: string;
  campaignId?: string;
  sequenceId?: string;
  sequenceStepId?: string;
  subject?: string;
  bodySnapshot?: string;
  bounceType?: "Hard" | "Soft";
  smtpCode?: string;
  occurredAt?: string;
};

type SmsWebhookPayload = {
  workspaceId: string;
  contactId: string;
  status: SmsEventStatus;
  providerEventId?: string;
  campaignId?: string;
  sequenceId?: string;
  sequenceStepId?: string;
  sdrUserId?: string;
  direction?: "Outbound" | "Inbound";
  body?: string;
  occurredAt?: string;
};

type ProcessResult = {
  status: "processed" | "duplicate";
  webhookEvent: WebhookEvent;
  recordId?: string;
};

export function webhookSecret() {
  return process.env.SYNCORE_WEBHOOK_SECRET || defaultWebhookSecret;
}

export function signWebhookPayload(body: string, secret = webhookSecret()) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyWebhookSignature(body: string, signature: string | null, secret = webhookSecret()) {
  if (!signature) {
    return false;
  }

  const normalized = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const expected = signWebhookPayload(body, secret);

  try {
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(normalized, "hex");
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}

export function processEmailWebhook(state: AppState, payload: EmailWebhookPayload, actor: Session["user"]): ProcessResult {
  validateEmailPayload(payload);
  assertWorkspaceExists(state, payload.workspaceId);
  assertWorkspaceMember(state, payload.workspaceId, actor.id);
  assertWebhookTargets(state, payload.workspaceId, payload);
  const provider: WebhookProvider = "Syncore Mail Local";
  const providerEventId = payload.providerEventId ?? payload.messageId ?? `${payload.contactId}:${payload.eventType}`;
  const idempotencyKey = webhookIdempotencyKey(provider, "email", payload.workspaceId, providerEventId, payload.eventType);
  const duplicate = duplicateWebhook(state, payload.workspaceId, idempotencyKey);

  if (duplicate) {
    return { status: "duplicate", webhookEvent: duplicate };
  }

  const event = createEmailEvent(state, {
    workspaceId: payload.workspaceId,
    contactId: payload.contactId,
    campaignId: payload.campaignId,
    sequenceId: payload.sequenceId,
    sequenceStepId: payload.sequenceStepId,
    eventType: payload.eventType,
    subject: payload.subject ?? `${payload.eventType} webhook`,
    bodySnapshot: payload.bodySnapshot ?? "Provider webhook event.",
    actorUserId: actor.id,
    bounceType: payload.bounceType,
    smtpCode: payload.smtpCode,
    occurredAt: payload.occurredAt,
    messageId: payload.messageId ?? providerEventId,
    rawPayload: compactRawPayload(payload)
  });

  const webhookEvent = recordWebhookEvent(state, {
    workspaceId: payload.workspaceId,
    provider,
    target: "email",
    providerEventId,
    eventType: payload.eventType,
    idempotencyKey,
    status: "Processed",
    processedRecordId: event.id,
    rawPayload: compactRawPayload(payload)
  });

  return { status: "processed", webhookEvent, recordId: event.id };
}

export function processSmsWebhook(state: AppState, payload: SmsWebhookPayload, actor: Session["user"]): ProcessResult {
  validateSmsPayload(payload);
  assertWorkspaceExists(state, payload.workspaceId);
  assertWorkspaceMember(state, payload.workspaceId, actor.id);
  assertWorkspaceMember(state, payload.workspaceId, payload.sdrUserId ?? actor.id);
  assertWebhookTargets(state, payload.workspaceId, payload);
  const provider: WebhookProvider = "RingCentral Local";
  const providerEventId = payload.providerEventId ?? `${payload.contactId}:${payload.status}:${payload.occurredAt ?? "now"}`;
  const idempotencyKey = webhookIdempotencyKey(provider, "sms", payload.workspaceId, providerEventId, payload.status);
  const duplicate = duplicateWebhook(state, payload.workspaceId, idempotencyKey);

  if (duplicate) {
    return { status: "duplicate", webhookEvent: duplicate };
  }

  const event = createSmsEvent(state, {
    workspaceId: payload.workspaceId,
    contactId: payload.contactId,
    campaignId: payload.campaignId,
    sequenceId: payload.sequenceId,
    sequenceStepId: payload.sequenceStepId,
    sdrUserId: payload.sdrUserId ?? actor.id,
    direction: payload.direction ?? "Inbound",
    body: payload.body ?? `${payload.status} webhook`,
    status: payload.status,
    occurredAt: payload.occurredAt,
    rawPayload: compactRawPayload(payload)
  });

  const webhookEvent = recordWebhookEvent(state, {
    workspaceId: payload.workspaceId,
    provider,
    target: "sms",
    providerEventId,
    eventType: payload.status,
    idempotencyKey,
    status: "Processed",
    processedRecordId: event.id,
    rawPayload: compactRawPayload(payload)
  });

  return { status: "processed", webhookEvent, recordId: event.id };
}

export function webhookIdempotencyKey(
  provider: WebhookProvider,
  target: WebhookEventTarget,
  workspaceId: string,
  providerEventId: string,
  eventType: string
) {
  return `${provider}:${target}:${workspaceId}:${providerEventId}:${eventType}`;
}

function recordWebhookEvent(
  state: AppState,
  input: Omit<WebhookEvent, "id" | "receivedAt" | "processedAt">
) {
  const now = new Date().toISOString();
  const event: WebhookEvent = {
    id: `webhook-${randomUUID()}`,
    receivedAt: now,
    processedAt: input.status === "Processed" || input.status === "Duplicate" ? now : undefined,
    ...input
  };

  state.webhookEvents.unshift(event);
  return event;
}

function duplicateWebhook(state: AppState, workspaceId: string, idempotencyKey: string) {
  const existing = state.webhookEvents.find(
    (event) => event.workspaceId === workspaceId && event.idempotencyKey === idempotencyKey
  );

  if (!existing) {
    return undefined;
  }

  return recordWebhookEvent(state, {
    workspaceId,
    provider: existing.provider,
    target: existing.target,
    providerEventId: existing.providerEventId,
    eventType: existing.eventType,
    idempotencyKey,
    status: "Duplicate",
    processedRecordId: existing.processedRecordId,
    rawPayload: { duplicateOf: existing.id }
  });
}

function validateEmailPayload(payload: EmailWebhookPayload) {
  if (!payload.workspaceId || !payload.contactId || !payload.eventType) {
    throw new Error("Email webhook requires workspaceId, contactId, and eventType.");
  }
}

function validateSmsPayload(payload: SmsWebhookPayload) {
  if (!payload.workspaceId || !payload.contactId || !payload.status) {
    throw new Error("SMS webhook requires workspaceId, contactId, and status.");
  }
}

function assertWebhookTargets(
  state: AppState,
  workspaceId: string,
  payload: Pick<EmailWebhookPayload | SmsWebhookPayload, "contactId" | "campaignId" | "sequenceId" | "sequenceStepId">
) {
  requireWorkspaceScopedRecord(
    state.contacts.find((contact) => contact.id === payload.contactId),
    workspaceId,
    "Webhook contact"
  );

  if (payload.campaignId) {
    requireWorkspaceScopedRecord(
      state.outreachCampaigns.find((campaign) => campaign.id === payload.campaignId),
      workspaceId,
      "Webhook campaign"
    );
  }

  if (payload.sequenceId) {
    requireWorkspaceScopedRecord(
      state.campaignSequences.find((sequence) => sequence.id === payload.sequenceId),
      workspaceId,
      "Webhook sequence"
    );
  }

  if (payload.sequenceStepId) {
    requireWorkspaceScopedRecord(
      state.sequenceSteps.find((step) => step.id === payload.sequenceStepId),
      workspaceId,
      "Webhook sequence step"
    );
  }
}

function compactRawPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined && typeof value !== "object")
      .map(([key, value]) => [key, value as string | number | boolean | undefined])
  );
}

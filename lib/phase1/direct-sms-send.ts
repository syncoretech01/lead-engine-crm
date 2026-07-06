import { addActivity } from "@/lib/phase1/crm";
import { createSmsEvent } from "@/lib/phase1/outreach";
import { startPerformanceTimer, timeAsync } from "@/lib/phase1/performance";
import { recordFirstTouch } from "@/lib/phase1/sdr";
import { resolveUserTelephonyIdentity, telephonyIdentityBlockReason } from "@/lib/phase1/telephony-identities";
import { resolveUserRingCentralCredential } from "@/lib/phase1/ringcentral-user-credential";
import {
  ringCentralSendSms,
  ringCentralSmsLiveBlockReason,
  type RingCentralSmsCredential
} from "@/lib/providers/adapters/ringcentral-sms";
import type { AppState, Contact, SdrLeadStatus, User } from "@/lib/phase1/types";
import type { ProviderCredential } from "@/lib/providers/types";

export type DirectSmsRecipient = {
  requestId: string;
  contactId: string;
  toNumber: string;
  fromNumber: string;
  text: string;
  senderUserId: string;
  senderName: string;
  senderEmail: string;
};

export type DirectSmsSkipped = {
  contactId: string;
  reason: string;
};

export type DirectSmsSendPlan =
  | {
      credentialOk: true;
      credential: ProviderCredential;
      workspaceId: string;
      actorUserId: string;
      recipients: DirectSmsRecipient[];
      skipped: DirectSmsSkipped[];
      totalRequested: number;
    }
  | {
      credentialOk: false;
      reason: string;
      workspaceId: string;
      actorUserId: string;
      recipients: DirectSmsRecipient[];
      skipped: DirectSmsSkipped[];
      totalRequested: number;
    };

export type DirectSmsOutcome = {
  contactId: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  reason?: string;
};

export type DirectSmsSendSummary = {
  sent: number;
  failed: number;
  skipped: number;
};

export function buildDirectSmsSendPlan(
  state: AppState,
  input: {
    workspaceId: string;
    actor: User;
    requestId: string;
    contactId: string;
    body: string;
  }
): DirectSmsSendPlan {
  const contact = state.contacts.find(
    (item) => item.id === input.contactId && item.workspaceId === input.workspaceId
  );
  const skipped: DirectSmsSkipped[] = [];
  const recipients: DirectSmsRecipient[] = [];

  if (!contact) {
    skipped.push({ contactId: input.contactId, reason: "Contact not found." });
  } else {
    const blockReason = directSmsBlockReason(contact);
    if (blockReason) {
      skipped.push({ contactId: contact.id, reason: blockReason });
    } else if (hasDirectSmsSentEvent(state, input.workspaceId, input.requestId, contact.id)) {
      skipped.push({ contactId: contact.id, reason: "Already sent for this request." });
    } else {
      const telephonyIdentity = resolveUserTelephonyIdentity(input.actor);
      if (!telephonyIdentity) {
        skipped.push({ contactId: contact.id, reason: telephonyIdentityBlockReason(input.actor) });
      } else {
        recipients.push({
          requestId: input.requestId,
          contactId: contact.id,
          toNumber: contact.phone,
          fromNumber: telephonyIdentity.phoneNumber,
          text: renderDirectSms(input.body, contact, companyName(state, contact.companyId, input.workspaceId)),
          senderUserId: input.actor.id,
          senderName: telephonyIdentity.displayName,
          senderEmail: telephonyIdentity.email
        });
      }
    }
  }

  const liveBlockReason = ringCentralSmsLiveBlockReason();
  // Send AS the acting SDR — their own RingCentral account app when configured,
  // else the shared Syncore app + their JWT (see resolveUserRingCentralCredential).
  const credential = resolveUserRingCentralCredential(input.actor);
  if (liveBlockReason || !credential) {
    return {
      credentialOk: false,
      reason: liveBlockReason ?? "RingCentral credentials are missing.",
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      recipients,
      skipped,
      totalRequested: 1
    };
  }

  return {
    credentialOk: true,
    credential: ringCentralCredential(credential),
    workspaceId: input.workspaceId,
    actorUserId: input.actor.id,
    recipients,
    skipped,
    totalRequested: 1
  };
}

export async function sendDirectSmsBatch(
  recipients: DirectSmsRecipient[],
  credential: ProviderCredential,
  workspaceId: string
): Promise<DirectSmsOutcome[]> {
  const timer = startPerformanceTimer("ringcentral.directSmsBatch", { workspaceId, recipientCount: recipients.length });
  const outcomes: DirectSmsOutcome[] = [];

  for (const recipient of recipients) {
    try {
      const result = await timeAsync(
        "ringcentral.sendSms",
        () =>
          ringCentralSendSms(
            {
              fromNumber: recipient.fromNumber,
              toNumber: recipient.toNumber,
              text: recipient.text
            },
            {
              workspaceId,
              providerId: "ringcentral",
              executionMode: "live",
              requestId: `direct-sms-${recipient.requestId}-${recipient.contactId}`,
              actorUserId: recipient.senderUserId,
              credential
            }
          ),
        { workspaceId, kind: "one_to_one" }
      );

      if (result.status === "ok" && result.data[0]?.status === "sent") {
        outcomes.push({
          contactId: recipient.contactId,
          status: "sent",
          providerMessageId: result.data[0].providerMessageId
        });
      } else {
        outcomes.push({
          contactId: recipient.contactId,
          status: "failed",
          reason: result.errorMessage ?? result.data[0]?.reason ?? "RingCentral SMS send failed."
        });
      }
    } catch (error) {
      outcomes.push({
        contactId: recipient.contactId,
        status: "failed",
        reason: error instanceof Error ? error.message : "RingCentral SMS send failed."
      });
    }
  }

  timer.end({
    sent: outcomes.filter((outcome) => outcome.status === "sent").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length
  });

  return outcomes;
}

export function recordDirectSmsSendResults(
  state: AppState,
  input: {
    workspaceId: string;
    actorUserId: string;
    recipients: DirectSmsRecipient[];
    outcomes: DirectSmsOutcome[];
    skipped: DirectSmsSkipped[];
  }
): DirectSmsSendSummary {
  const recipientByContactId = new Map(input.recipients.map((recipient) => [recipient.contactId, recipient]));
  let sent = 0;
  let failed = 0;

  for (const outcome of input.outcomes) {
    const recipient = recipientByContactId.get(outcome.contactId);
    if (!recipient) {
      continue;
    }

    if (outcome.status !== "sent") {
      failed += 1;
      addFailedSmsActivity(state, input.workspaceId, input.actorUserId, recipient, outcome.reason);
      continue;
    }

    if (hasDirectSmsSentEvent(state, input.workspaceId, recipient.requestId, recipient.contactId)) {
      continue;
    }

    createSmsEvent(state, {
      workspaceId: input.workspaceId,
      contactId: recipient.contactId,
      sdrUserId: recipient.senderUserId,
      direction: "Outbound",
      body: recipient.text,
      status: "Sent",
      fromNumber: recipient.fromNumber,
      provider: "RingCentral",
      rawPayload: {
        provider: "RingCentral",
        messageId: outcome.providerMessageId,
        directRequestId: recipient.requestId,
        senderUserId: recipient.senderUserId,
        senderName: recipient.senderName,
        senderEmail: recipient.senderEmail,
        live: true
      }
    });
    markSdrAssignmentTouched(state, input.workspaceId, recipient.contactId, input.actorUserId, recipient.text);
    sent += 1;
  }

  return { sent, failed, skipped: input.skipped.length };
}

export function directSmsBlockReason(contact: Contact): string | undefined {
  if (contact.isSuppressed) return "Contact is suppressed.";
  if (contact.doNotContact) return "Contact is marked do-not-contact.";
  if (!contact.phone) return "Contact has no phone number.";
  return undefined;
}

export function directSmsLiveBlockReason(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return ringCentralSmsLiveBlockReason(env);
}

function ringCentralCredential(credential: RingCentralSmsCredential): ProviderCredential {
  return {
    source: "environment",
    secret: JSON.stringify(credential)
  };
}

function renderDirectSms(body: string, contact: Contact, companyNameValue: string) {
  const firstName = contact.name.split(" ")[0] ?? contact.name;
  const replacements: Record<string, string> = {
    "{{first_name}}": firstName,
    "{{name}}": contact.name,
    "{{title}}": contact.title,
    "{{company}}": companyNameValue,
    "{{segment}}": contact.segment
  };
  return replaceTokens(body || "Hi {{first_name}}, quick question about {{company}}.", replacements);
}

function markSdrAssignmentTouched(
  state: AppState,
  workspaceId: string,
  contactId: string,
  actorUserId: string,
  body: string
) {
  const assignment = state.sdrAssignments.find(
    (item) => item.workspaceId === workspaceId && item.contactId === contactId
  );
  if (!assignment) {
    return;
  }

  recordFirstTouch(state, {
    workspaceId,
    assignmentId: assignment.id,
    actorUserId,
    channel: "SMS",
    outcome: touchOutcomeForStatus(assignment.status),
    notes: `SMS sent: ${truncate(body)}`
  });
}

function touchOutcomeForStatus(status: SdrLeadStatus): SdrLeadStatus {
  if (status === "New" || status === "Assigned" || status === "Working") {
    return "Contacted";
  }
  return status;
}

function addFailedSmsActivity(
  state: AppState,
  workspaceId: string,
  actorUserId: string,
  recipient: DirectSmsRecipient,
  reason = "RingCentral SMS send failed."
) {
  const contact = state.contacts.find((item) => item.id === recipient.contactId && item.workspaceId === workspaceId);
  addActivity(state, {
    workspaceId,
    companyId: contact?.companyId,
    contactId: recipient.contactId,
    type: "SMS",
    title: "SMS send failed",
    body: `${truncate(recipient.text)}: ${reason}`,
    actorUserId,
    metadata: {
      provider: "RingCentral",
      directRequestId: recipient.requestId,
      senderUserId: recipient.senderUserId,
      senderEmail: recipient.senderEmail,
      reason
    }
  });
}

function hasDirectSmsSentEvent(state: AppState, workspaceId: string, requestId: string, contactId: string) {
  return state.smsEvents.some(
    (event) =>
      event.workspaceId === workspaceId &&
      event.contactId === contactId &&
      event.provider === "RingCentral" &&
      (event.status === "Sent" || event.status === "Delivered") &&
      event.rawPayload.directRequestId === requestId
  );
}

function companyName(state: AppState, companyId: string, workspaceId: string) {
  return state.companies.find((company) => company.id === companyId && company.workspaceId === workspaceId)?.name ?? "your company";
}

function replaceTokens(value: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce((next, [token, replacement]) => next.replaceAll(token, replacement), value);
}

function truncate(value: string, max = 140) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

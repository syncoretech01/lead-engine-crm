import { addActivity } from "@/lib/phase1/crm";
import { outreachFrom, outreachMailingAddress, outreachReplyTo } from "@/lib/phase1/outreach-config";
import { createEmailEvent } from "@/lib/phase1/outreach";
import {
  emailAddressFromMailbox,
  findLiveSesConnection,
  isSendEligible,
  type SendOutcome
} from "@/lib/phase1/outreach-send";
import { resolveLiveProviderCredential } from "@/lib/phase1/provider-live-execution";
import { recordFirstTouch } from "@/lib/phase1/sdr";
import { buildOneClickUnsubscribeUrl, buildUnsubscribeUrl } from "@/lib/phase1/unsubscribe-token";
import { amazonSesSendEmail } from "@/lib/providers/adapters/amazon-ses";
import { ensureLiveProviderAdaptersRegistered } from "@/lib/providers/register-live-adapters";
import type { AppState, Contact, SdrLeadStatus, User } from "@/lib/phase1/types";
import type { ProviderCredential } from "@/lib/providers/types";

export type DirectEmailMode = "one_to_one" | "sdr_bulk";
export type BulkEmailAudience = "all_assigned" | "p1" | "due_or_overdue";

export type DirectEmailRecipient = {
  requestId: string;
  mode: DirectEmailMode;
  contactId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  from: string;
  replyTo: string;
  headers: Record<string, string>;
};

export type DirectEmailSkipped = {
  contactId: string;
  reason: string;
};

export type DirectEmailSendPlan =
  | {
      credentialOk: true;
      credential: ProviderCredential;
      workspaceId: string;
      actorUserId: string;
      recipients: DirectEmailRecipient[];
      skipped: DirectEmailSkipped[];
      totalRequested: number;
    }
  | {
      credentialOk: false;
      reason: string;
      workspaceId: string;
      actorUserId: string;
      recipients: DirectEmailRecipient[];
      skipped: DirectEmailSkipped[];
      totalRequested: number;
    };

export type DirectEmailSendSummary = {
  sent: number;
  failed: number;
  skipped: number;
};

export function buildDirectEmailSendPlan(
  state: AppState,
  input: {
    workspaceId: string;
    actor: User;
    requestId: string;
    mode: DirectEmailMode;
    contactIds: string[];
    subject: string;
    body: string;
  }
): DirectEmailSendPlan {
  const requestedIds = [...new Set(input.contactIds.filter(Boolean))];
  const contacts = requestedIds
    .map((contactId) => state.contacts.find((contact) => contact.id === contactId && contact.workspaceId === input.workspaceId))
    .filter((contact): contact is Contact => Boolean(contact));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const skipped: DirectEmailSkipped[] = requestedIds
    .filter((contactId) => !contactById.has(contactId))
    .map((contactId) => ({ contactId, reason: "Contact not found." }));

  const from = outreachFrom();
  const replyTo = outreachReplyTo();
  const physicalAddress = outreachMailingAddress();
  const recipients: DirectEmailRecipient[] = [];

  for (const contact of contacts) {
    const blockReason = directEmailBlockReason(contact);
    if (blockReason) {
      skipped.push({ contactId: contact.id, reason: blockReason });
      continue;
    }

    if (hasDirectSentEvent(state, input.workspaceId, input.requestId, contact.id)) {
      skipped.push({ contactId: contact.id, reason: "Already sent for this request." });
      continue;
    }

    const unsubscribeUrl = buildUnsubscribeUrl(input.workspaceId, contact.id);
    const oneClick = buildOneClickUnsubscribeUrl(input.workspaceId, contact.id);
    const rendered = renderDirectEmail({
      subject: input.subject,
      body: input.body,
      contact,
      companyName: companyName(state, contact.companyId, input.workspaceId),
      senderName: input.actor.name,
      unsubscribeUrl,
      physicalAddress
    });

    recipients.push({
      requestId: input.requestId,
      mode: input.mode,
      contactId: contact.id,
      to: contact.email,
      from,
      replyTo,
      headers: {
        "List-Unsubscribe": `<${oneClick}>, <mailto:${emailAddressFromMailbox(replyTo)}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      ...rendered
    });
  }

  const connection = findLiveSesConnection(state, input.workspaceId);
  const credentialResult = resolveLiveProviderCredential(state, connection);
  if (!connection) {
    return {
      credentialOk: false,
      reason: "SES not live",
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      recipients,
      skipped,
      totalRequested: requestedIds.length
    };
  }
  if (!credentialResult.ok) {
    return {
      credentialOk: false,
      reason: credentialResult.reason,
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      recipients,
      skipped,
      totalRequested: requestedIds.length
    };
  }

  return {
    credentialOk: true,
    credential: credentialResult.credential,
    workspaceId: input.workspaceId,
    actorUserId: input.actor.id,
    recipients,
    skipped,
    totalRequested: requestedIds.length
  };
}

export async function sendDirectEmailBatch(
  recipients: DirectEmailRecipient[],
  credential: ProviderCredential,
  workspaceId: string
): Promise<SendOutcome[]> {
  ensureLiveProviderAdaptersRegistered();
  const outcomes: SendOutcome[] = [];

  for (const recipient of recipients) {
    try {
      const result = await amazonSesSendEmail(
        {
          to: recipient.to,
          subject: recipient.subject,
          html: recipient.html,
          text: recipient.text,
          replyTo: recipient.replyTo,
          from: recipient.from,
          headers: recipient.headers
        },
        {
          workspaceId,
          providerId: "amazon_ses",
          executionMode: "live",
          requestId: `direct-${recipient.requestId}-${recipient.contactId}`,
          credential
        }
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
          reason: result.errorMessage ?? result.data[0]?.reason ?? "Amazon SES send failed."
        });
      }
    } catch (error) {
      outcomes.push({
        contactId: recipient.contactId,
        status: "failed",
        reason: error instanceof Error ? error.message : "Amazon SES send failed."
      });
    }
  }

  return outcomes;
}

export function recordDirectEmailSendResults(
  state: AppState,
  input: {
    workspaceId: string;
    actorUserId: string;
    recipients: DirectEmailRecipient[];
    outcomes: SendOutcome[];
    skipped: DirectEmailSkipped[];
  }
): DirectEmailSendSummary {
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
      addFailedEmailActivity(state, input.workspaceId, input.actorUserId, recipient, outcome.reason);
      continue;
    }

    if (hasDirectSentEvent(state, input.workspaceId, recipient.requestId, recipient.contactId)) {
      continue;
    }

    createEmailEvent(state, {
      workspaceId: input.workspaceId,
      contactId: recipient.contactId,
      eventType: "Sent",
      subject: recipient.subject,
      bodySnapshot: recipient.text,
      actorUserId: input.actorUserId,
      messageId: outcome.providerMessageId,
      provider: "Amazon SES",
      senderEmail: emailAddressFromMailbox(recipient.from),
      rawPayload: {
        provider: "Amazon SES",
        messageId: outcome.providerMessageId,
        directRequestId: recipient.requestId,
        directEmailMode: recipient.mode
      }
    });
    markSdrAssignmentTouched(state, input.workspaceId, recipient.contactId, input.actorUserId, recipient.subject);
    sent += 1;
  }

  return { sent, failed, skipped: input.skipped.length };
}

export function assignedBulkEmailContactIds(
  state: AppState,
  input: {
    workspaceId: string;
    ownerUserId?: string;
    audience: BulkEmailAudience;
    limit: number;
  }
): string[] {
  const now = new Date().toISOString();
  return state.sdrAssignments
    .filter((assignment) => assignment.workspaceId === input.workspaceId)
    .filter((assignment) => !input.ownerUserId || assignment.assignedSdrId === input.ownerUserId)
    .filter((assignment) => activeAssignmentStatuses.has(assignment.status))
    .filter((assignment) => {
      const contact = state.contacts.find(
        (item) => item.id === assignment.contactId && item.workspaceId === input.workspaceId
      );
      return Boolean(contact && !directEmailBlockReason(contact));
    })
    .filter((assignment) => {
      if (input.audience === "p1") {
        return state.contacts.some(
          (contact) =>
            contact.id === assignment.contactId &&
            contact.workspaceId === input.workspaceId &&
            contact.priority === "P1"
        );
      }
      if (input.audience === "due_or_overdue") {
        const dueAt = assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt;
        return assignment.slaStatus === "Overdue" || Boolean(dueAt && Date.parse(dueAt) <= Date.parse(now));
      }
      return true;
    })
    .sort((a, b) => assignmentWeight(state, input.workspaceId, a.contactId, a.slaStatus) - assignmentWeight(state, input.workspaceId, b.contactId, b.slaStatus))
    .slice(0, Math.max(0, input.limit))
    .map((assignment) => assignment.contactId);
}

export function directEmailBlockReason(contact: Contact): string | undefined {
  if (contact.isSuppressed) return "Contact is suppressed.";
  if (contact.doNotContact) return "Contact is marked do-not-contact.";
  if (!contact.email) return "Contact has no email address.";
  if (contact.grade === "S" || contact.grade === "D") return `Contact grade ${contact.grade} is blocked.`;
  if (contact.priority === "S") return "Contact priority is suppressed.";
  if (!isSendEligible(contact)) return "Contact is not eligible for email.";
  return undefined;
}

export function renderDirectEmail(input: {
  subject: string;
  body: string;
  contact: Contact;
  companyName: string;
  senderName: string;
  unsubscribeUrl: string;
  physicalAddress: string;
}): { subject: string; text: string; html: string } {
  const firstName = input.contact.name.split(" ")[0] ?? input.contact.name;
  const replacements: Record<string, string> = {
    "{{first_name}}": firstName,
    "{{name}}": input.contact.name,
    "{{title}}": input.contact.title,
    "{{company}}": input.companyName,
    "{{segment}}": input.contact.segment,
    "{{sender_name}}": input.senderName,
    "{{unsubscribe_url}}": input.unsubscribeUrl,
    "{{physical_address}}": input.physicalAddress
  };
  const subject = replaceTokens(input.subject || "Quick question", replacements);
  let text = replaceTokens(input.body || "Hi {{first_name}}, quick question about {{company}}.", replacements);
  if (!text.includes(input.unsubscribeUrl)) {
    text = `${text.trim()}\n\nUnsubscribe: ${input.unsubscribeUrl}`;
  }
  if (!text.includes(input.physicalAddress)) {
    text = `${text.trim()}\n\n${input.physicalAddress}`;
  }

  const escaped = escapeHtml(text);
  const linked = escaped.replaceAll(
    escapeHtml(input.unsubscribeUrl),
    `<a href="${escapeAttribute(input.unsubscribeUrl)}">${escapeHtml(input.unsubscribeUrl)}</a>`
  );
  return { subject, text, html: linked.replace(/\n/g, "<br>") };
}

function markSdrAssignmentTouched(
  state: AppState,
  workspaceId: string,
  contactId: string,
  actorUserId: string,
  subject: string
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
    channel: "Email",
    outcome: touchOutcomeForStatus(assignment.status),
    notes: `Email sent: ${subject}`
  });
}

function touchOutcomeForStatus(status: SdrLeadStatus): SdrLeadStatus {
  if (status === "New" || status === "Assigned" || status === "Working") {
    return "Contacted";
  }
  return status;
}

function addFailedEmailActivity(
  state: AppState,
  workspaceId: string,
  actorUserId: string,
  recipient: DirectEmailRecipient,
  reason = "Amazon SES send failed."
) {
  const contact = state.contacts.find((item) => item.id === recipient.contactId && item.workspaceId === workspaceId);
  addActivity(state, {
    workspaceId,
    companyId: contact?.companyId,
    contactId: recipient.contactId,
    type: "Email",
    title: "Email send failed",
    body: `${recipient.subject}: ${reason}`,
    actorUserId,
    metadata: {
      provider: "Amazon SES",
      directRequestId: recipient.requestId,
      directEmailMode: recipient.mode,
      reason
    }
  });
}

function hasDirectSentEvent(state: AppState, workspaceId: string, requestId: string, contactId: string) {
  return state.emailEvents.some(
    (event) =>
      event.workspaceId === workspaceId &&
      event.contactId === contactId &&
      event.eventType === "Sent" &&
      event.rawPayload.directRequestId === requestId
  );
}

function assignmentWeight(state: AppState, workspaceId: string, contactId: string, slaStatus: string) {
  const contact = state.contacts.find((item) => item.id === contactId && item.workspaceId === workspaceId);
  const sla = slaStatus === "Overdue" ? 0 : slaStatus === "Due soon" ? 1 : 2;
  const priority = contact?.priority === "P1" ? 0 : contact?.priority === "P2" ? 1 : contact?.priority === "P3" ? 2 : 3;
  return sla * 10 + priority;
}

function companyName(state: AppState, companyId: string, workspaceId: string) {
  return state.companies.find((company) => company.id === companyId && company.workspaceId === workspaceId)?.name ?? "your company";
}

function replaceTokens(value: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce((next, [token, replacement]) => next.replaceAll(token, replacement), value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

const activeAssignmentStatuses = new Set<SdrLeadStatus>([
  "New",
  "Assigned",
  "Working",
  "Contacted",
  "Opened",
  "Replied",
  "Interested",
  "Meeting Booked",
  "Qualified",
  "Proposal Sent",
  "Nurture"
]);

import { addActivity } from "@/lib/phase1/crm";
import { outreachMailingAddress } from "@/lib/phase1/outreach-config";
import { createEmailEvent } from "@/lib/phase1/outreach";
import { startPerformanceTimer, timeAsync } from "@/lib/phase1/performance";
import {
  emailAddressFromMailbox,
  findLiveSesConnection,
  isSendEligible,
  type SendOutcome
} from "@/lib/phase1/outreach-send";
import { resolveLiveProviderCredential } from "@/lib/phase1/provider-live-execution";
import { recordFirstTouch } from "@/lib/phase1/sdr";
import { coldSendDomainBlockReason, findColdTouchLinks } from "@/lib/phase1/outreach-validation";
import { resolveUserSenderIdentity, senderIdentityBlockReason } from "@/lib/phase1/sender-identities";
import { buildOneClickUnsubscribeUrl, buildUnsubscribeUrl } from "@/lib/phase1/unsubscribe-token";
import { amazonSesSendEmail, type EmailAttachment } from "@/lib/providers/adapters/amazon-ses";
import { ensureLiveProviderAdaptersRegistered } from "@/lib/providers/register-live-adapters";
import { isContactCurrentlySuppressed } from "@/lib/phase1/exporting";
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
  senderUserId: string;
  senderName: string;
  senderEmail: string;
  headers: Record<string, string>;
  attachments?: EmailAttachment[];
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
  /**
   * Why each skipped contact was skipped, deduplicated with a count.
   *
   * A bare count told the rep nothing: a cold send blocked by golden rule 13
   * looked identical to a suppressed contact, and both server actions return
   * void, so the click produced no error, no toast, and an audit row saying only
   * "skipped: 2". The reason is the whole point of skipping rather than throwing.
   */
  skippedReasons: Array<{ reason: string; count: number }>;
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
    attachments?: EmailAttachment[];
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

  const physicalAddress = outreachMailingAddress();
  const recipients: DirectEmailRecipient[] = [];

  // Rule 8 binds AUTOMATED cold touch 1 — a 1:1 mail a rep types to one person
  // is not automated, and blocking a link there would stop a rep sending the
  // deck they just promised on a call. Rule 13 has no such carve-out.
  const enforceNoLinks = input.mode === "sdr_bulk";

  for (const contact of contacts) {
    const blockReason = directEmailBlockReason(contact, state);
    if (blockReason) {
      skipped.push({ contactId: contact.id, reason: blockReason });
      continue;
    }

    if (hasDirectSentEvent(state, input.workspaceId, input.requestId, contact.id)) {
      skipped.push({ contactId: contact.id, reason: "Already sent for this request." });
      continue;
    }

    const senderUser = senderUserForContact(state, input.workspaceId, input.mode, contact.id, input.actor);
    const senderIdentity = resolveUserSenderIdentity(senderUser);
    if (!senderIdentity) {
      skipped.push({ contactId: contact.id, reason: senderIdentityBlockReason(senderUser) });
      continue;
    }

    const unsubscribeUrl = buildUnsubscribeUrl(input.workspaceId, contact.id);
    const oneClick = buildOneClickUnsubscribeUrl(input.workspaceId, contact.id);
    const rendered = renderDirectEmail({
      subject: input.subject,
      body: input.body,
      contact,
      companyName: companyName(state, contact.companyId, input.workspaceId),
      senderName: senderIdentity.displayName,
      unsubscribeUrl,
      physicalAddress,
      signature: senderUser.emailSignature
    });

    // Golden rules 8 and 13, enforced on the SECOND live cold-send path. This
    // plan only ever reaches a live send (findLiveSesConnection below), so a
    // recipient who has never been emailed IS cold touch 1. The campaign sender
    // got these guards; this one did not, and every rep identity resolves to the
    // primary domain by default (sender-identities.ts), so the rule was being
    // violated on every bulk send.
    //
    // Checked AFTER rendering, deliberately. Scanning the operator's template
    // missed two ways a link reaches a cold touch 1: the rep's self-service
    // emailSignature, which the renderer appends (a calendly link is exactly
    // what reps put there), and merge tokens — a local-business import routinely
    // carries a website in the company name, so "{{company}}" substitutes one in.
    // The unsubscribe link the renderer adds is exempt; it is legally required.
    //
    // Skipped rather than thrown: the rules bind cold first touches, so a warm
    // reply in the same batch still goes out, and the reason is carried through
    // to the audit row rather than becoming an opaque error digest.
    if (!hasEverBeenEmailed(state, input.workspaceId, contact.id)) {
      const domainReason = coldSendDomainBlockReason({
        from: senderIdentity.mailbox,
        replyTo: senderIdentity.replyTo
      });
      if (domainReason) {
        skipped.push({ contactId: contact.id, reason: domainReason });
        continue;
      }
      if (enforceNoLinks) {
        const links = findColdTouchLinks(`${rendered.subject}\n${rendered.text}`, [unsubscribeUrl, oneClick]);
        if (links.length > 0) {
          skipped.push({
            contactId: contact.id,
            reason:
              `Cold touch 1 must not contain links (golden rule 8) — remove: ${links.join(", ")}. ` +
              "The unsubscribe link is added automatically and does not count."
          });
          continue;
        }
      }
    }

    recipients.push({
      requestId: input.requestId,
      mode: input.mode,
      contactId: contact.id,
      to: contact.email,
      from: senderIdentity.mailbox,
      replyTo: senderIdentity.replyTo,
      senderUserId: senderUser.id,
      senderName: senderIdentity.displayName,
      senderEmail: senderIdentity.email,
      headers: {
        "List-Unsubscribe": `<${oneClick}>, <mailto:${emailAddressFromMailbox(senderIdentity.replyTo)}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      attachments: input.attachments,
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
  const timer = startPerformanceTimer("ses.directEmailBatch", { workspaceId, recipientCount: recipients.length });
  const outcomes: SendOutcome[] = [];

  for (const recipient of recipients) {
    try {
      const result = await timeAsync("ses.sendEmail", () => amazonSesSendEmail(
        {
          to: recipient.to,
          subject: recipient.subject,
          html: recipient.html,
          text: recipient.text,
          replyTo: recipient.replyTo,
          from: recipient.from,
          headers: recipient.headers,
          attachments: recipient.attachments
        },
        {
          workspaceId,
          providerId: "amazon_ses",
          executionMode: "live",
          requestId: `direct-${recipient.requestId}-${recipient.contactId}`,
          credential
        }
      ), { workspaceId, kind: recipient.mode });

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

  timer.end({
    sent: outcomes.filter((outcome) => outcome.status === "sent").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length
  });
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
      senderEmail: recipient.senderEmail,
      rawPayload: {
        provider: "Amazon SES",
        messageId: outcome.providerMessageId,
        directRequestId: recipient.requestId,
        directEmailMode: recipient.mode,
        senderUserId: recipient.senderUserId,
        senderName: recipient.senderName,
        // rawPayload is flat primitives only — flatten attachment metadata.
        ...(recipient.attachments && recipient.attachments.length > 0
          ? {
              attachmentCount: recipient.attachments.length,
              attachmentNames: recipient.attachments.map((attachment) => attachment.filename).join(", "),
              attachmentBytes: recipient.attachments.reduce(
                (total, attachment) => total + Math.floor((attachment.content.length * 3) / 4),
                0
              )
            }
          : {})
      }
    });
    markSdrAssignmentTouched(state, input.workspaceId, recipient.contactId, input.actorUserId, recipient.subject);
    sent += 1;
  }

  const reasonCounts = new Map<string, number>();
  for (const skip of input.skipped) {
    reasonCounts.set(skip.reason, (reasonCounts.get(skip.reason) ?? 0) + 1);
  }

  return {
    sent,
    failed,
    skipped: input.skipped.length,
    skippedReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count }))
  };
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
    .filter((assignment) => !assignment.callCycleCompletedAt)
    .filter((assignment) => {
      const contact = state.contacts.find(
        (item) => item.id === assignment.contactId && item.workspaceId === input.workspaceId
      );
      return Boolean(contact && !directEmailBlockReason(contact, state));
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

export function directEmailBlockReason(contact: Contact, state?: AppState): string | undefined {
  if (contact.isSuppressed) return "Contact is suppressed.";
  if (contact.doNotContact) return "Contact is marked do-not-contact.";
  // Pass `state` at send time to also block against the workspace suppression list.
  if (state && isContactCurrentlySuppressed(state, contact)) return "Contact matches a suppression record.";
  if (!contact.email) return "Contact has no email address.";
  if (contact.grade === "S" || contact.grade === "D") return `Contact grade ${contact.grade} is blocked.`;
  if (contact.priority === "S") return "Contact priority is suppressed.";
  if (!isSendEligible(contact, state)) return "Contact is not eligible for email.";
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
  /** The sending user's personal signature, appended after the body. */
  signature?: string;
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
  // Personal signature sits between the message body and the compliance footer.
  const signature = input.signature?.trim();
  if (signature) {
    text = `${text.trim()}\n\n${replaceTokens(signature, replacements)}`;
  }
  if (!text.includes(input.unsubscribeUrl)) {
    text = `${text.trim()}\n\nUnsubscribe: ${input.unsubscribeUrl}`;
  }
  if (!text.includes(input.physicalAddress)) {
    text = `${text.trim()}\n\n${input.physicalAddress}`;
  }

  const escaped = escapeHtml(text);
  const linked = linkVisibleUnsubscribeUrl(escaped, input.unsubscribeUrl);
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

/**
 * Has this contact ever actually been sent an email?
 *
 * "Cold touch 1" is a fact about the EMAIL channel, and the only trustworthy
 * record of it is the sent events themselves.
 *
 * The obvious-looking signals on SdrAssignment are both unusable. `touchCount`
 * and `firstTouchedAt` are FABRICATED at assignment time (sdr.ts:172-174): any
 * lead whose status maps to something other than "Assigned" — "New" and
 * "Working" both do — is created with touchCount 1 and a firstTouchedAt dated a
 * day BEFORE it was assigned. A predicate built on either one answers "warm" for
 * most genuinely cold leads, which is exactly how the first version of this
 * guard failed to fire. `touchCount` is also channel-agnostic: recordFirstTouch
 * increments it for a logged phone call (sdr.ts:407), and one unanswered dial
 * does not make the first email a warm reply.
 *
 * Erring toward cold is the safe direction. A contact imported with prior
 * history we never recorded reads as cold and costs one skipped send; the other
 * way costs the primary domain's reputation.
 */
function hasEverBeenEmailed(state: AppState, workspaceId: string, contactId: string): boolean {
  return state.emailEvents.some(
    (event) =>
      event.workspaceId === workspaceId && event.contactId === contactId && event.eventType === "Sent"
  );
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
      senderUserId: recipient.senderUserId,
      senderEmail: recipient.senderEmail,
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

function senderUserForContact(
  state: AppState,
  workspaceId: string,
  mode: DirectEmailMode,
  contactId: string,
  actor: User
) {
  if (mode !== "sdr_bulk") {
    return actor;
  }

  const assignment = state.sdrAssignments.find(
    (item) => item.workspaceId === workspaceId && item.contactId === contactId
  );
  return state.users.find((user) => user.id === assignment?.assignedSdrId) ?? actor;
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

function linkVisibleUnsubscribeUrl(escapedText: string, unsubscribeUrl: string) {
  const escapedUrl = escapeHtml(unsubscribeUrl);
  const anchor = `<a href="${escapeAttribute(unsubscribeUrl)}">Unsubscribe</a>`;
  const placeholder = "__SYNCORE_UNSUBSCRIBE_LINK__";

  return escapedText
    .replaceAll(`Unsubscribe: ${escapedUrl}`, placeholder)
    .replaceAll(escapedUrl, placeholder)
    .replaceAll(placeholder, anchor);
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

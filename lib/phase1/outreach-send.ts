import { resolveLiveProviderCredential } from "@/lib/phase1/provider-live-execution";
import { outreachBatchSize, outreachFrom, outreachMailingAddress, outreachReplyTo } from "@/lib/phase1/outreach-config";
import { createEmailEvent, refreshCampaignMetrics } from "@/lib/phase1/outreach";
import { buildOneClickUnsubscribeUrl, buildUnsubscribeUrl } from "@/lib/phase1/unsubscribe-token";
import { amazonSesSendEmail } from "@/lib/providers/adapters/amazon-ses";
import { resolveProviderExecutionMode } from "@/lib/providers/live-adapters";
import { ensureLiveProviderAdaptersRegistered } from "@/lib/providers/register-live-adapters";
import type {
  AppState,
  CampaignSequence,
  Contact,
  OutreachCampaign,
  ProviderConnection,
  SequenceStep
} from "@/lib/phase1/types";
import type { ProviderCredential } from "@/lib/providers/types";

export type PlannedRecipient = {
  campaignId: string;
  contactId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  from: string;
  replyTo: string;
  headers: Record<string, string>;
};

export type CampaignSendBatch =
  | {
      credentialOk: true;
      credential: ProviderCredential;
      recipients: PlannedRecipient[];
      totalEligible: number;
      remaining: number;
    }
  | {
      credentialOk: false;
      reason: string;
      recipients: PlannedRecipient[];
      totalEligible: number;
      remaining: number;
    };

export type SendOutcome = {
  contactId: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  reason?: string;
};

export function campaignAudience(state: AppState, campaign: OutreachCampaign): Contact[] {
  const sourceJobIds = campaign.sourceJobIds.filter(Boolean);
  return state.contacts.filter((contact) => {
    if (contact.workspaceId !== campaign.workspaceId) {
      return false;
    }
    if (sourceJobIds.length > 0) {
      return contact.sourceLineage.some((source) => sourceJobIds.some((jobId) => source.includes(jobId)));
    }
    return Boolean(
      campaign.targetSegment &&
        (contact.segment.includes(campaign.targetSegment) || campaign.targetSegment.includes(contact.segment))
    );
  });
}

export function isSendEligible(contact: Contact): boolean {
  return Boolean(
    !contact.isSuppressed &&
      !contact.doNotContact &&
      contact.email &&
      contact.grade !== "S" &&
      contact.grade !== "D" &&
      contact.priority !== "S"
  );
}

export function renderOutreachEmail(args: {
  step?: SequenceStep;
  campaign: OutreachCampaign;
  contact: Contact;
  companyName: string;
  unsubscribeUrl: string;
  physicalAddress: string;
}): { subject: string; text: string; html: string } {
  const subjectTemplate = args.step?.subject ?? `${args.campaign.name} intro`;
  const bodyTemplate =
    args.step?.bodyTemplate ??
    "Hi {{first_name}}, quick question about {{company}}.\n\nUnsubscribe: {{unsubscribe_url}}\n\n{{physical_address}}";
  const firstName = args.contact.name.split(" ")[0] ?? args.contact.name;
  const replacements: Record<string, string> = {
    "{{first_name}}": firstName,
    "{{company}}": args.companyName,
    "{{segment}}": args.contact.segment || args.campaign.targetSegment,
    "{{unsubscribe_url}}": args.unsubscribeUrl,
    "{{physical_address}}": args.physicalAddress
  };

  const subject = replaceTokens(subjectTemplate, replacements);
  let text = replaceTokens(bodyTemplate, replacements);
  if (!text.includes(args.unsubscribeUrl)) {
    text = `${text.trim()}\n\nUnsubscribe: ${args.unsubscribeUrl}`;
  }
  if (!text.includes(args.physicalAddress)) {
    text = `${text.trim()}\n\n${args.physicalAddress}`;
  }

  const escaped = escapeHtml(text);
  const linked = linkVisibleUnsubscribeUrl(escaped, args.unsubscribeUrl);
  return { subject, text, html: linked.replace(/\n/g, "<br>") };
}

export function buildCampaignSendBatch(
  state: AppState,
  workspaceId: string,
  campaignId: string,
  opts: { batchSize: number } = { batchSize: outreachBatchSize() }
): CampaignSendBatch {
  const campaign = state.outreachCampaigns.find((item) => item.id === campaignId && item.workspaceId === workspaceId);
  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const eligible = campaignAudience(state, campaign).filter(isSendEligible);
  const alreadySent = new Set(
    state.emailEvents
      .filter(
        (event) =>
          event.workspaceId === workspaceId &&
          event.campaignId === campaignId &&
          event.eventType === "Sent"
      )
      .map((event) => event.contactId)
  );
  const unsent = eligible.filter((contact) => !alreadySent.has(contact.id));
  const connection = findLiveSesConnection(state, workspaceId);
  const credentialResult = resolveLiveProviderCredential(state, connection);
  if (!connection) {
    return {
      credentialOk: false,
      reason: "SES not live",
      recipients: [],
      totalEligible: eligible.length,
      remaining: unsent.length
    };
  }
  if (!credentialResult.ok) {
    return {
      credentialOk: false,
      reason: credentialResult.reason,
      recipients: [],
      totalEligible: eligible.length,
      remaining: unsent.length
    };
  }

  const sequenceBundle = firstEmailStep(state, campaign);
  const from = outreachFrom();
  const replyTo = outreachReplyTo();
  const physicalAddress = outreachMailingAddress();
  const recipients = unsent.slice(0, Math.max(0, opts.batchSize)).map((contact) => {
    const unsubscribeUrl = buildUnsubscribeUrl(workspaceId, contact.id);
    const oneClick = buildOneClickUnsubscribeUrl(workspaceId, contact.id);
    const rendered = renderOutreachEmail({
      step: sequenceBundle.step,
      campaign,
      contact,
      companyName: companyName(state, contact.companyId, workspaceId),
      unsubscribeUrl,
      physicalAddress
    });

    return {
      campaignId,
      contactId: contact.id,
      to: contact.email,
      from,
      replyTo,
      headers: {
        "List-Unsubscribe": `<${oneClick}>, <mailto:${emailAddressFromMailbox(replyTo)}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      ...rendered
    };
  });

  if (recipients.length > 0) {
    campaign.status = "Active";
    campaign.updatedAt = new Date().toISOString();
  }

  return {
    credentialOk: true,
    credential: credentialResult.credential,
    recipients,
    totalEligible: eligible.length,
    remaining: Math.max(0, unsent.length - recipients.length)
  };
}

export async function sendCampaignBatch(
  recipients: PlannedRecipient[],
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
          requestId: `outreach-${recipient.campaignId}-${recipient.contactId}`,
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

export function recordCampaignSendResults(
  state: AppState,
  workspaceId: string,
  campaignId: string,
  actorUserId: string,
  outcomes: SendOutcome[]
): { sent: number; failed: number; completed: boolean } {
  const campaign = state.outreachCampaigns.find((item) => item.id === campaignId && item.workspaceId === workspaceId);
  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const sequenceBundle = firstEmailStep(state, campaign);
  const physicalAddress = outreachMailingAddress();
  const senderEmail = emailAddressFromMailbox(outreachFrom());
  let sent = 0;
  let failed = 0;

  for (const outcome of outcomes) {
    if (outcome.status !== "sent") {
      failed += 1;
      continue;
    }
    if (hasSentEvent(state, workspaceId, campaignId, outcome.contactId)) {
      continue;
    }

    const contact = state.contacts.find((item) => item.id === outcome.contactId && item.workspaceId === workspaceId);
    if (!contact) {
      continue;
    }

    const rendered = renderOutreachEmail({
      step: sequenceBundle.step,
      campaign,
      contact,
      companyName: companyName(state, contact.companyId, workspaceId),
      unsubscribeUrl: buildUnsubscribeUrl(workspaceId, contact.id),
      physicalAddress
    });

    createEmailEvent(state, {
      workspaceId,
      contactId: contact.id,
      campaignId: campaign.id,
      sequenceId: sequenceBundle.sequence?.id,
      sequenceStepId: sequenceBundle.step?.id,
      eventType: "Sent",
      subject: rendered.subject,
      bodySnapshot: rendered.text,
      actorUserId,
      messageId: outcome.providerMessageId,
      provider: "Amazon SES",
      senderEmail,
      rawPayload: { provider: "Amazon SES", messageId: outcome.providerMessageId }
    });
    sent += 1;
  }

  const remaining = campaignAudience(state, campaign)
    .filter(isSendEligible)
    .filter((contact) => !hasSentEvent(state, workspaceId, campaignId, contact.id));
  const completed = remaining.length === 0;
  if (completed) {
    campaign.status = "Completed";
    campaign.updatedAt = new Date().toISOString();
  }
  refreshCampaignMetrics(state, workspaceId);
  return { sent, failed, completed };
}

export function emailAddressFromMailbox(value: string): string {
  const match = value.match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim();
}

export function findLiveSesConnection(state: AppState, workspaceId?: string): ProviderConnection | undefined {
  const live = (state.providerConnections ?? []).filter(
    (connection) =>
      connection.providerId === "amazon_ses" &&
      connection.enabled &&
      resolveProviderExecutionMode(connection.executionMode) === "live"
  );
  if (workspaceId) {
    const scoped = live.find((connection) => connection.workspaceId === workspaceId);
    if (scoped) return scoped;
  }
  return live[0];
}

function hasSentEvent(state: AppState, workspaceId: string, campaignId: string, contactId: string) {
  return state.emailEvents.some(
    (event) =>
      event.workspaceId === workspaceId &&
      event.campaignId === campaignId &&
      event.contactId === contactId &&
      event.eventType === "Sent"
  );
}

function firstEmailStep(
  state: AppState,
  campaign: OutreachCampaign
): { sequence?: CampaignSequence; step?: SequenceStep } {
  const sequence = state.campaignSequences.find(
    (item) => item.workspaceId === campaign.workspaceId && item.campaignId === campaign.id
  );
  const step = sequence
    ? state.sequenceSteps
        .filter((item) => item.workspaceId === campaign.workspaceId && item.sequenceId === sequence.id && item.channel === "Email" && item.active)
        .sort((a, b) => a.stepNumber - b.stepNumber)[0]
    : undefined;
  return { sequence, step };
}

function companyName(state: AppState, companyId: string, workspaceId: string) {
  return state.companies.find((company) => company.id === companyId && company.workspaceId === workspaceId)?.name ?? "Unknown account";
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
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function linkVisibleUnsubscribeUrl(escapedText: string, unsubscribeUrl: string) {
  const escapedUrl = escapeHtml(unsubscribeUrl);
  const anchor = `<a href="${escapeAttribute(unsubscribeUrl)}">Unsubscribe</a>`;
  return escapedText
    .replaceAll(`Unsubscribe: ${escapedUrl}`, anchor)
    .replaceAll(escapedUrl, anchor);
}

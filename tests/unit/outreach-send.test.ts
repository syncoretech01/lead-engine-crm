import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCampaignSendBatch,
  campaignAudience,
  isSendEligible,
  recordCampaignSendResults
} from "@/lib/phase1/outreach-send";
import { createSeedState } from "@/lib/phase1/seed";
import type {
  AppState,
  CampaignSequence,
  Company,
  Contact,
  EmailEvent,
  OutreachCampaign,
  ProviderConnection,
  SequenceStep
} from "@/lib/phase1/types";

const envSnapshot = { ...process.env };

beforeEach(() => {
  process.env.SYNCORE_APP_URL = "https://app.syncore.test";
  process.env.SYNCORE_UNSUBSCRIBE_SECRET = "test-secret";
  process.env.SYNCORE_ENABLE_LIVE_PROVIDERS = "true";
  process.env.SYNCORE_MAILING_ADDRESS = "Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA";
  process.env.SYNCORE_OUTREACH_FROM = "Bobby Jones <bobby@syncoretech.com>";
  process.env.SYNCORE_OUTREACH_REPLY_TO = "replies@syncoretech.com";
  process.env.AWS_SES_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
  process.env.AWS_SECRET_ACCESS_KEY = "secret";
});

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("outreach send planning", () => {
  it("locks campaign audience to source job ids and never falls back to first 8 contacts", () => {
    const state = outreachState({ liveSes: false });
    const campaign = state.outreachCampaigns[0];
    expect(campaignAudience(state, campaign).map((contact) => contact.id)).toEqual(["contact-a", "contact-b"]);

    const legacyCampaign = { ...campaign, id: "campaign-legacy", sourceJobIds: [], targetSegment: "No matching segment" };
    expect(campaignAudience(state, legacyCampaign)).toEqual([]);
  });

  it("excludes contacts that are not safe to send", () => {
    const eligible = baseContact("eligible", "workspace-syncore", ["source:job-a"]);
    const noEmail = { ...eligible, id: "no-email", email: "" };
    const gradeD = { ...eligible, id: "grade-d", grade: "D" as const };
    const suppressed = { ...eligible, id: "suppressed", isSuppressed: true };

    expect(isSendEligible(eligible)).toBe(true);
    expect(isSendEligible(noEmail)).toBe(false);
    expect(isSendEligible(gradeD)).toBe(false);
    expect(isSendEligible(suppressed)).toBe(false);
  });

  it("plans an idempotent live SES batch with signed unsubscribe headers", () => {
    const state = outreachState({ liveSes: true });
    state.emailEvents = [sentEvent("email-existing", "contact-a", "campaign-a")];

    const batch = buildCampaignSendBatch(state, "workspace-syncore", "campaign-a", { batchSize: 1 });

    expect(batch.credentialOk).toBe(true);
    expect(batch.totalEligible).toBe(2);
    expect(batch.remaining).toBe(0);
    expect(batch.recipients).toHaveLength(1);
    expect(batch.recipients[0]).toMatchObject({
      contactId: "contact-b",
      from: "Bobby Jones <bobby@syncoretech.com>",
      replyTo: "replies@syncoretech.com"
    });
    expect(batch.recipients[0].headers["List-Unsubscribe"]).toContain("https://app.syncore.test/api/unsubscribe?t=");
    expect(batch.recipients[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(batch.recipients[0].text).toContain("https://app.syncore.test/unsubscribe/contact-b?t=");
    expect(batch.recipients[0].text).toContain("Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA");
  });

  it("records successful SES sends and completes the campaign when drained", () => {
    const state = outreachState({ liveSes: true, contacts: [baseContact("contact-a", "workspace-syncore", ["source:job-a"])] });
    const result = recordCampaignSendResults(state, "workspace-syncore", "campaign-a", "user-nora", [
      { contactId: "contact-a", status: "sent", providerMessageId: "ses-message-1" }
    ]);

    expect(result).toEqual({ sent: 1, failed: 0, completed: true });
    expect(state.outreachCampaigns[0].status).toBe("Completed");
    expect(state.emailEvents[0]).toMatchObject({
      contactId: "contact-a",
      campaignId: "campaign-a",
      eventType: "Sent",
      provider: "Amazon SES",
      messageId: "ses-message-1",
      senderEmail: "bobby@syncoretech.com"
    });
  });
});

function outreachState(options: { liveSes: boolean; contacts?: Contact[] }): AppState {
  const state = createSeedState();
  const workspaceId = "workspace-syncore";
  state.companies = [company("company-a", workspaceId)];
  state.contacts = options.contacts ?? [
    baseContact("contact-a", workspaceId, ["source:job-a"]),
    baseContact("contact-b", workspaceId, ["source:job-a"]),
    baseContact("contact-c", workspaceId, ["source:job-b"])
  ];
  state.outreachCampaigns = [campaign("campaign-a", workspaceId, ["job-a"])];
  state.campaignSequences = [sequence("sequence-a", workspaceId, "campaign-a")];
  state.sequenceSteps = [step("step-a", workspaceId, "sequence-a")];
  state.emailEvents = [];
  state.smsEvents = [];
  state.providerConnections = options.liveSes ? [sesConnection(workspaceId)] : [];
  return state;
}

function company(id: string, workspaceId: string): Company {
  return {
    id,
    workspaceId,
    name: "Acme Co",
    normalizedName: "acme co",
    domain: "acme.test",
    website: "https://acme.test",
    phone: "",
    industry: "Technology",
    city: "Denver",
    state: "CO",
    country: "US",
    sourceLineage: ["job-a"],
    score: 80,
    priority: "P1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function baseContact(id: string, workspaceId: string, sourceLineage: string[]): Contact {
  return {
    id,
    workspaceId,
    companyId: "company-a",
    name: "Sam Lead",
    title: "Owner",
    email: `${id}@example.com`,
    phone: "",
    grade: "A",
    score: 80,
    priority: "P2",
    status: "Ready for SDR",
    segment: "Technology owners",
    owner: "Unassigned",
    sourceLineage,
    verification: "Valid",
    lawfulBasis: "Legitimate interest",
    consentStatus: "Not required",
    consentSource: "Test",
    doNotContact: false,
    isSuppressed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function campaign(id: string, workspaceId: string, sourceJobIds: string[]): OutreachCampaign {
  return {
    id,
    workspaceId,
    name: "Campaign",
    campaignType: "Email",
    targetSegment: "Technology owners",
    sourceJobIds,
    ownerUserId: "user-nora",
    sendingDomain: "syncoretech.com",
    mailboxGroup: "syncore",
    status: "Draft",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function sequence(id: string, workspaceId: string, campaignId: string): CampaignSequence {
  return {
    id,
    workspaceId,
    campaignId,
    name: "Sequence",
    targetSegment: "Technology owners",
    defaultDelayRules: "Immediate",
    stopOnReply: true,
    stopOnBounce: true,
    stopOnUnsubscribe: true,
    createdById: "user-nora",
    status: "Active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function step(id: string, workspaceId: string, sequenceId: string): SequenceStep {
  return {
    id,
    workspaceId,
    sequenceId,
    stepNumber: 1,
    channel: "Email",
    delayDays: 0,
    subject: "{{company}} quick question",
    bodyTemplate: "Hi {{first_name}}, hello from Syncore.\n\nUnsubscribe: {{unsubscribe_url}}\n\n{{physical_address}}",
    personalizationVariables: ["first_name", "company"],
    requiredFields: ["email"],
    unsubscribeFooterRequired: true,
    physicalAddress: "Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA",
    complianceStatus: "Compliant",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function sesConnection(workspaceId: string): ProviderConnection {
  return {
    id: "provider-connection-ses",
    workspaceId,
    providerId: "amazon_ses",
    displayName: "Amazon SES",
    status: "Connected",
    enabled: true,
    executionMode: "live",
    categories: ["transactional_email", "outreach_sender"],
    capabilities: ["send_transactional_email"],
    scopes: [],
    allowedOperations: ["send_transactional_email"],
    secretStorage: "Environment",
    secretVersion: 1,
    waterfallOrder: 1,
    lastTestStatus: "Passed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function sentEvent(id: string, contactId: string, campaignId: string): EmailEvent {
  return {
    id,
    workspaceId: "workspace-syncore",
    contactId,
    companyId: "company-a",
    campaignId,
    messageId: `msg-${id}`,
    provider: "Syncore Mail Local",
    senderEmail: "outbound@syncore.tech",
    recipientEmail: `${contactId}@example.com`,
    eventType: "Sent",
    subject: "Subject",
    bodySnapshot: "Body",
    sentAt: "2026-01-01T00:00:00.000Z",
    rawPayload: {}
  };
}

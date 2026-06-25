import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignedBulkEmailContactIds,
  buildDirectEmailSendPlan,
  directEmailBlockReason,
  recordDirectEmailSendResults
} from "@/lib/phase1/direct-email-send";
import { createSeedState } from "@/lib/phase1/seed";
import type {
  AppState,
  Company,
  Contact,
  EmailEvent,
  ProviderConnection,
  SdrAssignment
} from "@/lib/phase1/types";

const envSnapshot = { ...process.env };
const workspaceId = "workspace-syncore";

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

describe("direct SDR email send planning", () => {
  it("plans live SES recipients with signed unsubscribe headers and skips unsafe contacts", () => {
    const state = directState({ liveSes: true });
    state.contacts.push({ ...baseContact("contact-no-email"), email: "" });

    const plan = buildDirectEmailSendPlan(state, {
      workspaceId,
      actor: state.users[1],
      requestId: "direct-req-1",
      mode: "one_to_one",
      contactIds: ["contact-a", "contact-no-email", "missing-contact"],
      subject: "{{company}} quick question",
      body: "Hi {{first_name}}, hello from {{sender_name}}."
    });

    expect(plan.credentialOk).toBe(true);
    expect(plan.recipients).toHaveLength(1);
    expect(plan.skipped).toEqual([
      { contactId: "missing-contact", reason: "Contact not found." },
      { contactId: "contact-no-email", reason: "Contact has no email address." }
    ]);
    expect(plan.recipients[0]).toMatchObject({
      contactId: "contact-a",
      to: "contact-a@example.com",
      from: "Bobby Jones <bobby@syncoretech.com>",
      replyTo: "replies@syncoretech.com",
      subject: "Acme Co quick question"
    });
    expect(plan.recipients[0].headers["List-Unsubscribe"]).toMatch(
      /https:\/\/app\.syncore\.test\/api\/unsubscribe\?c=contact-a&s=[A-Za-z0-9_-]{24}/
    );
    expect(plan.recipients[0].text).toMatch(
      /https:\/\/app\.syncore\.test\/unsubscribe\/contact-a\?s=[A-Za-z0-9_-]{24}/
    );
    expect(plan.recipients[0].html).toContain(">Unsubscribe</a>");
    expect(plan.recipients[0].html).toMatch(
      /<a href="https:\/\/app\.syncore\.test\/unsubscribe\/contact-a\?s=[A-Za-z0-9_-]{24}">Unsubscribe<\/a>/
    );
    expect(plan.recipients[0].html).not.toContain('<a href="<a href=');
    expect(plan.recipients[0].html).not.toContain("Unsubscribe: https://app.syncore.test/unsubscribe/contact-a?s=");
    expect(plan.recipients[0].text).toContain("Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA");
  });

  it("keeps direct request ids idempotent", () => {
    const state = directState({ liveSes: true });
    state.emailEvents = [sentEvent("email-a", "contact-a", "direct-req-1")];

    const plan = buildDirectEmailSendPlan(state, {
      workspaceId,
      actor: state.users[1],
      requestId: "direct-req-1",
      mode: "one_to_one",
      contactIds: ["contact-a"],
      subject: "Hello",
      body: "Hello"
    });

    expect(plan.recipients).toHaveLength(0);
    expect(plan.skipped).toEqual([{ contactId: "contact-a", reason: "Already sent for this request." }]);
  });

  it("selects assigned bulk email contacts by owner and audience", () => {
    const state = directState({ liveSes: true });
    state.contacts[0].priority = "P1";
    state.sdrAssignments[1].assignedSdrId = "user-mina";

    expect(assignedBulkEmailContactIds(state, {
      workspaceId,
      ownerUserId: "user-ari",
      audience: "all_assigned",
      limit: 10
    })).toEqual(["contact-a"]);
    expect(assignedBulkEmailContactIds(state, {
      workspaceId,
      audience: "p1",
      limit: 10
    })).toEqual(["contact-a"]);
  });

  it("records successful direct sends as SES events and marks the SDR assignment touched", () => {
    const state = directState({ liveSes: true });
    const plan = buildDirectEmailSendPlan(state, {
      workspaceId,
      actor: state.users[1],
      requestId: "direct-req-2",
      mode: "sdr_bulk",
      contactIds: ["contact-a"],
      subject: "Hello {{company}}",
      body: "Hi {{first_name}}"
    });
    if (!plan.credentialOk) throw new Error("Expected SES credentials.");

    const summary = recordDirectEmailSendResults(state, {
      workspaceId,
      actorUserId: "user-ari",
      recipients: plan.recipients,
      outcomes: [{ contactId: "contact-a", status: "sent", providerMessageId: "ses-message-1" }],
      skipped: plan.skipped
    });

    expect(summary).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(state.emailEvents[0]).toMatchObject({
      contactId: "contact-a",
      eventType: "Sent",
      provider: "Amazon SES",
      messageId: "ses-message-1",
      senderEmail: "bobby@syncoretech.com",
      rawPayload: {
        directRequestId: "direct-req-2",
        directEmailMode: "sdr_bulk"
      }
    });
    expect(state.sdrAssignments[0]).toMatchObject({
      status: "Contacted",
      touchCount: 1
    });
    expect(state.followUpReminders).toHaveLength(1);
  });

  it("explains why a contact is blocked before sending", () => {
    const contact = { ...baseContact("contact-blocked"), doNotContact: true };
    expect(directEmailBlockReason(contact)).toBe("Contact is marked do-not-contact.");
  });
});

function directState(options: { liveSes: boolean }): AppState {
  const state = createSeedState();
  state.companies = [company("company-a")];
  state.contacts = [baseContact("contact-a"), baseContact("contact-b")];
  state.sdrAssignments = [
    assignment("assign-a", "contact-a", "user-ari"),
    assignment("assign-b", "contact-b", "user-ari")
  ];
  state.followUpReminders = [];
  state.tasks = [];
  state.outreachCampaigns = [];
  state.emailEvents = [];
  state.smsEvents = [];
  state.providerConnections = options.liveSes ? [sesConnection()] : [];
  return state;
}

function company(id: string): Company {
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

function baseContact(id: string): Contact {
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
    status: "Assigned",
    segment: "Technology owners",
    owner: "Ari Patel",
    sourceLineage: ["source:job-a"],
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

function assignment(id: string, contactId: string, assignedSdrId: string): SdrAssignment {
  return {
    id,
    workspaceId,
    companyId: "company-a",
    contactId,
    assignedSdrId,
    assignedById: "user-nora",
    assignmentMethod: "Capacity-based",
    assignmentReason: "Test assignment",
    assignedAt: "2026-01-01T00:00:00.000Z",
    firstTouchDueAt: "2026-01-01T12:00:00.000Z",
    followUpDueAt: undefined,
    status: "Assigned",
    slaStatus: "On track",
    touchCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function sesConnection(): ProviderConnection {
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

function sentEvent(id: string, contactId: string, requestId: string): EmailEvent {
  return {
    id,
    workspaceId,
    contactId,
    companyId: "company-a",
    messageId: `msg-${id}`,
    provider: "Amazon SES",
    senderEmail: "bobby@syncoretech.com",
    recipientEmail: `${contactId}@example.com`,
    eventType: "Sent",
    subject: "Subject",
    bodySnapshot: "Body",
    sentAt: "2026-01-01T00:00:00.000Z",
    rawPayload: { directRequestId: requestId }
  };
}

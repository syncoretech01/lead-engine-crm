import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDirectSmsSendPlan,
  directSmsBlockReason,
  recordDirectSmsSendResults
} from "@/lib/phase1/direct-sms-send";
import { createSeedState } from "@/lib/phase1/seed";
import type { AppState, Company, Contact, SdrAssignment, SmsEvent, User } from "@/lib/phase1/types";

const envSnapshot = { ...process.env };
const workspaceId = "workspace-syncore";

beforeEach(() => {
  process.env.SYNCORE_ENABLE_LIVE_PROVIDERS = "true";
  process.env.RINGCENTRAL_CLIENT_ID = "client";
  process.env.RINGCENTRAL_CLIENT_SECRET = "secret";
  process.env.RINGCENTRAL_JWT = "jwt";
  process.env.RINGCENTRAL_SERVER_URL = "https://platform.ringcentral.test";
  process.env.SYNCORE_RINGCENTRAL_SAM_PHONE_NUMBER = "+18167045551";
});

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("direct SDR SMS send planning", () => {
  it("plans a live RingCentral SMS for an assigned contact with a phone number", () => {
    const state = directState();

    const plan = buildDirectSmsSendPlan(state, {
      workspaceId,
      actor: knownUser("sam"),
      requestId: "sms-req-1",
      contactId: "contact-a",
      body: "Hi {{first_name}}, quick question about {{company}}."
    });

    expect(plan.credentialOk).toBe(true);
    expect(plan.recipients).toEqual([
      {
        requestId: "sms-req-1",
        contactId: "contact-a",
        toNumber: "+15551234567",
        fromNumber: "+18167045551",
        text: "Hi Sam, quick question about Acme Co.",
        senderUserId: "user-sam",
        senderName: "Sam Carter",
        senderEmail: "sam@syncoretech.com"
      }
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("keeps direct SMS request ids idempotent", () => {
    const state = directState();
    state.smsEvents = [sentSmsEvent("sms-a", "contact-a", "sms-req-1")];

    const plan = buildDirectSmsSendPlan(state, {
      workspaceId,
      actor: knownUser("sam"),
      requestId: "sms-req-1",
      contactId: "contact-a",
      body: "Hello"
    });

    expect(plan.recipients).toHaveLength(0);
    expect(plan.skipped).toEqual([{ contactId: "contact-a", reason: "Already sent for this request." }]);
  });

  it("records successful direct sends as RingCentral events and touches the SDR assignment", () => {
    const state = directState();
    const plan = buildDirectSmsSendPlan(state, {
      workspaceId,
      actor: knownUser("sam"),
      requestId: "sms-req-2",
      contactId: "contact-a",
      body: "Hi {{first_name}}"
    });
    if (!plan.credentialOk) throw new Error("Expected RingCentral credentials.");

    const summary = recordDirectSmsSendResults(state, {
      workspaceId,
      actorUserId: "user-sam",
      recipients: plan.recipients,
      outcomes: [{ contactId: "contact-a", status: "sent", providerMessageId: "rc-message-1" }],
      skipped: plan.skipped
    });

    expect(summary).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(state.smsEvents[0]).toMatchObject({
      contactId: "contact-a",
      provider: "RingCentral",
      direction: "Outbound",
      status: "Sent",
      fromNumber: "+18167045551",
      rawPayload: {
        directRequestId: "sms-req-2",
        live: true,
        messageId: "rc-message-1",
        senderEmail: "sam@syncoretech.com"
      }
    });
    expect(state.sdrAssignments[0]).toMatchObject({
      status: "Contacted",
      touchCount: 1
    });
  });

  it("explains why a contact is blocked before SMS sending", () => {
    const state = { suppressionRecords: [] } as unknown as AppState;
    expect(directSmsBlockReason({ ...baseContact("blocked"), phone: "" }, state)).toBe("Contact has no phone number.");
    expect(directSmsBlockReason({ ...baseContact("blocked"), doNotContact: true }, state)).toBe(
      "Contact is marked do-not-contact."
    );
  });

  it("blocks SMS to a phone on the workspace suppression list even when the flag is stale", () => {
    const contact = { ...baseContact("stale-phone"), phone: "+13035551234", isSuppressed: false };
    const state = {
      suppressionRecords: [{ workspaceId: contact.workspaceId, phone: "+13035551234" }]
    } as unknown as AppState;
    expect(directSmsBlockReason(contact, state)).toBe("Contact matches a suppression record.");
  });
});

function directState(): AppState {
  const state = createSeedState();
  state.users.push(knownUser("sam"));
  state.workspaceMembers.push({ id: "member-sam-test", workspaceId, userId: "user-sam", role: "SDR" });
  state.companies = [company("company-a")];
  state.contacts = [baseContact("contact-a")];
  state.sdrAssignments = [assignment("assign-a", "contact-a", "user-sam")];
  state.followUpReminders = [];
  state.tasks = [];
  state.outreachCampaigns = [];
  state.emailEvents = [];
  state.smsEvents = [];
  return state;
}

function knownUser(kind: "sam"): User {
  const map = {
    sam: { id: "user-sam", name: "Sam Carter", email: "sam@syncoretech.com" }
  };
  return { ...map[kind], createdAt: "2026-01-01T00:00:00.000Z" };
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
    phone: "+15551234567",
    grade: "A",
    score: 80,
    priority: "P2",
    status: "Assigned",
    segment: "Technology owners",
    owner: "Sam Carter",
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

function sentSmsEvent(id: string, contactId: string, requestId: string): SmsEvent {
  return {
    id,
    workspaceId,
    contactId,
    companyId: "company-a",
    provider: "RingCentral",
    direction: "Outbound",
    status: "Sent",
    fromNumber: "+18167045551",
    toNumber: "+15551234567",
    body: "Hello",
    sdrUserId: "user-sam",
    optOutFlag: false,
    rawPayload: { directRequestId: requestId },
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

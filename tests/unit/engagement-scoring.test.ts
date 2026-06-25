import { describe, expect, it } from "vitest";
import { applyCampaignEngagementScores, computeCampaignEngagement } from "@/lib/phase1/engagement-scoring";
import { createSeedState } from "@/lib/phase1/seed";
import type { AppState, Company, Contact, EmailEvent, OutreachCampaign } from "@/lib/phase1/types";

describe("campaign engagement scoring", () => {
  it("orders campaign contacts by strongest engagement and ignores other campaigns", () => {
    const state = engagementState();
    state.emailEvents = [
      emailEvent("email-reply", "contact-reply", "campaign-a", "Replied"),
      emailEvent("email-click", "contact-click", "campaign-a", "Clicked"),
      emailEvent("email-open-1", "contact-open", "campaign-a", "Opened"),
      emailEvent("email-open-2", "contact-open", "campaign-a", "Opened"),
      emailEvent("email-delivered", "contact-delivered", "campaign-a", "Delivered"),
      emailEvent("email-sent", "contact-sent", "campaign-a", "Sent"),
      emailEvent("email-other", "contact-sent", "campaign-b", "Replied"),
      emailEvent("email-bounced", "contact-bounced", "campaign-a", "Bounced")
    ];

    const rows = computeCampaignEngagement(state, "workspace-syncore", "campaign-a");

    expect(rows.map((row) => row.contactId)).toEqual([
      "contact-reply",
      "contact-click",
      "contact-open",
      "contact-delivered",
      "contact-sent"
    ]);
    expect(rows.map((row) => row.score)).toEqual([100, 75, 50, 15, 5]);
    expect(rows.find((row) => row.contactId === "contact-bounced")).toBeUndefined();
  });

  it("overwrites deterministic score and priority for Flow B", () => {
    const state = engagementState();
    state.emailEvents = [emailEvent("email-click", "contact-click", "campaign-a", "Clicked")];
    const contact = state.contacts.find((item) => item.id === "contact-click");
    if (!contact) throw new Error("Missing test contact.");
    contact.score = 12;
    contact.priority = "P4";

    const result = applyCampaignEngagementScores(state, "workspace-syncore", "campaign-a", "2026-01-01T00:00:00.000Z");

    expect(result.rescored).toBe(6);
    expect(contact.score).toBe(75);
    expect(contact.priority).toBe("P1");
    expect(contact.fitReason).toBe("Engagement (Clicked) from campaign campaign-a");
  });
});

function engagementState(): AppState {
  const state = createSeedState();
  const workspaceId = "workspace-syncore";
  state.companies = [company("company-a", workspaceId)];
  state.contacts = [
    contact("contact-reply", workspaceId),
    contact("contact-click", workspaceId),
    contact("contact-open", workspaceId),
    contact("contact-delivered", workspaceId),
    contact("contact-sent", workspaceId),
    contact("contact-bounced", workspaceId)
  ];
  state.outreachCampaigns = [
    campaign("campaign-a", workspaceId, ["job-a"]),
    campaign("campaign-b", workspaceId, ["job-a"])
  ];
  state.emailEvents = [];
  state.smsEvents = [];
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

function contact(id: string, workspaceId: string): Contact {
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
    status: "Active",
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

function emailEvent(id: string, contactId: string, campaignId: string, eventType: EmailEvent["eventType"]): EmailEvent {
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
    eventType,
    subject: "Subject",
    bodySnapshot: "Body",
    sentAt: eventType === "Sent" ? "2026-01-01T00:00:00.000Z" : undefined,
    deliveredAt: eventType === "Delivered" ? "2026-01-01T00:00:00.000Z" : undefined,
    openedAt: eventType === "Opened" ? "2026-01-01T00:00:00.000Z" : undefined,
    clickedAt: eventType === "Clicked" ? "2026-01-01T00:00:00.000Z" : undefined,
    repliedAt: eventType === "Replied" ? "2026-01-01T00:00:00.000Z" : undefined,
    bouncedAt: eventType === "Bounced" ? "2026-01-01T00:00:00.000Z" : undefined,
    bounceType: eventType === "Bounced" ? "Hard" : undefined,
    rawPayload: {}
  };
}

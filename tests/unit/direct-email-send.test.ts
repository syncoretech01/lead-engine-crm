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
  SdrAssignment,
  User
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
      actor: knownUser("sam"),
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
      from: "Sam Carter <sam@syncoretech.com>",
      replyTo: "sam@syncoretech.com",
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
      actor: knownUser("sam"),
      requestId: "direct-req-1",
      mode: "one_to_one",
      contactIds: ["contact-a"],
      subject: "Hello",
      body: "Hello"
    });

    expect(plan.recipients).toHaveLength(0);
    expect(plan.skipped).toEqual([{ contactId: "contact-a", reason: "Already sent for this request." }]);
  });

  it("uses the approved owner sender identity for owner direct email", () => {
    const state = directState({ liveSes: true });

    const plan = buildDirectEmailSendPlan(state, {
      workspaceId,
      actor: knownUser("owner"),
      requestId: "direct-owner-1",
      mode: "one_to_one",
      contactIds: ["contact-a"],
      subject: "Hello",
      body: "Hello"
    });

    expect(plan.recipients[0]).toMatchObject({
      from: "Syncore Tech <hello@syncoretech.com>",
      replyTo: "hello@syncoretech.com",
      senderUserId: "user-owner",
      senderEmail: "hello@syncoretech.com"
    });
  });

  it("uses the approved manager sender identity for Bobby direct email", () => {
    const state = directState({ liveSes: true });

    const plan = buildDirectEmailSendPlan(state, {
      workspaceId,
      actor: knownUser("bobby"),
      requestId: "direct-bobby-1",
      mode: "one_to_one",
      contactIds: ["contact-a"],
      subject: "Hello",
      body: "Hello"
    });

    expect(plan.recipients[0]).toMatchObject({
      from: "Bobby Jones <bobby@syncoretech.com>",
      replyTo: "bobby@syncoretech.com",
      senderUserId: "user-bobby",
      senderEmail: "bobby@syncoretech.com"
    });
  });

  /**
   * The bulk-email audience is sorted by SLA urgency and THEN sliced to the send
   * limit, so a stale verdict does not merely mis-order the batch — it changes
   * which leads get emailed at all. The stored slaStatus column only advances on
   * a write, and this path runs off a raw readState() that never refreshes it.
   */
  it("orders the bulk audience by LIVE sla, not the stored column", () => {
    const state = directState({ liveSes: true });
    // Both assignments are stored "On track". Only contact-b has actually
    // lapsed — which the column has not caught up with.
    const lapsed = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const upcoming = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
    state.sdrAssignments = state.sdrAssignments.map((assignment) => ({
      ...assignment,
      status: "Assigned" as const,
      slaStatus: "On track" as const,
      firstTouchedAt: undefined,
      firstTouchDueAt: assignment.contactId === "contact-b" ? lapsed : upcoming
    }));

    const selected = assignedBulkEmailContactIds(state, {
      workspaceId,
      audience: "all_assigned",
      limit: 1
    });

    // With the stale column both weigh the same and the tie falls to input
    // order, so contact-a wins and the genuinely overdue lead goes unemailed.
    expect(selected).toEqual(["contact-b"]);
  });

  // No test for the due_or_overdue FILTER: the live date comparison already
  // beside the stored read covers the same rows, so the filter answers
  // identically either way and any test of it passes without the fix. The
  // stored read was removed there for consistency with the sort, not for
  // correctness.

  it("selects assigned bulk email contacts by owner and audience", () => {
    const state = directState({ liveSes: true });
    state.contacts[0].priority = "P1";
    state.sdrAssignments[1].assignedSdrId = "user-mina";

    expect(assignedBulkEmailContactIds(state, {
      workspaceId,
      ownerUserId: "user-sam",
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
    // A genuine first touch, so it must go out from a lookalike domain (rule 13)
    // — which is the configuration this path is supposed to run under in prod.
    process.env.SYNCORE_ALLOWED_SENDER_DOMAINS = "syncore-reach.test";
    const state = directState({ liveSes: true, cold: true, senderDomain: "syncore-reach.test" });
    const plan = buildDirectEmailSendPlan(state, {
      workspaceId,
      actor: knownUser("bobby"),
      requestId: "direct-req-2",
      mode: "sdr_bulk",
      contactIds: ["contact-a"],
      subject: "Hello {{company}}",
      body: "Hi {{first_name}}"
    });
    if (!plan.credentialOk) throw new Error("Expected SES credentials.");

    const summary = recordDirectEmailSendResults(state, {
      workspaceId,
      actorUserId: "user-bobby",
      recipients: plan.recipients,
      outcomes: [{ contactId: "contact-a", status: "sent", providerMessageId: "ses-message-1" }],
      skipped: plan.skipped
    });

    expect(summary).toMatchObject({ sent: 1, failed: 0, skipped: 0, skippedReasons: [] });
    expect(state.emailEvents[0]).toMatchObject({
      contactId: "contact-a",
      eventType: "Sent",
      provider: "Amazon SES",
      messageId: "ses-message-1",
      senderEmail: "sam@syncore-reach.test",
      rawPayload: {
        directRequestId: "direct-req-2",
        directEmailMode: "sdr_bulk",
        senderUserId: "user-sam"
      }
    });
    expect(state.sdrAssignments[0]).toMatchObject({
      status: "Contacted",
      touchCount: 1
    });
    expect(state.followUpReminders).toHaveLength(1);
  });

  /**
   * Golden rules 8 and 13 on the SECOND live cold-send path.
   *
   * The campaign sender got these guards; this one did not, and every rep
   * identity resolves to the primary domain by default — so every bulk send to a
   * pre-touch contact was cold-sending from syncoretech.com with the rule
   * believed enforced. These are the tests that would have caught that.
   */
  describe("cold-send rules on the SDR path", () => {
    it("refuses a cold first touch from the primary domain (rule 13)", () => {
      const state = directState({ liveSes: true, cold: true });

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "cold-1",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Hello",
        body: "Hi {{first_name}}"
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("syncoretech.com");
      expect(plan.skipped[0].reason).toContain("golden rule 13");
    });

    it("still sends to an already-EMAILED lead from the primary domain", () => {
      // The rule binds cold touch 1, not the follow-up conversation. Blocking
      // warm replies would take the whole SDR workflow down with it.
      const state = directState({ liveSes: true, cold: false });

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "warm-1",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Following up",
        body: "Circling back, {{first_name}}."
      });

      expect(plan.recipients).toHaveLength(1);
      expect(plan.recipients[0].from).toBe("Sam Carter <sam@syncoretech.com>");
    });

    it("refuses a cold bulk touch carrying a link (rule 8)", () => {
      process.env.SYNCORE_ALLOWED_SENDER_DOMAINS = "syncore-reach.test";
      const state = directState({ liveSes: true, cold: true, senderDomain: "syncore-reach.test" });

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "cold-link-1",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Quick question",
        body: "Hi {{first_name}}, see https://syncore-reach.test/demo for details."
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("golden rule 8");
      expect(plan.skipped[0].reason).toContain("https://syncore-reach.test/demo");
    });

    it("does not count the auto-appended unsubscribe link against rule 8", () => {
      process.env.SYNCORE_ALLOWED_SENDER_DOMAINS = "syncore-reach.test";
      const state = directState({ liveSes: true, cold: true, senderDomain: "syncore-reach.test" });

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "cold-clean-1",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Quick question",
        body: "Hi {{first_name}}, worth a chat? {{unsubscribe_url}}"
      });

      expect(plan.recipients).toHaveLength(1);
      // The renderer still appends the real unsubscribe link.
      expect(plan.recipients[0].text).toContain("/unsubscribe/contact-a?s=");
    });

    // The bypasses that made the first version of this guard fail to fire on
    // most real cold leads. Each was demonstrated end to end before it was fixed.
    it("treats a lead as cold even when the assignment claims touchCount 1", () => {
      // sdr.ts:172 FABRICATES touchCount 1 and a firstTouchedAt dated a day
      // before assignment for any lead whose status is not "Assigned" — "New"
      // and "Working" both qualify. A predicate built on either field answers
      // "warm" for a lead nobody has ever contacted.
      const state = directState({ liveSes: true, cold: true });
      state.sdrAssignments[0] = {
        ...state.sdrAssignments[0],
        status: "New",
        touchCount: 1,
        firstTouchedAt: "2025-12-31T13:00:00.000Z"
      };

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "fabricated-touch",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Hello",
        body: "Hi {{first_name}}"
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("golden rule 13");
    });

    it("treats a lead as cold when the only prior touch was a phone call", () => {
      // recordFirstTouch is channel-agnostic, so an unanswered dial bumps
      // touchCount and flips the status to Contacted. One dial does not make the
      // first EMAIL a warm reply.
      const state = directState({ liveSes: true, cold: true });
      state.sdrAssignments[0] = {
        ...state.sdrAssignments[0],
        status: "Contacted",
        touchCount: 1,
        firstTouchedAt: "2026-02-01T10:00:00.000Z"
      };

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "dialed-then-emailed",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Following up on my call",
        body: "Hi {{first_name}}"
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("golden rule 13");
    });

    it("catches a link the rep's signature appends after the template passes", () => {
      process.env.SYNCORE_ALLOWED_SENDER_DOMAINS = "syncore-reach.test";
      const state = directState({ liveSes: true, cold: true, senderDomain: "syncore-reach.test" });
      state.users = state.users.map((user) =>
        user.id === "user-sam" ? { ...user, emailSignature: "Sam | Book time: https://calendly.com/sam" } : user
      );

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "signature-link",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Quick question",
        body: "Hi {{first_name}}, worth a chat?"
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("https://calendly.com/sam");
    });

    it("catches a link smuggled in through a merge token", () => {
      // Local-business CSV imports routinely carry a website in the name field,
      // and {{company}} substitutes it in AFTER a template-only scan has passed.
      process.env.SYNCORE_ALLOWED_SENDER_DOMAINS = "syncore-reach.test";
      const state = directState({ liveSes: true, cold: true, senderDomain: "syncore-reach.test" });
      state.companies[0] = { ...state.companies[0], name: "www.acme-deals.test" };

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "token-link",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Question about {{company}}",
        body: "Hi {{first_name}}, worth a chat?"
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("www.acme-deals.test");
    });

    it("catches a link appended to the exempt unsubscribe URL", () => {
      // {{unsubscribe_url}} is a documented token, so no guessing is needed:
      // appending "@evil.test/pwn" to it renders ONE url whose authority is
      // evil.test — everything before the "@" is userinfo. Stripping the exempt
      // URL as a substring left "@evil.test/pwn", which matched nothing.
      process.env.SYNCORE_ALLOWED_SENDER_DOMAINS = "syncore-reach.test";
      const state = directState({ liveSes: true, cold: true, senderDomain: "syncore-reach.test" });

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "userinfo-smuggle",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Quick question",
        body: "Hi {{first_name}}, worth a chat? {{unsubscribe_url}}@evil.test/pwn"
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("evil.test");
    });

    it("does not accept a simulated or seeded send as prior contact", () => {
      // simulateCampaignSend, seedOutreachEvents (which runs on any READ of a
      // workspace with no email events) and recordEmailEventAction all write
      // eventType "Sent" with provider "Syncore Mail Local" and send no mail.
      // Trusting those marks an untouched contact warm and turns both rules off.
      const state = directState({ liveSes: true, cold: true });
      state.emailEvents = [{ ...sentEvent("email-sim", "contact-a", "sim"), provider: "Syncore Mail Local" }];

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "simulated-history",
        mode: "sdr_bulk",
        contactIds: ["contact-a"],
        subject: "Hello",
        body: "Hi {{first_name}}"
      });

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain("golden rule 13");
    });

    it("carries the skip reason into the send summary", () => {
      // Without this the rep clicks Send and sees nothing: both actions return
      // void, and the audit row said only "skipped: 2".
      const state = directState({ liveSes: true, cold: true });

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        actor: knownUser("sam"),
        requestId: "reason-surfaced",
        mode: "sdr_bulk",
        contactIds: ["contact-a", "contact-b"],
        subject: "Hello",
        body: "Hi {{first_name}}"
      });

      const summary = recordDirectEmailSendResults(state, {
        workspaceId,
        actorUserId: "user-sam",
        recipients: plan.recipients,
        outcomes: [],
        skipped: plan.skipped
      });

      expect(summary.skipped).toBe(2);
      expect(summary.skippedReasons).toHaveLength(1);
      expect(summary.skippedReasons[0]).toMatchObject({ count: 2 });
      expect(summary.skippedReasons[0].reason).toContain("golden rule 13");
    });

    it("leaves a 1:1 email alone — rule 8 binds AUTOMATED touch 1", () => {
      process.env.SYNCORE_ALLOWED_SENDER_DOMAINS = "syncore-reach.test";
      const state = directState({ liveSes: true, cold: true, senderDomain: "syncore-reach.test" });

      const plan = buildDirectEmailSendPlan(state, {
        workspaceId,
        // 1:1 sends from the ACTOR, not the assigned rep, so the actor is the
        // one that has to be on the lookalike domain here.
        actor: { ...knownUser("sam"), email: "sam@syncore-reach.test" },
        requestId: "one-to-one-link",
        mode: "one_to_one",
        contactIds: ["contact-a"],
        subject: "As promised",
        body: "Here is the deck: https://syncore-reach.test/deck"
      });

      expect(plan.recipients).toHaveLength(1);
    });
  });

  it("explains why a contact is blocked before sending", () => {
    const contact = { ...baseContact("contact-blocked"), doNotContact: true };
    const state = { suppressionRecords: [] } as unknown as AppState;
    expect(directEmailBlockReason(contact, state)).toBe("Contact is marked do-not-contact.");
  });

  it("blocks a contact whose email is on the suppression list even when the flag is stale", () => {
    const contact = { ...baseContact("stale-email"), email: "opted-out@example.com", isSuppressed: false };
    const state = {
      suppressionRecords: [{ workspaceId: contact.workspaceId, email: "opted-out@example.com" }]
    } as unknown as AppState;
    expect(directEmailBlockReason(contact, state)).toBe("Contact matches a suppression record.");
  });

  it("skips contacts when the sender user has no approved identity", () => {
    const state = directState({ liveSes: true });

    const plan = buildDirectEmailSendPlan(state, {
      workspaceId,
      actor: state.users[1],
      requestId: "direct-req-no-sender",
      mode: "one_to_one",
      contactIds: ["contact-a"],
      subject: "Hello",
      body: "Hello"
    });

    expect(plan.recipients).toHaveLength(0);
    expect(plan.skipped).toEqual([
      { contactId: "contact-a", reason: "No approved sending email is configured for Ari Patel." }
    ]);
  });
});

/**
 * @param cold          make this a genuine cold touch 1 — no prior email in the
 *                      history — so golden rules 8 and 13 bind. Defaults to
 *                      false: most of these tests are about sender identity and
 *                      unsubscribe headers, which apply to warm sends too, and a
 *                      cold fixture would make them fail for an unrelated reason.
 *
 *                      Warm means a prior SENT EmailEvent, not an assignment
 *                      status. The assignment fields cannot carry this: sdr.ts
 *                      fabricates touchCount/firstTouchedAt at assignment time,
 *                      and a logged phone call increments touchCount without an
 *                      email ever having been sent.
 * @param senderDomain  move the reps onto a lookalike domain, the configuration
 *                      rule 13 actually requires for cold sending.
 */
function directState(options: { liveSes: boolean; cold?: boolean; senderDomain?: string }): AppState {
  const state = createSeedState();
  state.users.push(knownUser("bobby"), knownUser("sam"));
  state.workspaceMembers.push(
    { id: "member-bobby-test", workspaceId, userId: "user-bobby", role: "Manager" },
    { id: "member-sam-test", workspaceId, userId: "user-sam", role: "SDR" }
  );
  state.companies = [company("company-a")];
  state.contacts = [baseContact("contact-a"), baseContact("contact-b")];
  state.sdrAssignments = [
    assignment("assign-a", "contact-a", "user-sam", options.cold ?? false),
    assignment("assign-b", "contact-b", "user-sam", options.cold ?? false)
  ];
  if (options.senderDomain) {
    state.users = state.users.map((user) => ({
      ...user,
      email: user.email.replace(/@.*$/, `@${options.senderDomain}`)
    }));
  }
  state.followUpReminders = [];
  state.tasks = [];
  state.outreachCampaigns = [];
  // A prior send is what makes a contact warm. Given a distinct request id so it
  // does not also trip the per-request idempotency skip.
  state.emailEvents = options.cold
    ? []
    : [sentEvent("email-history-a", "contact-a", "historic-req"), sentEvent("email-history-b", "contact-b", "historic-req")];
  state.smsEvents = [];
  state.providerConnections = options.liveSes ? [sesConnection()] : [];
  return state;
}

function knownUser(kind: "bobby" | "sam" | "owner"): User {
  const map = {
    bobby: { id: "user-bobby", name: "Bobby Jones", email: "bobby@syncoretech.com" },
    sam: { id: "user-sam", name: "Sam Carter", email: "sam@syncoretech.com" },
    owner: { id: "user-owner", name: "Syncore Tech", email: "hello@syncoretech.com" }
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

function assignment(id: string, contactId: string, assignedSdrId: string, cold = false): SdrAssignment {
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
    // Pre-touch (cold) vs already contacted (warm) — the distinction rules 8
    // and 13 turn on.
    status: cold ? "Assigned" : "Contacted",
    slaStatus: "On track",
    touchCount: cold ? 0 : 1,
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

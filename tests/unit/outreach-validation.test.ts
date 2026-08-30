import { describe, expect, it } from "vitest";

import {
  assertNoLinksInColdTouchOne,
  coldSendMailboxBlockReason,
  findColdTouchLinks
} from "@/lib/phase1/outreach-validation";

describe("cold-send mailbox rules (rule 13)", () => {
  it("refuses a live send when SYNCORE_OUTREACH_FROM is unset", () => {
    const reason = coldSendMailboxBlockReason({
      fromEnv: undefined,
      from: "Bobby Jones <bobby@syncoretech.com>",
      replyTo: "replies@syncoretech.com"
    });
    expect(reason).toMatch(/SYNCORE_OUTREACH_FROM is not set/);
  });

  it("refuses the primary domain in From, even when deliberately configured", () => {
    const reason = coldSendMailboxBlockReason({
      fromEnv: "Bobby Jones <bobby@syncoretech.com>",
      from: "Bobby Jones <bobby@syncoretech.com>",
      replyTo: "replies@syncore-outreach.com"
    });
    expect(reason).toMatch(/syncoretech\.com/);
  });

  it("refuses subdomains of the primary domain and a primary-domain Reply-To", () => {
    expect(
      coldSendMailboxBlockReason({
        fromEnv: "x",
        from: "Team <hello@mail.syncoretech.com>",
        replyTo: "replies@syncore-outreach.com"
      })
    ).toMatch(/syncoretech\.com/);
    expect(
      coldSendMailboxBlockReason({
        fromEnv: "x",
        from: "Bobby <bobby@syncore-outreach.com>",
        replyTo: "replies@syncoretech.com"
      })
    ).toMatch(/Reply-To/);
  });

  it("allows a lookalike-domain pair", () => {
    expect(
      coldSendMailboxBlockReason({
        fromEnv: "Bobby Jones <bobby@syncore-outreach.com>",
        from: "Bobby Jones <bobby@syncore-outreach.com>",
        replyTo: "replies@syncore-outreach.com"
      })
    ).toBeNull();
  });
});

describe("no link in cold touch 1 (rule 8)", () => {
  it("finds http, https and www links", () => {
    expect(findColdTouchLinks("See https://example.com/deck and www.example.org today")).toEqual([
      "https://example.com/deck",
      "www.example.org"
    ]);
  });

  it("exempts the renderer's compliance tokens", () => {
    expect(findColdTouchLinks("Hi {{first_name}}.\n\nUnsubscribe: {{unsubscribe_url}}\n{{physical_address}}")).toEqual([]);
  });

  it("does not flag plain prose or bare company names", () => {
    expect(findColdTouchLinks("We help freight brokers at Acme Logistics fill trucks faster.")).toEqual([]);
  });

  it("counts protocol-relative URLs, which render as live anchors", () => {
    // Excluding these left a link shape that passed the rule while behaving
    // exactly like the ones it forbids in every mail client.
    expect(findColdTouchLinks("Book here: //calendly.test/sam")).toEqual(["//calendly.test/sam"]);
  });

  it("exempts a compliance URL only as a WHOLE link, never as a prefix", () => {
    const unsubscribe = "https://app.syncore.test/unsubscribe/contact-a?s=TOKEN123";

    // The clean case: the exact link is exempt.
    expect(findColdTouchLinks(`Hi.\n\nUnsubscribe: ${unsubscribe}`, [unsubscribe])).toEqual([]);

    // The bypass: appending to the exempt URL makes ONE link whose authority is
    // evil.test — everything before the "@" is userinfo. Stripping the exempt
    // URL as a substring left "@evil.test/pwn", which matched nothing.
    const smuggled = `Hi.\n\nUnsubscribe: ${unsubscribe}@evil.test/pwn`;
    expect(findColdTouchLinks(smuggled, [unsubscribe])).toEqual([`${unsubscribe}@evil.test/pwn`]);
  });

  it("keeps the exemption when the writer puts a full stop after the URL", () => {
    // An operator placing the token inline — which is what a compliance-minded
    // one does — made the renderer skip its own append, so the punctuation ended
    // up inside the matched link and broke the equality check. The result was a
    // block on legitimate copy, with a message naming the unsubscribe link while
    // saying the unsubscribe link does not count.
    const unsubscribe = "https://app.syncore.test/unsubscribe/contact-a?s=TOKEN123";

    for (const trailing of [".", ",", ";", "!", "?", "'", "*", "]"]) {
      expect(
        findColdTouchLinks(`To opt out, visit ${unsubscribe}${trailing}`, [unsubscribe]),
        `trailing ${JSON.stringify(trailing)} should stay exempt`
      ).toEqual([]);
    }
  });

  it("still reports a real link that merely ends a sentence", () => {
    expect(findColdTouchLinks("Book at https://calendly.test/sam.")).toEqual(["https://calendly.test/sam"]);
  });

  it("blocks a linked template and passes a clean one", () => {
    expect(() => assertNoLinksInColdTouchOne("Quick question", "Book time: https://cal.example.com/me")).toThrow(
      /rule 8/
    );
    expect(() => assertNoLinksInColdTouchOne("Quick question", "Hi {{first_name}}, worth a chat?")).not.toThrow();
  });
});

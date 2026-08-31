import { describe, expect, it } from "vitest";

import { statusTone } from "@/components/status-pill";

/**
 * statusTone matches SUBSTRINGS, which is why it needs tests more than most
 * pure functions: every new label silently inherits the tone of any word it
 * happens to contain, and the failure is visual rather than a crash.
 *
 * "Not interested" contains "interested" and was rendering the same green pill
 * as "Meeting booked" — on /outreach/events, in the panel whose headline number
 * is call wins. Nobody notices a wrong colour in a code review.
 */
describe("status tone", () => {
  it("does not read a negation as its positive", () => {
    expect(statusTone("Not interested")).toBe("danger");
    expect(statusTone("Do not contact")).toBe("danger");
  });

  it("keeps the genuine positives positive", () => {
    expect(statusTone("Interested")).toBe("success");
    expect(statusTone("Meeting booked")).toBe("success");
    expect(statusTone("Qualified")).toBe("success");
  });

  it("treats a bare Connected as a fact, not an outcome", () => {
    // It shares this vocabulary with "Interested" and "Meeting booked". Colouring
    // it the same green makes the glance say something the number does not.
    expect(statusTone("Connected")).toBe("info");
  });

  it("still treats connection-flavoured system states as healthy", () => {
    // The bare-label check must not swallow these: they are about a provider or
    // an integration being up, not about a call outcome.
    expect(statusTone("Connected · live")).toBe("success");
    expect(statusTone("Operational")).toBe("success");
  });

  it("keeps the tones that other surfaces depend on", () => {
    expect(statusTone("Overdue")).toBe("warning");
    expect(statusTone("Failed")).toBe("danger");
    expect(statusTone("Working")).toBe("info");
  });
});

import { describe, expect, it } from "vitest";

import { retainFocusCallLead } from "@/components/crm/cockpit/focus/focus-types";

describe("Focus call lead retention", () => {
  const calledLead = { id: "contact-called", name: "Called contact" };
  const nextLead = { id: "contact-next", name: "Next contact" };

  it("keeps the called lead when a queue refresh removes it before wrap-up", () => {
    expect(retainFocusCallLead(calledLead, [nextLead], calledLead.id, true)).toBe(calledLead);
  });

  it("prefers the refreshed version of the called lead while it remains in the queue", () => {
    const refreshed = { ...calledLead, name: "Updated contact" };
    expect(retainFocusCallLead(calledLead, [refreshed, nextLead], calledLead.id, true)).toBe(refreshed);
  });

  it("releases the called lead only after the call lifecycle is reset", () => {
    expect(retainFocusCallLead(calledLead, [nextLead], calledLead.id, false)).toBeNull();
  });

  it("never reuses a retained lead for a different call", () => {
    expect(retainFocusCallLead(calledLead, [nextLead], nextLead.id, true)).toBe(nextLead);
  });
});

import { describe, expect, it } from "vitest";
import { partitionLeadsForAssignment } from "@/lib/phase1/lead-gate";
import type { Contact } from "@/lib/phase1/types";

function contact(overrides: Partial<Contact>): Contact {
  return {
    id: "x",
    workspaceId: "ws",
    name: "X",
    email: "x@y.com",
    phone: "+15551234567",
    grade: "A",
    priority: "P2",
    isSuppressed: false,
    ...overrides
  } as Contact;
}

describe("partitionLeadsForAssignment", () => {
  it("holds suppressed, priority-S, low-grade, and missing-required leads", () => {
    const contacts = [
      contact({ id: "ok" }),
      contact({ id: "supp", isSuppressed: true }),
      contact({ id: "low", grade: "D" }),
      contact({ id: "skip", priority: "S" }),
      contact({ id: "noemail", email: "" })
    ];

    const result = partitionLeadsForAssignment({ contacts, requiredFields: ["email", "phone"] });

    expect(result.ready.map((item) => item.id)).toEqual(["ok"]);
    expect(result.held).toHaveLength(4);
    expect(result.reasons.reduce((total, entry) => total + entry.count, 0)).toBe(4);
  });

  it("does not require email/phone unless the profile says so", () => {
    const result = partitionLeadsForAssignment({ contacts: [contact({ id: "noemail", email: "" })] });
    expect(result.ready.map((item) => item.id)).toEqual(["noemail"]);
  });
});

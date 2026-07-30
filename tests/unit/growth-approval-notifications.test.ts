import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approvalNotificationEventId } from "@/lib/growth/approval-notifications";

describe("approval notification business identities", () => {
  it("derives the deterministic delivery identity from event meaning and immutable approval id", () => {
    const expected = `evt_${createHash("sha256")
      .update("approval-requested:apr_1", "utf8")
      .digest("hex")}`;
    expect(approvalNotificationEventId("approval-requested", "apr_1")).toBe(expected);
    expect(approvalNotificationEventId("approval-requested", "apr_1")).toBe(expected);
  });

  it("keeps requested, second-approver, revised, and final events distinct", () => {
    const ids = [
      "approval-requested",
      "approval-awaiting-second",
      "approval-revised",
      "approval-decided"
    ].map((kind) => approvalNotificationEventId(kind, "apr_1"));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

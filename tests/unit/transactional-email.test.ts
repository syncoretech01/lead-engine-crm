import { describe, expect, it } from "vitest";
import { inviteEmail, passwordResetEmail, sendTransactionalEmailForState } from "@/lib/phase1/transactional-email-service";
import type { AppState } from "@/lib/phase1/types";

describe("transactional email templates", () => {
  it("builds an invite email with the link", () => {
    const email = inviteEmail({ to: "sam@x.com", url: "/invite/abc", workspaceName: "Syncore Outbound" });
    expect(email.to).toBe("sam@x.com");
    expect(email.subject).toContain("Syncore Outbound");
    expect(email.html).toContain("/invite/abc");
    expect(email.text).toContain("/invite/abc");
  });

  it("builds a password reset email with the link", () => {
    const email = passwordResetEmail({ to: "sam@x.com", url: "/reset-password/xyz" });
    expect(email.subject.toLowerCase()).toContain("reset");
    expect(email.html).toContain("/reset-password/xyz");
  });
});

describe("sendTransactionalEmailForState", () => {
  it("skips when no live Amazon SES connection exists", async () => {
    const state = { providerConnections: [] } as unknown as AppState;
    const result = await sendTransactionalEmailForState(state, {
      email: inviteEmail({ to: "a@b.com", url: "/invite/x" })
    });
    expect(result.status).toBe("skipped");
  });

  it("skips when the SES connection is in mock mode", async () => {
    const state = {
      providerConnections: [{ providerId: "amazon_ses", workspaceId: "ws", enabled: true, executionMode: "mock" }]
    } as unknown as AppState;
    const result = await sendTransactionalEmailForState(state, {
      email: inviteEmail({ to: "a@b.com", url: "/invite/x" }),
      workspaceId: "ws"
    });
    expect(result.status).toBe("skipped");
  });
});

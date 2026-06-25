import { describe, expect, it } from "vitest";
import {
  buildOneClickUnsubscribeUrl,
  buildUnsubscribeUrl,
  signShortUnsubscribeToken,
  signUnsubscribeToken,
  verifyShortUnsubscribeToken,
  verifyUnsubscribeToken
} from "@/lib/phase1/unsubscribe-token";

const env = {
  SYNCORE_UNSUBSCRIBE_SECRET: "test-secret",
  SYNCORE_APP_URL: "https://app.syncore.test/"
};

describe("unsubscribe tokens", () => {
  it("signs and verifies workspace/contact pairs", () => {
    const token = signUnsubscribeToken("workspace-a", "contact-a", env);
    expect(verifyUnsubscribeToken(token, env)).toEqual({
      ok: true,
      workspaceId: "workspace-a",
      contactId: "contact-a"
    });
  });

  it("rejects tampered payloads and signatures", () => {
    const token = signUnsubscribeToken("workspace-a", "contact-a", env);
    const [payload, signature] = token.split(".");

    expect(verifyUnsubscribeToken(`x${payload}.${signature}`, env)).toEqual({ ok: false });
    expect(verifyUnsubscribeToken(`${payload}.x${signature}`, env)).toEqual({ ok: false });
  });

  it("signs and verifies short contact-bound tokens", () => {
    const token = signShortUnsubscribeToken("contact-a", env);

    expect(token).toHaveLength(24);
    expect(verifyShortUnsubscribeToken("contact-a", token, env)).toBe(true);
    expect(verifyShortUnsubscribeToken("contact-b", token, env)).toBe(false);
    expect(verifyShortUnsubscribeToken("contact-a", `x${token.slice(1)}`, env)).toBe(false);
  });

  it("lets callers catch a wrong-contact route mismatch", () => {
    const token = signUnsubscribeToken("workspace-a", "contact-a", env);
    const result = verifyUnsubscribeToken(token, env);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contactId).not.toBe("contact-b");
    }
  });

  it("builds public unsubscribe URLs", () => {
    const url = buildUnsubscribeUrl("workspace-a", "contact-a", env);
    const oneClick = buildOneClickUnsubscribeUrl("workspace-a", "contact-a", env);

    expect(url).toMatch(/^https:\/\/app\.syncore\.test\/unsubscribe\/contact-a\?s=[A-Za-z0-9_-]{24}$/);
    expect(oneClick).toMatch(/^https:\/\/app\.syncore\.test\/api\/unsubscribe\?c=contact-a&s=[A-Za-z0-9_-]{24}$/);
  });
});

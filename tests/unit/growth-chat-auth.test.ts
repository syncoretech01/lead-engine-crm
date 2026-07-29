import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_ACTOR_HEADER,
  CHAT_WORKSPACE_HEADER,
  authenticateChatRequest
} from "@/lib/growth/chat-auth";

const TOKEN = "chat-token-abcdefghijklmnop";
const original = process.env.SYNCORE_CHAT_API_TOKEN;

const headers = (init: Record<string, string>) => new Headers(init);
const valid = (extra: Record<string, string> = {}) =>
  headers({
    authorization: `Bearer ${TOKEN}`,
    [CHAT_ACTOR_HEADER]: "usr_operator",
    ...extra
  });

beforeEach(() => {
  process.env.SYNCORE_CHAT_API_TOKEN = TOKEN;
});

afterEach(() => {
  if (original === undefined) delete process.env.SYNCORE_CHAT_API_TOKEN;
  else process.env.SYNCORE_CHAT_API_TOKEN = original;
});

describe("chat API bearer auth", () => {
  it("accepts a correct token and resolves the actor", () => {
    const result = authenticateChatRequest(valid());
    expect(result.ok).toBe(true);
    expect(result.ok && result.actorId).toBe("usr_operator");
  });

  it("resolves the workspace header when present", () => {
    const result = authenticateChatRequest(valid({ [CHAT_WORKSPACE_HEADER]: "ws_1" }));
    expect(result.ok && result.workspaceId).toBe("ws_1");
  });

  it("returns a null workspace rather than failing when absent", () => {
    // niche-request takes its workspace from the validated body; only the
    // approval routes require the header, and each states its own requirement.
    const result = authenticateChatRequest(valid());
    expect(result.ok).toBe(true);
    expect(result.ok && result.workspaceId).toBe(null);
  });

  it("rejects a wrong token", () => {
    const result = authenticateChatRequest(
      headers({ authorization: "Bearer wrong-token-aaaaaaaaaaa", [CHAT_ACTOR_HEADER]: "usr_1" })
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(401);
  });

  it("rejects a token of a different length without throwing", () => {
    // timingSafeEqual throws on unequal lengths; the length guard must come first.
    expect(() =>
      authenticateChatRequest(headers({ authorization: "Bearer x", [CHAT_ACTOR_HEADER]: "usr_1" }))
    ).not.toThrow();
    expect(
      authenticateChatRequest(headers({ authorization: "Bearer x", [CHAT_ACTOR_HEADER]: "usr_1" })).ok
    ).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(authenticateChatRequest(headers({ [CHAT_ACTOR_HEADER]: "usr_1" })).ok).toBe(false);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(
      authenticateChatRequest(
        headers({ authorization: `Basic ${TOKEN}`, [CHAT_ACTOR_HEADER]: "usr_1" })
      ).ok
    ).toBe(false);
  });

  it("rejects a request with no acting human", () => {
    // An approval whose decidedBy is "system" is an audit trail that cannot
    // answer who approved the spend — the one question it exists to answer.
    const result = authenticateChatRequest(headers({ authorization: `Bearer ${TOKEN}` }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(CHAT_ACTOR_HEADER);
  });

  it("rejects a blank acting human", () => {
    expect(authenticateChatRequest(valid({ [CHAT_ACTOR_HEADER]: "   " })).ok).toBe(false);
  });

  it("fails CLOSED when the token is not configured", () => {
    // The failure mode being guarded against is `if (token && token !== given)`,
    // where an unset secret silently means "allow everyone".
    delete process.env.SYNCORE_CHAT_API_TOKEN;
    const result = authenticateChatRequest(valid());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(500);
  });

  it("fails closed on an empty-string token", () => {
    process.env.SYNCORE_CHAT_API_TOKEN = "";
    const result = authenticateChatRequest(headers({ authorization: "Bearer " }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(500);
  });
});

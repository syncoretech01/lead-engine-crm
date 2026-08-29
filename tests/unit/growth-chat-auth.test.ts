import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_ACTOR_HEADER,
  CHAT_WORKSPACE_HEADER,
  authenticateChatRequest,
  authorizeChatApprovalActor,
  authorizeChatWorkspaceActor
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

describe("chat approval workspace authorization", () => {
  const authorize = (role: string | null) =>
    authorizeChatApprovalActor(
      { ok: true, actorId: "usr_operator", workspaceId: "ws_1" },
      {
        workspaceMember: {
          findUnique: async () => (role ? { role } : null)
        }
      } as never
    );

  it.each(["ADMIN", "MANAGER"])("accepts a workspace %s with approval permission", async (role) => {
    await expect(authorize(role)).resolves.toMatchObject({
      ok: true,
      actorId: "usr_operator",
      workspaceId: "ws_1"
    });
  });

  it.each([null, "SDR", "VIEWER", "DATA_OPERATOR", "COMPLIANCE_ADMIN"])(
    "rejects missing or unauthorized workspace role %s",
    async (role) => {
      await expect(authorize(role)).resolves.toMatchObject({ ok: false, status: 403 });
    }
  );
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

/**
 * The niche-request route takes its workspaceId from the request BODY, and the
 * chat bearer is a single shared secret — it says "a bot is calling", not "this
 * actor may write here". Without this binding a leaked bearer (or a bot bug)
 * could create records in any workspace, including the stale legacy one,
 * attributed to an arbitrary actor id.
 */
describe("chat workspace actor authorization", () => {
  const authorize = (role: string | null) =>
    authorizeChatWorkspaceActor(
      { actorId: "usr_operator", workspaceId: "ws_1" },
      {
        workspaceMember: {
          findUnique: async () => (role ? { role } : null)
        }
      } as never
    );

  it.each(["ADMIN", "MANAGER", "SDR", "DATA_OPERATOR", "COMPLIANCE_ADMIN"])(
    "accepts a workspace member with role %s — raising a request is weaker than deciding one",
    async (role) => {
      await expect(authorize(role)).resolves.toEqual({ ok: true });
    }
  );

  it("rejects an actor who is not a member of the requested workspace", async () => {
    await expect(authorize(null)).resolves.toMatchObject({
      ok: false,
      status: 403,
      error: expect.stringContaining("not a member")
    });
  });

  it("rejects VIEWER — a chat surface must not route around a read-only role", async () => {
    await expect(authorize("VIEWER")).resolves.toMatchObject({
      ok: false,
      status: 403,
      error: expect.stringContaining("read-only")
    });
  });

  it("scopes the lookup to the asserted actor and workspace, never a wildcard", async () => {
    const seen: unknown[] = [];
    await authorizeChatWorkspaceActor(
      { actorId: "usr_operator", workspaceId: "ws_1" },
      {
        workspaceMember: {
          findUnique: async (args: unknown) => {
            seen.push(args);
            return { role: "SDR" };
          }
        }
      } as never
    );
    expect(seen).toEqual([
      { where: { workspaceId_userId: { workspaceId: "ws_1", userId: "usr_operator" } }, select: { role: true } }
    ]);
  });
});

import { timingSafeEqual } from "node:crypto";
import type { GrowthPrismaClient } from "@/lib/growth/repositories/client";
import { growthPrisma } from "@/lib/growth/repositories/client";

/**
 * Bearer auth for the chat-surface API (v9.1 §9.4, §23).
 *
 * The caller is the bot — one machine client, not a human — so this is M2M
 * bearer with a constant-time compare, matching every other M2M edge in the
 * system (§23: "bearer + constant-time for all M2M").
 *
 * ── The acting human ────────────────────────────────────────────────────────
 *
 * Contracts deliberately keeps `decidedBy` out of `ApprovalDecide`: "a
 * `decidedBy` in the request would be a body claiming who you are." So the
 * acting human arrives in a header the bot sets, `X-Syncore-Actor-Id`, resolved
 * on its side from the chat-identity mapping (§15).
 *
 * ⚠️ THE TRUST MODEL, STATED PLAINLY: this trusts the bot to report the actor
 * honestly. The bearer proves the caller is the bot; nothing proves the bot
 * named the right human. For the pilot that is exactly what "the bot is a remote
 * control, not a system of record" means — the mapping lives there, and the CRM
 * records what it is told.
 *
 * It is worth knowing where that stops being enough: the moment more than one
 * operator can decide, or two-person approval has to resist a compromised bot,
 * a shared bearer is no longer sufficient and the actor needs to come from
 * per-user credentials or a signed assertion rather than a header. Recorded here
 * rather than discovered later.
 */

export const CHAT_ACTOR_HEADER = "x-syncore-actor-id";

/**
 * The workspace the call acts on.
 *
 * A header rather than a body field because `ApprovalDecide` and
 * `ApprovalRevise` carry no `workspaceId` — contracts 0.2.0 does not model
 * tenancy on those shapes, and adding it locally would be exactly the silent
 * divergence the feedback loop exists to prevent. Recorded in
 * docs/CRM-1-CONTRACTS-FEEDBACK.md so contracts can decide whether tenancy
 * belongs in the payload or stays transport-level.
 */
export const CHAT_WORKSPACE_HEADER = "x-syncore-workspace-id";

export type ChatAuthResult =
  | { ok: true; actorId: string; workspaceId: string | null }
  | { ok: false; status: 401 | 500; error: string };

export type ChatApprovalAuthorizationResult =
  | { ok: true; actorId: string; workspaceId: string }
  | { ok: false; status: 403; error: string };

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Length is compared first because timingSafeEqual throws on a mismatch. The
  // length itself leaks, which is fine: token length is not the secret.
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Authenticate a chat-surface request and resolve who is acting.
 *
 * Fails closed. An unset `SYNCORE_CHAT_API_TOKEN` is a 500, never an open door —
 * a missing secret must not silently mean "allow everyone", which is the
 * failure mode of checking `if (token && token !== provided)`.
 */
export function authenticateChatRequest(headers: Headers): ChatAuthResult {
  const expected = process.env.SYNCORE_CHAT_API_TOKEN;
  if (!expected || expected.length === 0) {
    return {
      ok: false,
      status: 500,
      error: "SYNCORE_CHAT_API_TOKEN is not configured; refusing to accept chat API calls."
    };
  }

  const authorization = headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return { ok: false, status: 401, error: "Missing bearer token." };
  }

  if (!constantTimeEquals(authorization.slice(prefix.length), expected)) {
    return { ok: false, status: 401, error: "Invalid bearer token." };
  }

  const actorId = headers.get(CHAT_ACTOR_HEADER)?.trim();
  if (!actorId) {
    // Refusing here rather than defaulting to a system actor: an approval whose
    // decidedBy is "system" is an audit trail that cannot answer who approved
    // the spend, which is the one question it exists to answer (v9.1 §10).
    return {
      ok: false,
      status: 401,
      error: `Missing ${CHAT_ACTOR_HEADER}; the acting human must be identified.`
    };
  }

  return {
    ok: true,
    actorId,
    // Null rather than an error: `/api/chat/niche-request` takes its workspace
    // from the validated body, so only the approval routes require the header
    // and each states its own requirement.
    workspaceId: headers.get(CHAT_WORKSPACE_HEADER)?.trim() || null
  };
}

/**
 * Bind the bot-reported actor to a workspace taken from the REQUEST BODY.
 *
 * The chat bearer is a single shared secret, so it says "a bot is calling", not
 * "this actor may write here". Without this check a leaked bearer — or a bot bug —
 * could create records in any workspace, including the stale legacy one, attributed
 * to an arbitrary actor id. Membership in any role is enough to raise a request;
 * deciding one is the stricter gate below.
 */
export async function authorizeChatWorkspaceActor(
  input: { actorId: string; workspaceId: string },
  client?: GrowthPrismaClient
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const db = client ?? (await growthPrisma());
  const membership = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: input.workspaceId, userId: input.actorId }
    },
    select: { role: true }
  });
  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: "Actor is not a member of the requested workspace."
    };
  }
  return { ok: true };
}

/**
 * Bind the bot-reported actor to the requested workspace before an approval
 * route reaches any mutator. ADMIN and MANAGER are the Prisma roles carrying
 * the dashboard's `manage_outreach` permission; accepting a valid global bearer
 * alone would otherwise let an arbitrary workspace header cross tenant scope.
 */
export async function authorizeChatApprovalActor(
  auth: Extract<ChatAuthResult, { ok: true }> & { workspaceId: string },
  client?: GrowthPrismaClient
): Promise<ChatApprovalAuthorizationResult> {
  const db = client ?? (await growthPrisma());
  const membership = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: auth.workspaceId,
        userId: auth.actorId
      }
    },
    select: { role: true }
  });

  if (!membership || (membership.role !== "ADMIN" && membership.role !== "MANAGER")) {
    return {
      ok: false,
      status: 403,
      error: "Actor is not authorized to manage approvals in this workspace."
    };
  }

  return { ok: true, actorId: auth.actorId, workspaceId: auth.workspaceId };
}

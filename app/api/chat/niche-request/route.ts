import { NextResponse } from "next/server";
import { NicheRequestCreate } from "@syncore/contracts";
import { authenticateChatRequest, authorizeChatWorkspaceActor } from "@/lib/growth/chat-auth";
import { createNicheRequest } from "@/lib/growth/repositories/niche-request-repository";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled } from "@/lib/phase1/rate-limit";

/**
 * `POST /api/chat/niche-request` — v9.1 §9.4.
 *
 * 🔴 Creates a `NicheRequest` (Template A). It CANNOT create a `NicheBrief`.
 *
 * v9.1 §7 and §26.3: no brief and no `NICHE_TEST` approval may exist before
 * research completes, and §24 rates storing Template A as a brief a High-impact
 * risk — it is the contradiction v9.1 was revised to remove. This route only
 * ever writes one row, and the brief path is guarded independently in
 * `niche-brief-repository`.
 */
export async function POST(request: Request) {
  if (rateLimitingEnabled()) {
    const rate = checkRateLimit(`chat:niche-request:${clientIpFromHeaders(request.headers)}`, {
      limit: 60,
      windowMs: 60_000
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) }
        }
      );
    }
  }

  const auth = authenticateChatRequest(request.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // Parse against the contracts shape. `createdBy` is absent from this shape by
  // design — it comes from the authenticated actor, never the body.
  const parsed = NicheRequestCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid NicheRequestCreate payload.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // The workspace comes from the body, so the actor must be shown to belong to it
  // before anything is written — the shared bearer alone does not scope tenancy.
  const scoped = await authorizeChatWorkspaceActor({
    actorId: auth.actorId,
    workspaceId: parsed.data.workspaceId
  });
  if (!scoped.ok) return NextResponse.json({ error: scoped.error }, { status: scoped.status });

  try {
    const created = await createNicheRequest({
      workspaceId: parsed.data.workspaceId,
      createdBy: auth.actorId,
      sourceChannel: parsed.data.sourceChannel,
      sourceMessageId: parsed.data.sourceMessageId,
      voiceAssetRef: parsed.data.voiceAssetRef,
      transcript: parsed.data.transcript,
      structuredPayload: parsed.data.structuredPayload
    });

    return NextResponse.json(
      {
        nicheRequestId: created.id,
        status: created.status,
        createdAt: created.createdAt.toISOString()
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create niche request." },
      { status: 400 }
    );
  }
}

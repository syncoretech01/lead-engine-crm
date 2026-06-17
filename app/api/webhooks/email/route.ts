import { NextResponse } from "next/server";
import { outreachEmailWriteTables } from "@/lib/phase1/normalized-write-tables";
import { updateAuthState } from "@/lib/phase1/store";
import {
  appendWorkspaceAudit,
  resolveSignedWebhookWorkspaceId,
  systemActorForWorkspace
} from "@/lib/phase1/tenant-isolation";
import { processEmailWebhook, verifyWebhookSignature } from "@/lib/phase1/webhooks";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled } from "@/lib/phase1/rate-limit";

export async function POST(request: Request) {
  if (rateLimitingEnabled()) {
    const rate = checkRateLimit(`webhook:email:${clientIpFromHeaders(request.headers)}`, {
      limit: 600,
      windowMs: 60_000
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) } }
      );
    }
  }

  const body = await request.text();
  const signature = request.headers.get("x-syncore-signature");

  if (!verifyWebhookSignature(body, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);
    const result = await updateAuthState(
      (state) => {
        const workspaceId = resolveSignedWebhookWorkspaceId(state, payload);
        const actor = systemActorForWorkspace(state, workspaceId);
        const processed = processEmailWebhook(state, payload, actor);

        appendWorkspaceAudit(state, {
          workspaceId,
          actorUserId: actor.id,
          objectType: "webhook_event",
          objectId: processed.webhookEvent.id,
          action: processed.status === "duplicate" ? "duplicate_email_webhook" : "processed_email_webhook",
          newValue: {
            idempotencyKey: processed.webhookEvent.idempotencyKey,
            providerEventId: processed.webhookEvent.providerEventId,
            processedRecordId: processed.recordId
          }
        });

        return processed;
      },
      { normalizedTables: outreachEmailWriteTables }
    );

    return NextResponse.json({
      status: result.status,
      webhookEventId: result.webhookEvent.id,
      recordId: result.recordId
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed." },
      { status: 400 }
    );
  }
}

import { NextResponse } from "next/server";
import { outreachSmsWriteTables } from "@/lib/phase1/normalized-write-tables";
import { updateAuthState } from "@/lib/phase1/store";
import {
  appendWorkspaceAudit,
  resolveSignedWebhookWorkspaceId,
  systemActorForWorkspace
} from "@/lib/phase1/tenant-isolation";
import { processSmsWebhook, verifyWebhookSignature } from "@/lib/phase1/webhooks";

export async function POST(request: Request) {
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
        const processed = processSmsWebhook(state, payload, actor);

        appendWorkspaceAudit(state, {
          workspaceId,
          actorUserId: actor.id,
          objectType: "webhook_event",
          objectId: processed.webhookEvent.id,
          action: processed.status === "duplicate" ? "duplicate_sms_webhook" : "processed_sms_webhook",
          newValue: {
            idempotencyKey: processed.webhookEvent.idempotencyKey,
            providerEventId: processed.webhookEvent.providerEventId,
            processedRecordId: processed.recordId
          }
        });

        return processed;
      },
      { normalizedTables: outreachSmsWriteTables }
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

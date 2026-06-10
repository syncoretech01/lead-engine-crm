import { NextResponse } from "next/server";
import { outreachEmailWriteTables } from "@/lib/phase1/normalized-write-tables";
import { appendAudit, updateState } from "@/lib/phase1/store";
import { processEmailWebhook, verifyWebhookSignature } from "@/lib/phase1/webhooks";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-syncore-signature");

  if (!verifyWebhookSignature(body, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);
    const result = await updateState(
      (state, session) => {
        const processed = processEmailWebhook(state, payload, session.user);

        appendAudit(state, session, {
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

import { NextResponse } from "next/server";
import { outreachEmailWriteTables } from "@/lib/phase1/normalized-write-tables";
import { parseSesEvent } from "@/lib/phase1/ses-events";
import { isValidSnsUrl, verifySnsMessage, type SnsMessage } from "@/lib/phase1/sns-message";
import { updateAuthState } from "@/lib/phase1/store";
import { appendWorkspaceAudit, systemActorForWorkspace } from "@/lib/phase1/tenant-isolation";
import { processEmailWebhook } from "@/lib/phase1/webhooks";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled } from "@/lib/phase1/rate-limit";

export const runtime = "nodejs";

/**
 * Amazon SES bounce/complaint webhook (delivered via SNS). Verifies the SNS
 * signature, auto-confirms the subscription, and maps hard bounces / spam
 * complaints onto the existing email-webhook path so the matching contact is
 * suppressed. An optional ?token gate adds defense-in-depth on the URL.
 */
export async function POST(request: Request) {
  if (rateLimitingEnabled()) {
    const rate = checkRateLimit(`webhook:ses:${clientIpFromHeaders(request.headers)}`, { limit: 600, windowMs: 60_000 });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) } }
      );
    }
  }

  const expectedToken = process.env.SYNCORE_SES_WEBHOOK_TOKEN;
  if (expectedToken && new URL(request.url).searchParams.get("token") !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.text();
  let message: SnsMessage;
  try {
    message = JSON.parse(body) as SnsMessage;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!(await verifySnsMessage(message))) {
    return NextResponse.json({ error: "Invalid SNS signature." }, { status: 401 });
  }

  if (message.Type === "SubscriptionConfirmation") {
    if (message.SubscribeURL && isValidSnsUrl(message.SubscribeURL)) {
      await fetch(message.SubscribeURL).catch(() => undefined);
    }
    return NextResponse.json({ status: "subscription-confirmed" });
  }

  if (message.Type !== "Notification") {
    return NextResponse.json({ status: "ignored" });
  }

  const actions = parseSesEvent(message.Message);
  if (actions.length === 0) {
    return NextResponse.json({ status: "no-op" });
  }

  try {
    const results = await updateAuthState(
      (state) =>
        actions.map((action) => {
          const contact = state.contacts.find((item) => item.email.toLowerCase() === action.email);
          if (!contact) {
            return { email: action.email, status: "no-contact" as const };
          }

          const actor = systemActorForWorkspace(state, contact.workspaceId);
          const processed = processEmailWebhook(
            state,
            {
              workspaceId: contact.workspaceId,
              contactId: contact.id,
              eventType: action.eventType,
              providerEventId: `ses:${message.MessageId}:${action.email}`,
              messageId: action.messageId,
              bounceType: action.bounceType
            },
            actor
          );

          appendWorkspaceAudit(state, {
            workspaceId: contact.workspaceId,
            actorUserId: actor.id,
            objectType: "webhook_event",
            objectId: processed.webhookEvent.id,
            action: action.eventType === "Bounced" ? "ses_hard_bounce" : "ses_complaint",
            newValue: { email: action.email, messageId: action.messageId, status: processed.status }
          });

          return { email: action.email, status: processed.status };
        }),
      { normalizedTables: outreachEmailWriteTables }
    );

    return NextResponse.json({ status: "processed", results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SES webhook failed." }, { status: 400 });
  }
}

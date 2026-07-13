import { NextResponse } from "next/server";
import { outreachEmailWriteTables } from "@/lib/phase1/normalized-write-tables";
import { captureError } from "@/lib/phase1/observability";
import { matchSesSuppressionContact, parseSesEvent } from "@/lib/phase1/ses-events";
import { isAllowedSnsTopic, isValidSnsUrl, verifySnsMessage, type SnsMessage } from "@/lib/phase1/sns-message";
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

  // Reject every message — subscription confirmations included — whose TopicArn is
  // not one of our own SES→SNS topics. A valid SNS signature only proves the event
  // came from some AWS account; without this an attacker's own topic could
  // auto-confirm here and then publish validly-signed forged bounces to suppress
  // arbitrary contacts cross-tenant. Enforced only when SYNCORE_SES_TOPIC_ARNS is
  // configured (see .env.example) so existing deploys are not broken before it is set.
  if (!isAllowedSnsTopic(message.TopicArn)) {
    return NextResponse.json({ error: "Untrusted SNS topic." }, { status: 403 });
  }

  // Subscription confirmation is authorized by the SNS-issued token embedded in
  // SubscribeURL (which only SNS knows), so it is confirmed by visiting that URL
  // after validating its host is genuine AWS SNS — it does not require the message
  // signature. The bounce/complaint notifications below DO require it.
  if (message.Type === "SubscriptionConfirmation" || message.Type === "UnsubscribeConfirmation") {
    if (!message.SubscribeURL || !isValidSnsUrl(message.SubscribeURL)) {
      return NextResponse.json({ error: "Invalid or missing SubscribeURL." }, { status: 400 });
    }
    const confirmation = await fetch(message.SubscribeURL).catch(() => null);
    if (confirmation?.ok) {
      return NextResponse.json({ status: "subscription-confirmed" });
    }
    return NextResponse.json({ error: "Could not reach SubscribeURL." }, { status: 502 });
  }

  // A forged bounce/complaint could suppress an arbitrary contact, so notifications
  // must pass full SNS signature verification.
  if (!(await verifySnsMessage(message))) {
    return NextResponse.json({ error: "Invalid SNS signature." }, { status: 401 });
  }

  if (message.Type !== "Notification") {
    return NextResponse.json({ status: "ignored" });
  }

  const actions = parseSesEvent(message.Message);
  if (actions.length === 0) {
    return NextResponse.json({ status: "no-op" });
  }

  // When a notification cannot be attributed to a workspace (no SES tag), quarantine
  // it by default rather than guessing a tenant: applying a cross-workspace first-
  // match would let a forged or mis-tagged event suppress an arbitrary tenant's
  // contact. Set SYNCORE_SES_QUARANTINE_UNSCOPED=false to restore the legacy
  // cross-workspace first-match. Tagged events are always matched strictly within
  // their own workspace regardless of this flag.
  const quarantineUnscoped = process.env.SYNCORE_SES_QUARANTINE_UNSCOPED !== "false";

  try {
    const results = await updateAuthState(
      (state) =>
        actions.map((action) => {
          const match = matchSesSuppressionContact(state, action, { quarantineUnscoped });
          if (match.status === "quarantined") {
            return { email: action.email, status: "quarantined" as const };
          }
          if (match.status === "no-contact") {
            return { email: action.email, status: "no-contact" as const };
          }

          const contact = match.contact;
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
    captureError(error, { route: "webhooks/ses", messageId: message.MessageId });
    return NextResponse.json({ error: error instanceof Error ? error.message : "SES webhook failed." }, { status: 400 });
  }
}

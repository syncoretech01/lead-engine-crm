import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { suppressContact } from "@/lib/phase1/compliance";
import { outreachEmailWriteTables } from "@/lib/phase1/normalized-write-tables";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled } from "@/lib/phase1/rate-limit";
import { updateAuthState } from "@/lib/phase1/store";
import { appendWorkspaceAudit, systemActorForWorkspace } from "@/lib/phase1/tenant-isolation";
import { verifyUnsubscribeToken } from "@/lib/phase1/unsubscribe-token";
import type { SuppressionRecord } from "@/lib/phase1/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ status: "method-not-allowed" }, { status: 405 });
}

export async function POST(request: Request) {
  if (rateLimitingEnabled()) {
    const rate = checkRateLimit(`unsubscribe:${clientIpFromHeaders(request.headers)}`, { limit: 120, windowMs: 60_000 });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) } }
      );
    }
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const body = await request.text().catch(() => "");
  const bodyParams = new URLSearchParams(body);
  const shouldRedirect = bodyParams.get("redirect") === "1";
  const verified = verifyUnsubscribeToken(token);

  if (!verified.ok) {
    return NextResponse.json({ status: "ok" });
  }

  await updateAuthState((state) => {
    const contact = state.contacts.find(
      (item) => item.id === verified.contactId && item.workspaceId === verified.workspaceId
    );
    if (!contact) {
      return { status: "no-contact" as const };
    }

    const actor = systemActorForWorkspace(state, verified.workspaceId);
    const now = new Date().toISOString();
    const alreadySuppressed = contact.isSuppressed;
    if (!alreadySuppressed) {
      suppressContact(contact, "List-Unsubscribe (email recipient)", now);
    }

    upsertListUnsubscribeSuppression(state.suppressionRecords, {
      id: `supp-${randomUUID()}`,
      workspaceId: verified.workspaceId,
      type: "Unsubscribe",
      email: contact.email || undefined,
      reason: "List-Unsubscribe (email recipient)",
      source: "List-Unsubscribe",
      createdAt: now
    });

    appendWorkspaceAudit(state, {
      workspaceId: verified.workspaceId,
      actorUserId: actor.id,
      objectType: "contact",
      objectId: contact.id,
      action: "email_unsubscribe",
      newValue: { source: "List-Unsubscribe", alreadySuppressed }
    });

    return { status: "suppressed" as const };
  }, { normalizedTables: outreachEmailWriteTables });

  if (shouldRedirect) {
    const redirectUrl = new URL(`/unsubscribe/${encodeURIComponent(verified.contactId)}`, request.url);
    redirectUrl.searchParams.set("t", token);
    redirectUrl.searchParams.set("done", "1");
    return NextResponse.redirect(redirectUrl, 303);
  }

  return NextResponse.json({ status: "ok" });
}

function upsertListUnsubscribeSuppression(records: SuppressionRecord[], record: SuppressionRecord) {
  const exists = records.some(
    (item) =>
      item.workspaceId === record.workspaceId &&
      item.type === "Unsubscribe" &&
      Boolean(record.email) &&
      item.email?.toLowerCase() === record.email?.toLowerCase()
  );

  if (!exists) {
    records.unshift(record);
  }
}

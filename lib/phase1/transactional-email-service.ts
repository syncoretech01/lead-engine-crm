import { resolveLiveProviderCredential } from "@/lib/phase1/provider-live-execution";
import { recordEvent } from "@/lib/phase1/observability";
import { readState } from "@/lib/phase1/store";
import { amazonSesSendEmail } from "@/lib/providers/adapters/amazon-ses";
import { resolveProviderExecutionMode } from "@/lib/providers/live-adapters";
import { ensureLiveProviderAdaptersRegistered } from "@/lib/providers/register-live-adapters";
import { syncoreBrand } from "@/lib/brand";
import type { AppState, ProviderConnection } from "@/lib/phase1/types";

export type TransactionalEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type TransactionalSendResult = {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  providerMessageId?: string;
};

function resolveAppBaseUrl(): string {
  const explicit = process.env.SYNCORE_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

/** Make a stored relative link (e.g. /invite/abc) absolute for an email body. */
export function absoluteUrl(path: string): string {
  const base = resolveAppBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Branded, email-client-safe HTML shell (inline styles + table layout so it
 * renders in Gmail/Outlook). The logo is a hosted PNG — data URIs are blocked
 * by most clients.
 */
function brandedEmailHtml(opts: {
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaHref: string;
  footnote: string;
}): string {
  const logo = absoluteUrl(syncoreBrand.logo.logomark);
  const navy = syncoreBrand.colors.dark;
  const blue = syncoreBrand.colors.primary;
  return `<div style="margin:0;padding:32px 12px;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6ebf3;border-radius:14px;overflow:hidden;">
    <tr><td style="background:${navy};padding:22px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;"><img src="${logo}" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;" /></td>
        <td style="vertical-align:middle;padding-left:12px;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:-0.01em;">${syncoreBrand.shortName}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:32px;">
      <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#0b1220;">${opts.heading}</h1>
      ${opts.bodyHtml}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr>
        <td style="border-radius:9px;background:${blue};">
          <a href="${opts.ctaHref}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">${opts.ctaLabel}</a>
        </td>
      </tr></table>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">${opts.footnote}</p>
    </td></tr>
    <tr><td style="padding:18px 32px;border-top:1px solid #eef1f6;">
      <p style="margin:0;font-size:12px;color:#9aa3b2;">${syncoreBrand.companyName} · ${syncoreBrand.tagline}</p>
    </td></tr>
  </table>
</div>`;
}

export function inviteEmail(input: { to: string; url: string; workspaceName?: string }): TransactionalEmail {
  const link = absoluteUrl(input.url);
  const product = syncoreBrand.shortName;
  return {
    to: input.to,
    subject: `You're invited to ${product}`,
    html: brandedEmailHtml({
      heading: `You're invited to ${product}`,
      bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.55;color:#374151;">You've been invited to join <strong>${product}</strong>. Click below to set your password and get started.</p>`,
      ctaLabel: "Accept your invitation",
      ctaHref: link,
      footnote: "This link expires in 7 days. If you weren't expecting this, you can ignore this email."
    }),
    text: `You've been invited to join ${product}. Accept your invitation: ${link} (expires in 7 days).`
  };
}

export function passwordResetEmail(input: { to: string; url: string }): TransactionalEmail {
  const link = absoluteUrl(input.url);
  return {
    to: input.to,
    subject: `Reset your ${syncoreBrand.shortName} password`,
    html: brandedEmailHtml({
      heading: "Reset your password",
      bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.55;color:#374151;">We received a request to reset your ${syncoreBrand.shortName} password. Click below to choose a new one.</p>`,
      ctaLabel: "Reset your password",
      ctaHref: link,
      footnote: "This link expires in 1 hour. If you didn't request this, you can safely ignore this email."
    }),
    text: `Reset your ${syncoreBrand.shortName} password: ${link} (expires in 1 hour). If you didn't request this, you can ignore this email.`
  };
}

function findLiveSesConnection(state: AppState, workspaceId?: string): ProviderConnection | undefined {
  const live = (state.providerConnections ?? []).filter(
    (connection) =>
      connection.providerId === "amazon_ses" &&
      connection.enabled &&
      resolveProviderExecutionMode(connection.executionMode) === "live"
  );
  if (workspaceId) {
    const scoped = live.find((connection) => connection.workspaceId === workspaceId);
    if (scoped) return scoped;
  }
  return live[0];
}

/**
 * Send a transactional email via Amazon SES when a live amazon_ses connection
 * exists; otherwise return "skipped" so callers fall back to their existing
 * behavior (e.g. showing the link). Never throws on a send failure — callers
 * await it but an outage must not break invite/reset creation. Testable variant
 * takes state directly so unit tests don't touch the store or the network.
 */
export async function sendTransactionalEmailForState(
  state: AppState,
  input: { email: TransactionalEmail; workspaceId?: string }
): Promise<TransactionalSendResult> {
  const connection = findLiveSesConnection(state, input.workspaceId);
  if (!connection) {
    return { status: "skipped", reason: "Amazon SES is not enabled in live mode." };
  }

  const credential = resolveLiveProviderCredential(state, connection);
  if (!credential.ok) {
    return { status: "skipped", reason: "No Amazon SES credential is stored." };
  }

  ensureLiveProviderAdaptersRegistered();
  const result = await amazonSesSendEmail(input.email, {
    workspaceId: connection.workspaceId,
    providerId: "amazon_ses",
    executionMode: "live",
    requestId: `transactional-${Date.now()}`,
    credential: credential.credential
  });

  if (result.status === "ok" && result.data[0]?.status === "sent") {
    return { status: "sent", providerMessageId: result.data[0].providerMessageId };
  }

  const reason = result.errorMessage ?? "Amazon SES send failed.";
  recordEvent("transactional_email_send_failed", { workspaceId: connection.workspaceId, reason });
  return { status: "failed", reason };
}

export async function sendTransactionalEmail(input: {
  email: TransactionalEmail;
  workspaceId?: string;
}): Promise<TransactionalSendResult> {
  const state = await readState();
  return sendTransactionalEmailForState(state, input);
}

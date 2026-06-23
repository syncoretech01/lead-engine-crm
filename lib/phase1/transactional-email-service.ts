import { resolveLiveProviderCredential } from "@/lib/phase1/provider-live-execution";
import { readState } from "@/lib/phase1/store";
import { amazonSesSendEmail } from "@/lib/providers/adapters/amazon-ses";
import { resolveProviderExecutionMode } from "@/lib/providers/live-adapters";
import { ensureLiveProviderAdaptersRegistered } from "@/lib/providers/register-live-adapters";
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

export function inviteEmail(input: { to: string; url: string; workspaceName?: string }): TransactionalEmail {
  const link = absoluteUrl(input.url);
  const workspace = input.workspaceName ?? "Syncore";
  return {
    to: input.to,
    subject: `You're invited to ${workspace}`,
    html: `<p>You've been invited to join <strong>${workspace}</strong>.</p><p><a href="${link}">Accept your invitation</a></p><p>This link expires in 7 days.</p>`,
    text: `You've been invited to join ${workspace}. Accept your invitation: ${link} (expires in 7 days).`
  };
}

export function passwordResetEmail(input: { to: string; url: string }): TransactionalEmail {
  const link = absoluteUrl(input.url);
  return {
    to: input.to,
    subject: "Reset your Syncore password",
    html: `<p>We received a request to reset your password.</p><p><a href="${link}">Reset your password</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
    text: `Reset your Syncore password: ${link} (expires in 1 hour). If you didn't request this, you can ignore this email.`
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
  return { status: "failed", reason: result.errorMessage ?? "Amazon SES send failed." };
}

export async function sendTransactionalEmail(input: {
  email: TransactionalEmail;
  workspaceId?: string;
}): Promise<TransactionalSendResult> {
  const state = await readState();
  return sendTransactionalEmailForState(state, input);
}

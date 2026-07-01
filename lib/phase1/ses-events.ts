import { SES_WORKSPACE_TAG_NAME } from "@/lib/providers/ses-tags";
import type { AppState, Contact } from "@/lib/phase1/types";

/**
 * Parse an SES bounce/complaint notification (the JSON in an SNS message's
 * `Message` field) into suppression actions. Handles both the identity-
 * notification shape (`notificationType`) and the configuration-set event shape
 * (`eventType`). Only **permanent** (hard) bounces suppress — transient bounces
 * are retryable and must not. Pure + side-effect free.
 */
export type SesSuppressionAction = {
  email: string;
  eventType: "Bounced" | "Spam complaint";
  bounceType?: "Hard";
  messageId?: string;
  /** Sending workspace, read from the SES `syncore_workspace_id` message tag (P2.1). */
  workspaceId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function recipientEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      const record = asRecord(entry);
      const email = record?.emailAddress;
      return typeof email === "string" ? email.trim().toLowerCase() : "";
    })
    .filter(Boolean);
}

export function parseSesEvent(messageBody: string): SesSuppressionAction[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(messageBody);
  } catch {
    return [];
  }

  const data = asRecord(parsed);
  if (!data) return [];

  const kind = data.notificationType ?? data.eventType;
  const mail = asRecord(data.mail);
  const messageId = typeof mail?.messageId === "string" ? mail.messageId : undefined;
  const workspaceId = extractWorkspaceTag(mail);

  if (kind === "Bounce") {
    const bounce = asRecord(data.bounce);
    if (!bounce || bounce.bounceType !== "Permanent") {
      return [];
    }
    return recipientEmails(bounce.bouncedRecipients).map((email) => ({
      email,
      eventType: "Bounced" as const,
      bounceType: "Hard" as const,
      messageId,
      workspaceId
    }));
  }

  if (kind === "Complaint") {
    const complaint = asRecord(data.complaint);
    if (!complaint) return [];
    return recipientEmails(complaint.complainedRecipients).map((email) => ({
      email,
      eventType: "Spam complaint" as const,
      messageId,
      workspaceId
    }));
  }

  return [];
}

/** Read the sending workspace id from the SES `mail.tags` map, if present. */
function extractWorkspaceTag(mail: Record<string, unknown> | null): string | undefined {
  const tags = asRecord(mail?.tags);
  const raw = tags?.[SES_WORKSPACE_TAG_NAME];
  if (Array.isArray(raw)) {
    const first = raw.find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof first === "string" ? first.trim() : undefined;
  }
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export type SesContactMatch =
  | { status: "matched"; contact: Contact }
  | { status: "no-contact" }
  | { status: "quarantined" };

/**
 * Resolve which contact an SES suppression action targets.
 *
 * When the notification carries a `syncore_workspace_id` tag we match strictly
 * within that workspace — never falling back to another tenant that happens to
 * share the email. When the tag is absent (identity notifications, or mail sent
 * before tagging), behavior depends on `quarantineUnscoped`: default keeps the
 * legacy cross-workspace first-match (so existing bounce handling is not
 * regressed), while enabling it quarantines the event rather than guessing a
 * tenant. See P2.1.
 */
export function matchSesSuppressionContact(
  state: AppState,
  action: SesSuppressionAction,
  options: { quarantineUnscoped?: boolean } = {}
): SesContactMatch {
  const email = action.email.toLowerCase();

  if (action.workspaceId) {
    const contact = state.contacts.find(
      (item) => item.workspaceId === action.workspaceId && item.email.toLowerCase() === email
    );
    return contact ? { status: "matched", contact } : { status: "no-contact" };
  }

  if (options.quarantineUnscoped) {
    return { status: "quarantined" };
  }

  const contact = state.contacts.find((item) => item.email.toLowerCase() === email);
  return contact ? { status: "matched", contact } : { status: "no-contact" };
}

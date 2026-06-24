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

  if (kind === "Bounce") {
    const bounce = asRecord(data.bounce);
    if (!bounce || bounce.bounceType !== "Permanent") {
      return [];
    }
    return recipientEmails(bounce.bouncedRecipients).map((email) => ({
      email,
      eventType: "Bounced" as const,
      bounceType: "Hard" as const,
      messageId
    }));
  }

  if (kind === "Complaint") {
    const complaint = asRecord(data.complaint);
    if (!complaint) return [];
    return recipientEmails(complaint.complainedRecipients).map((email) => ({
      email,
      eventType: "Spam complaint" as const,
      messageId
    }));
  }

  return [];
}

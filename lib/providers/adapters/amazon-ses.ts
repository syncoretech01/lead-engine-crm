import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { providerError } from "@/lib/providers/adapters/http";
import { SES_WORKSPACE_TAG_NAME } from "@/lib/providers/ses-tags";
import type { ProviderRequestContext, ProviderResult } from "@/lib/providers/types";

/** SES message-tag values allow only [A-Za-z0-9_.-] and max 256 chars. */
function sanitizeTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 256);
}

/**
 * Amazon SES send adapter (M3). Reads its credential from the connection vault as
 * a JSON blob and sends a single email via the SES v2 API. Only ever reached when
 * the amazon_ses connection is in live mode with SYNCORE_ENABLE_LIVE_PROVIDERS on;
 * otherwise the transactional/outreach flows fall back to no-send.
 */
export type SesCredential = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fromAddress?: string;
  configurationSet?: string;
};

/** One email attachment. `content` is already base64-encoded file bytes. */
export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: string;
};

export type SesSendInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  from?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
};

export type SesSendResult = {
  providerMessageId?: string;
  status: "sent" | "failed";
  recipient: string;
  sentAt: string;
  reason?: string;
};

function parseCredential(context: ProviderRequestContext): SesCredential | null {
  if (!context.credential?.secret) return null;
  try {
    const parsed = JSON.parse(context.credential.secret) as Partial<SesCredential> & Record<string, string | undefined>;
    const credential: SesCredential = {
      region: parsed.region ?? parsed.AWS_SES_REGION ?? "",
      accessKeyId: parsed.accessKeyId ?? parsed.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: parsed.secretAccessKey ?? parsed.AWS_SECRET_ACCESS_KEY ?? "",
      fromAddress: parsed.fromAddress ?? parsed.AWS_SES_FROM_ADDRESS,
      configurationSet: parsed.configurationSet ?? parsed.AWS_SES_CONFIGURATION_SET
    };
    if (!credential.region || !credential.accessKeyId || !credential.secretAccessKey) {
      return null;
    }
    return credential;
  } catch {
    return null;
  }
}

export async function amazonSesSendEmail(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<SesSendResult>> {
  const { providerId, requestId } = context;
  const credential = parseCredential(context);
  if (!credential) {
    return providerError(
      providerId,
      requestId,
      "Amazon SES credential is missing or malformed (need region, accessKeyId, secretAccessKey)."
    );
  }

  const send = input as SesSendInput;
  if (!send?.to || !send.subject || (!send.html && !send.text)) {
    return providerError(providerId, requestId, "Amazon SES send requires `to`, `subject`, and `html` or `text`.");
  }

  const client = new SESv2Client({
    region: credential.region,
    credentials: { accessKeyId: credential.accessKeyId, secretAccessKey: credential.secretAccessKey }
  });

  try {
    const from = send.from ?? credential.fromAddress;
    if (!from) {
      return providerError(providerId, requestId, "Amazon SES send requires a From address.");
    }
    const headers = send.headers && Object.keys(send.headers).length > 0 ? send.headers : undefined;
    const emailTags = context.workspaceId
      ? [{ Name: SES_WORKSPACE_TAG_NAME, Value: sanitizeTagValue(context.workspaceId) }]
      : undefined;
    const response = await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [send.to] },
        ReplyToAddresses: headers ? undefined : send.replyTo ? [send.replyTo] : undefined,
        ConfigurationSetName: credential.configurationSet,
        EmailTags: emailTags,
        Content: headers
          ? { Raw: { Data: buildMimeMessage(send, from) } }
          : {
              Simple: {
                Subject: { Data: send.subject, Charset: "UTF-8" },
                Body: {
                  ...(send.html ? { Html: { Data: send.html, Charset: "UTF-8" } } : {}),
                  ...(send.text ? { Text: { Data: send.text, Charset: "UTF-8" } } : {})
                }
              }
            }
      })
    );

    return {
      status: "ok",
      data: [{ providerMessageId: response.MessageId, status: "sent", recipient: send.to, sentAt: new Date().toISOString() }],
      meta: { providerId, requestId }
    };
  } catch (error) {
    return providerError(providerId, requestId, error instanceof Error ? error.message : "Amazon SES send failed.");
  }
}

export function buildMimeMessage(input: SesSendInput, from: string): Uint8Array {
  const headers = [
    headerLine("From", from),
    headerLine("To", input.to),
    headerLine("Subject", encodeHeaderValue(input.subject)),
    input.replyTo ? headerLine("Reply-To", input.replyTo) : undefined,
    headerLine("MIME-Version", "1.0"),
    headerLine("Date", new Date().toUTCString()),
    ...Object.entries(input.headers ?? {}).map(([name, value]) => headerLine(name, value))
  ].filter((line): line is string => Boolean(line));

  // The message body — a self-contained MIME part beginning with its own
  // Content-Type line (text/html alternative, or a single part).
  const bodyPart = buildBodyPart(input);
  const attachments = input.attachments ?? [];

  if (attachments.length === 0) {
    return Buffer.from(`${headers.join("\r\n")}\r\n${bodyPart}`, "utf8");
  }

  // With attachments, wrap the body + each attachment in multipart/mixed.
  const mixed = uniqueBoundary("mixed");
  const sections = [
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    bodyPart,
    ...attachments.map((attachment) =>
      [
        `--${mixed}`,
        headerLine("Content-Type", `${attachment.contentType || "application/octet-stream"}; name="${sanitizeFilename(attachment.filename)}"`),
        headerLine("Content-Disposition", `attachment; filename="${sanitizeFilename(attachment.filename)}"`),
        "Content-Transfer-Encoding: base64",
        "",
        wrapExistingBase64(attachment.content)
      ].join("\r\n")
    ),
    `--${mixed}--`,
    ""
  ];

  return Buffer.from(`${headers.join("\r\n")}\r\n${sections.join("\r\n")}`, "utf8");
}

// Build the message body MIME part (text/html alternative, or a single part).
function buildBodyPart(input: SesSendInput): string {
  if (input.text && input.html) {
    const boundary = uniqueBoundary("alt");
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(input.text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(input.html),
      `--${boundary}--`,
      ""
    ].join("\r\n");
  }
  if (input.html) {
    return ["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrapBase64(input.html)].join("\r\n");
  }
  return ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrapBase64(input.text ?? "")].join("\r\n");
}

function uniqueBoundary(kind: string) {
  return `syncore-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Strip quotes / CR/LF / path separators so a filename can't break out of the
// Content-Disposition header or inject MIME structure.
function sanitizeFilename(name: string) {
  const clean = name.replace(/[\r\n"\\/]+/g, "_").trim();
  return (clean || "attachment").slice(0, 200);
}

// Re-wrap an already-base64 string to 76-column lines (RFC 2045) without
// re-encoding it (attachment bytes arrive pre-encoded).
function wrapExistingBase64(base64: string) {
  return base64
    .replace(/\s+/g, "")
    .replace(/.{1,76}/g, "$&\r\n")
    .trimEnd();
}

function headerLine(name: string, value: string) {
  return `${sanitizeHeaderName(name)}: ${sanitizeHeaderValue(value)}`;
}

function sanitizeHeaderName(value: string) {
  return value.replace(/[^A-Za-z0-9-]/g, "");
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeaderValue(value: string) {
  const clean = sanitizeHeaderValue(value);
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trimEnd();
}

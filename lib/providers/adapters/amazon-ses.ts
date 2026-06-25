import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { providerError } from "@/lib/providers/adapters/http";
import type { ProviderRequestContext, ProviderResult } from "@/lib/providers/types";

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

export type SesSendInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  from?: string;
  headers?: Record<string, string>;
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
    const response = await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [send.to] },
        ReplyToAddresses: headers ? undefined : send.replyTo ? [send.replyTo] : undefined,
        ConfigurationSetName: credential.configurationSet,
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
  const boundary = `syncore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const headers = [
    headerLine("From", from),
    headerLine("To", input.to),
    headerLine("Subject", encodeHeaderValue(input.subject)),
    input.replyTo ? headerLine("Reply-To", input.replyTo) : undefined,
    headerLine("MIME-Version", "1.0"),
    headerLine("Date", new Date().toUTCString()),
    ...Object.entries(input.headers ?? {}).map(([name, value]) => headerLine(name, value))
  ].filter((line): line is string => Boolean(line));

  let body: string;
  if (input.text && input.html) {
    body = [
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
  } else if (input.html) {
    body = [
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(input.html)
    ].join("\r\n");
  } else {
    body = [
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(input.text ?? "")
    ].join("\r\n");
  }

  return Buffer.from(`${headers.join("\r\n")}\r\n${body}`, "utf8");
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

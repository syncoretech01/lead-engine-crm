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
  fromAddress: string;
  configurationSet?: string;
};

export type SesSendInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
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
    const parsed = JSON.parse(context.credential.secret) as Partial<SesCredential>;
    if (!parsed.region || !parsed.accessKeyId || !parsed.secretAccessKey || !parsed.fromAddress) {
      return null;
    }
    return parsed as SesCredential;
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
      "Amazon SES credential is missing or malformed (need region, accessKeyId, secretAccessKey, fromAddress)."
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
    const response = await client.send(
      new SendEmailCommand({
        FromEmailAddress: credential.fromAddress,
        Destination: { ToAddresses: [send.to] },
        ReplyToAddresses: send.replyTo ? [send.replyTo] : undefined,
        ConfigurationSetName: credential.configurationSet,
        Content: {
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

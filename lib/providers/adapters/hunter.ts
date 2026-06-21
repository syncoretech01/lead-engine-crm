import { asNumber, asString, fetchJson, providerEmpty, providerError } from "@/lib/providers/adapters/http";
import type { LeadGrade } from "@/lib/phase1/types";
import type {
  FindEmailInput,
  FoundEmail,
  ProviderRequestContext,
  ProviderResult,
  VerifiedEmail
} from "@/lib/providers/types";

const providerId = "hunter" as const;

/**
 * Hunter Email Finder.
 * GET https://api.hunter.io/v2/email-finder?domain=&full_name=&api_key=
 * → { data: { email, score } }
 */
export async function hunterFindEmail(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<FoundEmail>> {
  const typed = input as FindEmailInput;
  const fullName = asString(typed.fullName).trim();
  const domain = asString(typed.domain).trim();
  const apiKey = context.credential?.secret;
  if (!apiKey) return providerError(providerId, context.requestId, "Hunter credential is missing.");
  if (!domain || !fullName) return providerError(providerId, context.requestId, "Hunter email-finder needs a full name and a domain.");

  const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&full_name=${encodeURIComponent(fullName)}&api_key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await fetchJson(url);
  } catch (error) {
    return providerError(providerId, context.requestId, error instanceof Error ? error.message : "Hunter request failed.");
  }
  if (!response.ok) return providerError(providerId, context.requestId, `Hunter returned HTTP ${response.status}.`);

  const data = (response.json.data ?? {}) as Record<string, unknown>;
  const email = asString(data.email).trim();
  if (!email) return providerEmpty(providerId, context.requestId, "Hunter found no email for this person.");

  return {
    status: "ok",
    data: [{ email, confidence: asNumber(data.score), source: "hunter", pattern: asString(data.pattern) || undefined }],
    meta: { providerId, requestId: context.requestId }
  };
}

/**
 * Hunter Email Verifier.
 * GET https://api.hunter.io/v2/email-verifier?email=&api_key=
 * → { data: { status, result, score } }
 */
export async function hunterVerifyEmail(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<VerifiedEmail>> {
  const email = asString((input as { email?: unknown }).email).trim();
  const apiKey = context.credential?.secret;
  if (!email) return providerError(providerId, context.requestId, "An email address is required.");
  if (!apiKey) return providerError(providerId, context.requestId, "Hunter credential is missing.");

  const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await fetchJson(url);
  } catch (error) {
    return providerError(providerId, context.requestId, error instanceof Error ? error.message : "Hunter request failed.");
  }
  if (!response.ok) return providerError(providerId, context.requestId, `Hunter returned HTTP ${response.status}.`);

  const data = (response.json.data ?? {}) as Record<string, unknown>;
  const raw = asString(data.result).toLowerCase() || asString(data.status).toLowerCase() || "unknown";
  const { status, catchAll } = mapResult(raw);
  return {
    status: "ok",
    data: [
      {
        email,
        status,
        grade: gradeFor(status),
        catchAll,
        reasonCodes: [raw],
        checkedAt: new Date().toISOString()
      }
    ],
    meta: { providerId, requestId: context.requestId }
  };
}

function mapResult(result: string): { status: VerifiedEmail["status"]; catchAll: boolean } {
  switch (result) {
    case "deliverable":
    case "valid":
      return { status: "valid", catchAll: false };
    case "accept_all":
    case "webmail":
    case "risky":
      return { status: "risky", catchAll: result === "accept_all" };
    case "undeliverable":
    case "invalid":
    case "disposable":
      return { status: "invalid", catchAll: false };
    default:
      return { status: "unknown", catchAll: false };
  }
}

function gradeFor(status: VerifiedEmail["status"]): LeadGrade {
  if (status === "valid") return "A";
  if (status === "invalid") return "D";
  return "C";
}

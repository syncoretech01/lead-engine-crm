import { asString, fetchJson, providerError } from "@/lib/providers/adapters/http";
import type { LeadGrade } from "@/lib/phase1/types";
import type { ProviderRequestContext, ProviderResult, VerifiedEmail } from "@/lib/providers/types";

const providerId = "millionverifier" as const;

/**
 * MillionVerifier single-email verification.
 * GET https://api.millionverifier.com/api/v3/?api=KEY&email=EMAIL
 * → { result: "ok" | "catch_all" | "unknown" | "disposable" | "invalid", ... }
 *
 * Response shape should be confirmed against a recorded fixture with a real key
 * before this is enabled live (see docs/PROVIDER_INTEGRATION_PLAN.md).
 */
export async function millionVerifierVerifyEmail(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<VerifiedEmail>> {
  const email = asString((input as { email?: unknown }).email).trim();
  const apiKey = context.credential?.secret;
  if (!email) return providerError(providerId, context.requestId, "An email address is required.");
  if (!apiKey) return providerError(providerId, context.requestId, "MillionVerifier credential is missing.");

  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
  let response;
  try {
    response = await fetchJson(url);
  } catch (error) {
    return providerError(providerId, context.requestId, error instanceof Error ? error.message : "MillionVerifier request failed.");
  }
  if (!response.ok) {
    return providerError(providerId, context.requestId, `MillionVerifier returned HTTP ${response.status}.`);
  }

  const raw = asString(response.json.result).toLowerCase() || "unknown";
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
    case "ok":
      return { status: "valid", catchAll: false };
    case "catch_all":
      return { status: "risky", catchAll: true };
    case "disposable":
      return { status: "risky", catchAll: false };
    case "invalid":
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

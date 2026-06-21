import { asNumber, asString, fetchJson, providerEmpty, providerError } from "@/lib/providers/adapters/http";
import type { FindEmailInput, FoundEmail, ProviderRequestContext, ProviderResult } from "@/lib/providers/types";

const providerId = "apollo" as const;

/**
 * Apollo People Match (email find).
 * POST https://api.apollo.io/api/v1/people/match  (header: X-Api-Key)
 * body { first_name, last_name, organization_name, domain }
 * → { person: { email, ... } }
 *
 * Confirm the request/response against a recorded fixture with a real key
 * before enabling live (Apollo gates email reveal by plan).
 */
export async function apolloFindEmail(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<FoundEmail>> {
  const typed = input as FindEmailInput;
  const fullName = asString(typed.fullName).trim();
  const domain = asString(typed.domain).trim();
  const companyName = asString(typed.companyName).trim();
  const apiKey = context.credential?.secret;
  if (!apiKey) return providerError(providerId, context.requestId, "Apollo credential is missing.");
  if (!fullName) return providerError(providerId, context.requestId, "Apollo people-match needs a full name.");

  const [firstName, ...rest] = fullName.split(/\s+/);
  const body = {
    first_name: firstName,
    last_name: rest.join(" "),
    organization_name: companyName || undefined,
    domain: domain || undefined
  };

  let response;
  try {
    response = await fetchJson("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return providerError(providerId, context.requestId, error instanceof Error ? error.message : "Apollo request failed.");
  }
  if (!response.ok) return providerError(providerId, context.requestId, `Apollo returned HTTP ${response.status}.`);

  const person = (response.json.person ?? {}) as Record<string, unknown>;
  const email = asString(person.email).trim();
  if (!email || email.toLowerCase().includes("email_not_unlocked")) {
    return providerEmpty(providerId, context.requestId, "Apollo returned no usable email for this person.");
  }

  return {
    status: "ok",
    data: [{ email, confidence: asNumber(person.email_confidence), source: "apollo" }],
    meta: { providerId, requestId: context.requestId }
  };
}

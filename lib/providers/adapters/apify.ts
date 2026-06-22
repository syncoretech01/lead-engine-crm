import { asNumber, asString, providerEmpty, providerError } from "@/lib/providers/adapters/http";
import type {
  DiscoverCompaniesInput,
  DiscoverContactsInput,
  DiscoveredCompany,
  DiscoveredContact,
  ProviderRequestContext,
  ProviderResult
} from "@/lib/providers/types";

// Apify actor ids use "~" in the API path (username~actor-name).
const GOOGLE_MAPS_ACTOR = "compass~google-maps-extractor"; // https://apify.com/compass/google-maps-extractor
const LINKEDIN_SEARCH_ACTOR = "harvestapi~linkedin-profile-search"; // https://apify.com/harvestapi/linkedin-profile-search

/**
 * Run an Apify actor synchronously and return its dataset items.
 * POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items?token=TOKEN
 * Body = actor input; response = an array of dataset items. Uses a longer
 * timeout since the run blocks until the actor finishes.
 */
async function runApifyActor(
  actorId: string,
  token: string,
  input: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<{ ok: boolean; status: number; items: Record<string, unknown>[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal }
    );
    const data = await response.json().catch(() => []);
    return { ok: response.ok, status: response.status, items: Array.isArray(data) ? (data as Record<string, unknown>[]) : [] };
  } finally {
    clearTimeout(timer);
  }
}

function domainFromWebsite(website: string): string | undefined {
  const trimmed = website.trim().toLowerCase();
  if (!trimmed) return undefined;
  return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || undefined;
}

/**
 * Apify Google Maps Extractor → discovered companies (local-business source).
 * Output field names should be confirmed against a real run before relying on
 * them (see docs/PROVIDER_INTEGRATION_PLAN.md).
 */
export async function apifyMapsDiscoverCompanies(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<DiscoveredCompany>> {
  const typed = input as DiscoverCompaniesInput;
  const token = context.credential?.secret;
  if (!token) return providerError("apify_maps", context.requestId, "Apify token is missing.");
  const query = asString(typed.query).trim() || (typed.industries ?? []).join(" ").trim();
  if (!query) return providerError("apify_maps", context.requestId, "A search query is required for Google Maps extraction.");

  const actorInput: Record<string, unknown> = {
    searchStringsArray: [query],
    maxCrawledPlacesPerSearch: typed.limit ?? 20,
    language: "en",
    ...(typed.geographies?.length ? { locationQuery: typed.geographies[0] } : {})
  };

  let run;
  try {
    run = await runApifyActor(GOOGLE_MAPS_ACTOR, token, actorInput);
  } catch (error) {
    return providerError("apify_maps", context.requestId, error instanceof Error ? error.message : "Apify run failed.");
  }
  if (!run.ok) return providerError("apify_maps", context.requestId, `Apify returned HTTP ${run.status}.`);
  if (run.items.length === 0) return providerEmpty("apify_maps", context.requestId, "Google Maps extraction returned no places.");

  const data: DiscoveredCompany[] = run.items.map((item) => {
    const website = asString(item.website);
    return {
      providerCompanyId: asString(item.placeId) || asString(item.fid) || asString(item.cid) || asString(item.title),
      name: asString(item.title),
      website: website || undefined,
      domain: domainFromWebsite(website),
      phone: asString(item.phone) || asString(item.phoneUnformatted) || undefined,
      industry: asString(item.categoryName) || undefined,
      city: asString(item.city) || undefined,
      state: asString(item.state) || undefined,
      country: asString(item.countryCode) || undefined,
      sourceUrl: asString(item.url) || undefined,
      confidence: asNumber(item.totalScore)
    };
  });

  return { status: "ok", data, meta: { providerId: "apify_maps", requestId: context.requestId } };
}

/**
 * Apify HarvestAPI LinkedIn Profile Search → discovered contacts. The actor's
 * exact input schema should be confirmed against a real run; output mapping is
 * defensive across common field names.
 */
export async function apifyHarvestDiscoverContacts(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<DiscoveredContact>> {
  const typed = input as DiscoverContactsInput;
  const token = context.credential?.secret;
  if (!token) return providerError("apify_harvest", context.requestId, "Apify token is missing.");
  const search = asString(typed.query).trim() || (typed.titles ?? []).join(" ").trim();
  if (!search) return providerError("apify_harvest", context.requestId, "A search query or titles are required for LinkedIn profile search.");

  const actorInput: Record<string, unknown> = {
    searchQuery: search,
    maxItems: typed.limit ?? 25,
    ...(typed.titles?.length ? { currentJobTitles: typed.titles } : {}),
    ...(typed.geographies?.length ? { locations: typed.geographies } : {})
  };

  let run;
  try {
    run = await runApifyActor(LINKEDIN_SEARCH_ACTOR, token, actorInput);
  } catch (error) {
    return providerError("apify_harvest", context.requestId, error instanceof Error ? error.message : "Apify run failed.");
  }
  if (!run.ok) return providerError("apify_harvest", context.requestId, `Apify returned HTTP ${run.status}.`);
  if (run.items.length === 0) return providerEmpty("apify_harvest", context.requestId, "LinkedIn profile search returned no results.");

  const data: DiscoveredContact[] = run.items.map((item) => {
    const fullName = asString(item.name) || asString(item.fullName) || `${asString(item.firstName)} ${asString(item.lastName)}`.trim();
    return {
      providerContactId: asString(item.publicIdentifier) || asString(item.id) || asString(item.linkedinUrl) || fullName,
      fullName,
      title: asString(item.headline) || asString(item.occupation) || asString(item.title) || undefined,
      companyName: asString(item.companyName) || asString(item.currentCompany) || undefined,
      linkedinUrl: asString(item.linkedinUrl) || asString(item.profileUrl) || asString(item.url) || undefined,
      city: asString(item.location) || undefined
    };
  });

  return { status: "ok", data, meta: { providerId: "apify_harvest", requestId: context.requestId } };
}

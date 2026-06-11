import type { ProviderCategory, ProviderConfig, ProviderId } from "@/lib/providers/types";

export const providerRegistry: ProviderConfig[] = [
  {
    id: "apollo",
    name: "Apollo",
    categories: ["lead_source", "email_finder"],
    capabilities: ["discover_companies", "discover_contacts", "find_email"],
    envVars: ["APOLLO_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "google_places",
    name: "Google Places",
    categories: ["lead_source"],
    capabilities: ["discover_companies"],
    envVars: ["GOOGLE_PLACES_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "apify",
    name: "Apify",
    categories: ["lead_source"],
    capabilities: ["discover_companies", "discover_contacts"],
    envVars: ["APIFY_TOKEN"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "hunter",
    name: "Hunter",
    categories: ["email_finder", "email_verification"],
    capabilities: ["find_email", "verify_email"],
    envVars: ["HUNTER_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "zerobounce",
    name: "ZeroBounce",
    categories: ["email_verification"],
    capabilities: ["verify_email"],
    envVars: ["ZEROBOUNCE_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "lusha",
    name: "Lusha",
    categories: ["email_finder", "phone_lookup", "enrichment"],
    capabilities: ["find_email", "find_phone", "enrich_contact"],
    envVars: ["LUSHA_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "people_data_labs",
    name: "People Data Labs",
    categories: ["enrichment"],
    capabilities: ["enrich_company", "enrich_contact"],
    envVars: ["PEOPLE_DATA_LABS_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "twilio_lookup",
    name: "Twilio Lookup",
    categories: ["phone_lookup"],
    capabilities: ["verify_phone"],
    envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "smartlead",
    name: "Smartlead",
    categories: ["outreach_sender"],
    capabilities: ["send_campaign", "process_webhook"],
    envVars: ["SMARTLEAD_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "amazon_ses",
    name: "Amazon SES",
    categories: ["transactional_email", "outreach_sender"],
    capabilities: ["send_transactional_email", "process_webhook"],
    envVars: ["AWS_SES_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  }
];

export function supportedProviders(): ProviderConfig[] {
  return [...providerRegistry];
}

export function providerConfig(providerId: ProviderId): ProviderConfig {
  const config = providerRegistry.find((provider) => provider.id === providerId);

  if (!config) {
    throw new Error(`Unsupported provider: ${providerId}`);
  }

  return config;
}

export function providersByCategory(category: ProviderCategory): ProviderConfig[] {
  return providerRegistry.filter((provider) => provider.categories.includes(category));
}

export function providerSupportsCategory(providerId: ProviderId, category: ProviderCategory): boolean {
  return providerConfig(providerId).categories.includes(category);
}

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
    id: "ringcentral",
    name: "RingCentral",
    categories: ["telephony_sms", "outreach_sender"],
    capabilities: ["send_campaign", "process_webhook"],
    envVars: [
      "RINGCENTRAL_CLIENT_ID",
      "RINGCENTRAL_CLIENT_SECRET",
      "RINGCENTRAL_JWT",
      "RINGCENTRAL_SERVER_URL"
    ],
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
  },
  {
    id: "leadmagic",
    name: "LeadMagic",
    categories: ["email_finder", "phone_lookup", "enrichment"],
    capabilities: ["find_email", "find_phone", "enrich_contact"],
    envVars: ["LEADMAGIC_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "prospeo",
    name: "Prospeo",
    categories: ["email_finder", "phone_lookup"],
    capabilities: ["find_email", "find_phone"],
    envVars: ["PROSPEO_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "findymail",
    name: "Findymail",
    categories: ["email_finder"],
    capabilities: ["find_email"],
    envVars: ["FINDYMAIL_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "contactout",
    name: "ContactOut",
    categories: ["email_finder", "phone_lookup", "enrichment"],
    capabilities: ["find_email", "find_phone", "enrich_contact"],
    envVars: ["CONTACTOUT_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "lead411",
    name: "Lead411",
    categories: ["lead_source", "phone_lookup", "email_finder"],
    capabilities: ["discover_contacts", "find_phone", "find_email"],
    envVars: ["LEAD411_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "bettercontact",
    name: "BetterContact",
    categories: ["email_finder", "phone_lookup"],
    capabilities: ["find_email", "find_phone"],
    envVars: ["BETTERCONTACT_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "fullenrich",
    name: "FullEnrich",
    categories: ["enrichment", "email_finder", "phone_lookup"],
    capabilities: ["find_email", "find_phone", "enrich_contact", "discover_contacts"],
    envVars: ["FULLENRICH_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "bouncer",
    name: "Bouncer",
    categories: ["email_verification"],
    capabilities: ["verify_email"],
    envVars: ["BOUNCER_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "millionverifier",
    name: "MillionVerifier",
    categories: ["email_verification"],
    capabilities: ["verify_email"],
    envVars: ["MILLIONVERIFIER_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "kaspr",
    name: "Kaspr",
    categories: ["phone_lookup", "email_finder"],
    capabilities: ["find_phone", "find_email"],
    envVars: ["KASPR_API_KEY"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "apify_maps",
    name: "Apify Google Maps",
    categories: ["lead_source"],
    capabilities: ["discover_companies"],
    envVars: ["APIFY_TOKEN"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "apify_harvest",
    name: "Apify HarvestAPI (LinkedIn)",
    categories: ["lead_source", "enrichment"],
    capabilities: ["discover_contacts", "enrich_contact"],
    envVars: ["APIFY_TOKEN"],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "website_scrape",
    name: "Website Scrape",
    categories: ["enrichment", "email_finder"],
    capabilities: ["enrich_company", "find_email"],
    envVars: [],
    enabledByDefault: false,
    executionMode: "mock"
  },
  {
    id: "dnc",
    name: "DNC / Suppression Check",
    categories: ["phone_lookup"],
    capabilities: ["verify_phone"],
    envVars: [],
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

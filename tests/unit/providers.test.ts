import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockEmailFinderProvider,
  createMockEmailVerificationProvider,
  createMockEnrichmentProvider,
  createMockLeadSourceProvider,
  createMockOutreachSenderProvider,
  createMockPhoneLookupProvider,
  providerConfig,
  providerSupportsCategory,
  providersByCategory,
  supportedProviders
} from "@/lib/providers";
import type { ProviderRequestContext } from "@/lib/providers";

const context: ProviderRequestContext = {
  workspaceId: "workspace-syncore",
  providerId: "apollo",
  executionMode: "mock",
  requestId: "provider-test"
};

describe("provider registry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the supported provider strategy", () => {
    expect(supportedProviders().map((provider) => provider.id)).toEqual([
      "apollo",
      "google_places",
      "apify",
      "hunter",
      "zerobounce",
      "twilio_lookup",
      "ringcentral",
      "smartlead",
      "amazon_ses",
      "leadmagic",
      "prospeo",
      "findymail",
      "contactout",
      "lead411",
      "bouncer",
      "millionverifier",
      "apify_maps",
      "apify_harvest",
      "website_scrape",
      "dnc"
    ]);
  });

  it("assigns providers to the expected categories", () => {
    expect(providerSupportsCategory("apollo", "lead_source")).toBe(true);
    expect(providerSupportsCategory("google_places", "lead_source")).toBe(true);
    expect(providerSupportsCategory("apify", "lead_source")).toBe(true);
    expect(providerSupportsCategory("hunter", "email_finder")).toBe(true);
    expect(providerSupportsCategory("hunter", "email_verification")).toBe(true);
    expect(providerSupportsCategory("zerobounce", "email_verification")).toBe(true);
    expect(providerSupportsCategory("millionverifier", "email_verification")).toBe(true);
    expect(providerSupportsCategory("twilio_lookup", "phone_lookup")).toBe(true);
    expect(providerSupportsCategory("ringcentral", "telephony_sms")).toBe(true);
    expect(providerSupportsCategory("ringcentral", "outreach_sender")).toBe(true);
    expect(providerSupportsCategory("smartlead", "outreach_sender")).toBe(true);
    expect(providerSupportsCategory("amazon_ses", "transactional_email")).toBe(true);
    expect(providersByCategory("lead_source").map((provider) => provider.id)).toEqual([
      "apollo",
      "google_places",
      "apify",
      "lead411",
      "apify_maps",
      "apify_harvest"
    ]);
  });

  it("exposes required future env vars through provider config", () => {
    expect(providerConfig("apollo").envVars).toEqual(["APOLLO_API_KEY"]);
    expect(providerConfig("twilio_lookup").envVars).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);
    expect(providerConfig("ringcentral").envVars).toEqual([
      "RINGCENTRAL_CLIENT_ID",
      "RINGCENTRAL_CLIENT_SECRET",
      "RINGCENTRAL_JWT",
      "RINGCENTRAL_SERVER_URL"
    ]);
    expect(providerConfig("amazon_ses").envVars).toEqual([
      "AWS_SES_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY"
    ]);
  });

  it("mock adapters satisfy interface contracts without returning live data", async () => {
    const leadSource = createMockLeadSourceProvider("apollo");
    const emailFinder = createMockEmailFinderProvider("hunter");
    const emailVerifier = createMockEmailVerificationProvider("zerobounce");
    const phoneLookup = createMockPhoneLookupProvider("twilio_lookup");
    const enrichment = createMockEnrichmentProvider("website_scrape");
    const sender = createMockOutreachSenderProvider("smartlead");
    const telephonySender = createMockOutreachSenderProvider("ringcentral");

    await expect(leadSource.discoverCompanies({ query: "dealers" }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(leadSource.discoverContacts({ titles: ["Owner"] }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(emailFinder.findEmail({ fullName: "Nora West", domain: "syncore.tech" }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(emailVerifier.verifyEmail({ email: "nora@syncore.tech" }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(phoneLookup.verifyPhone({ phone: "+15550109000" }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(enrichment.enrichCompany({ domain: "syncore.tech" }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(enrichment.enrichContact({ email: "nora@syncore.tech" }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(sender.sendCampaign({ campaignId: "campaign-1" }, context)).resolves.toMatchObject({
      status: "skipped",
      data: []
    });
    await expect(
      telephonySender.sendCampaign({ campaignId: "sms-campaign-1" }, {
        ...context,
        providerId: "ringcentral"
      })
    ).resolves.toMatchObject({
      status: "skipped",
      data: []
    });

    const webhook = await sender.processWebhook(
      { providerEventId: "evt-1", eventType: "reply", payload: { local: true } },
      context
    );
    expect(webhook.data[0]).toMatchObject({
      providerEventId: "evt-1",
      eventType: "reply",
      status: "ignored"
    });
  });

  it("does not make real network calls from mock adapters", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Network access is forbidden in mock adapters.");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const leadSource = createMockLeadSourceProvider("google_places");
    const sender = createMockOutreachSenderProvider("amazon_ses");

    await leadSource.discoverCompanies({ query: "local shops" }, {
      ...context,
      providerId: "google_places"
    });
    await sender.sendCampaign({ campaignId: "transactional-test" }, {
      ...context,
      providerId: "amazon_ses"
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

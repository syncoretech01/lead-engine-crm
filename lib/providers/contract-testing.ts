import {
  createMockEmailFinderProvider,
  createMockEmailVerificationProvider,
  createMockEnrichmentProvider,
  createMockLeadSourceProvider,
  createMockOutreachSenderProvider,
  createMockPhoneLookupProvider
} from "@/lib/providers/mock-adapters";
import { providerConfig } from "@/lib/providers/registry";
import type {
  DiscoverCompaniesInput,
  DiscoverContactsInput,
  EnrichCompanyInput,
  EnrichContactInput,
  FindEmailInput,
  FindPhoneInput,
  ProcessWebhookInput,
  ProviderCapability,
  ProviderId,
  ProviderRequestContext,
  ProviderResult,
  SendCampaignInput,
  VerifyEmailInput,
  VerifyPhoneInput
} from "@/lib/providers/types";

export type ProviderContractFixture = {
  id: string;
  providerId: ProviderId;
  operation: ProviderCapability;
  recordedAt: string;
  mode: "mock-fixture" | "recorded-fixture";
  description: string;
  input: Record<string, unknown>;
  expected: {
    status: ProviderResult<unknown>["status"];
    dataLength: number;
    warningIncludes?: string;
  };
  providerResponseFixture?: Record<string, unknown>;
  normalizedResultFixture?: Record<string, unknown>;
};

export async function runProviderContractFixture(
  fixture: ProviderContractFixture,
  context: Omit<ProviderRequestContext, "providerId">
): Promise<ProviderResult<unknown>> {
  const config = providerConfig(fixture.providerId);
  if (!config.capabilities.includes(fixture.operation)) {
    throw new Error(`${config.name} does not advertise ${fixture.operation}.`);
  }

  const result = await executeMockOperation(fixture, {
    ...context,
    providerId: fixture.providerId
  });

  assertProviderResultContract(fixture, result);
  return result;
}

export function assertProviderFixtureIsRedacted(fixture: ProviderContractFixture) {
  const serialized = JSON.stringify(fixture);
  if (/api[_-]?key|secret|token|authorization|password/i.test(serialized)) {
    throw new Error(`Provider fixture ${fixture.id} contains secret-like text.`);
  }
}

export function assertProviderResultContract(fixture: ProviderContractFixture, result: ProviderResult<unknown>) {
  if (result.meta.providerId !== fixture.providerId) {
    throw new Error(`Provider fixture ${fixture.id} returned the wrong provider id.`);
  }
  if (result.status !== fixture.expected.status) {
    throw new Error(`Provider fixture ${fixture.id} returned status ${result.status}.`);
  }
  if (!Array.isArray(result.data)) {
    throw new Error(`Provider fixture ${fixture.id} did not return a data array.`);
  }
  if (result.data.length !== fixture.expected.dataLength) {
    throw new Error(`Provider fixture ${fixture.id} returned ${result.data.length} data rows.`);
  }
  if (
    fixture.expected.warningIncludes &&
    !result.meta.warnings?.some((warning) => warning.includes(fixture.expected.warningIncludes ?? ""))
  ) {
    throw new Error(`Provider fixture ${fixture.id} did not return the expected warning.`);
  }
}

async function executeMockOperation(
  fixture: ProviderContractFixture,
  context: ProviderRequestContext
): Promise<ProviderResult<unknown>> {
  switch (fixture.operation) {
    case "discover_companies":
      return createMockLeadSourceProvider(fixture.providerId)
        .discoverCompanies(fixture.input as DiscoverCompaniesInput, context);
    case "discover_contacts":
      return createMockLeadSourceProvider(fixture.providerId)
        .discoverContacts(fixture.input as DiscoverContactsInput, context);
    case "find_email":
      return createMockEmailFinderProvider(fixture.providerId)
        .findEmail(fixture.input as FindEmailInput, context);
    case "verify_email":
      return createMockEmailVerificationProvider(fixture.providerId)
        .verifyEmail(fixture.input as VerifyEmailInput, context);
    case "find_phone":
      return createMockPhoneLookupProvider(fixture.providerId)
        .findPhone?.(fixture.input as FindPhoneInput, context) ?? skipped(fixture, context);
    case "verify_phone":
      return createMockPhoneLookupProvider(fixture.providerId)
        .verifyPhone(fixture.input as VerifyPhoneInput, context);
    case "enrich_company":
      return createMockEnrichmentProvider(fixture.providerId)
        .enrichCompany(fixture.input as EnrichCompanyInput, context);
    case "enrich_contact":
      return createMockEnrichmentProvider(fixture.providerId)
        .enrichContact(fixture.input as EnrichContactInput, context);
    case "send_campaign":
      return createMockOutreachSenderProvider(fixture.providerId)
        .sendCampaign(fixture.input as SendCampaignInput, context);
    case "process_webhook":
      return createMockOutreachSenderProvider(fixture.providerId)
        .processWebhook(fixture.input as ProcessWebhookInput, context);
    case "send_transactional_email":
      return skipped(fixture, context);
  }
}

function skipped(fixture: ProviderContractFixture, context: ProviderRequestContext): ProviderResult<unknown> {
  return {
    status: "skipped",
    data: [],
    meta: {
      providerId: fixture.providerId,
      requestId: context.requestId,
      warnings: [`${fixture.operation} contract fixture is pending a dedicated adapter interface.`]
    }
  };
}

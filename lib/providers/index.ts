export type {
  BaseProvider,
  EmailFinderProvider,
  EmailVerificationProvider,
  EnrichmentProvider,
  LeadSourceProvider,
  OutreachSenderProvider,
  PhoneLookupProvider
} from "@/lib/providers/interfaces";
export {
  createMockEmailFinderProvider,
  createMockEmailVerificationProvider,
  createMockEnrichmentProvider,
  createMockLeadSourceProvider,
  createMockOutreachSenderProvider,
  createMockPhoneLookupProvider
} from "@/lib/providers/mock-adapters";
export {
  providerConfig,
  providerRegistry,
  providerSupportsCategory,
  providersByCategory,
  supportedProviders
} from "@/lib/providers/registry";
export type {
  CampaignSendResult,
  DiscoveredCompany,
  DiscoveredContact,
  EnrichedCompany,
  EnrichedContact,
  FoundEmail,
  FoundPhone,
  ProviderCapability,
  ProviderCategory,
  ProviderConfig,
  ProviderExecutionMode,
  ProviderId,
  ProviderRequestContext,
  ProviderResponseMeta,
  ProviderResult,
  ProviderResultStatus,
  VerifiedEmail,
  VerifiedPhone,
  WebhookEventResult
} from "@/lib/providers/types";

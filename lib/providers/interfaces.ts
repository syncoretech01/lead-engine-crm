import type {
  CampaignSendResult,
  DiscoveredCompany,
  DiscoveredContact,
  DiscoverCompaniesInput,
  DiscoverContactsInput,
  EnrichedCompany,
  EnrichedContact,
  EnrichCompanyInput,
  EnrichContactInput,
  FindEmailInput,
  FindPhoneInput,
  FoundEmail,
  FoundPhone,
  ProcessWebhookInput,
  ProviderId,
  ProviderRequestContext,
  ProviderResult,
  SendCampaignInput,
  VerifiedEmail,
  VerifiedPhone,
  VerifyEmailInput,
  VerifyPhoneInput,
  WebhookEventResult
} from "@/lib/providers/types";

export type BaseProvider = {
  id: ProviderId;
  displayName: string;
  isMock: boolean;
};

export type LeadSourceProvider = BaseProvider & {
  discoverCompanies(
    input: DiscoverCompaniesInput,
    context: ProviderRequestContext
  ): Promise<ProviderResult<DiscoveredCompany>>;
  discoverContacts(
    input: DiscoverContactsInput,
    context: ProviderRequestContext
  ): Promise<ProviderResult<DiscoveredContact>>;
};

export type EmailFinderProvider = BaseProvider & {
  findEmail(input: FindEmailInput, context: ProviderRequestContext): Promise<ProviderResult<FoundEmail>>;
};

export type EmailVerificationProvider = BaseProvider & {
  verifyEmail(input: VerifyEmailInput, context: ProviderRequestContext): Promise<ProviderResult<VerifiedEmail>>;
};

export type PhoneLookupProvider = BaseProvider & {
  findPhone?(input: FindPhoneInput, context: ProviderRequestContext): Promise<ProviderResult<FoundPhone>>;
  verifyPhone(input: VerifyPhoneInput, context: ProviderRequestContext): Promise<ProviderResult<VerifiedPhone>>;
};

export type EnrichmentProvider = BaseProvider & {
  enrichCompany(
    input: EnrichCompanyInput,
    context: ProviderRequestContext
  ): Promise<ProviderResult<EnrichedCompany>>;
  enrichContact(
    input: EnrichContactInput,
    context: ProviderRequestContext
  ): Promise<ProviderResult<EnrichedContact>>;
};

export type OutreachSenderProvider = BaseProvider & {
  sendCampaign(
    input: SendCampaignInput,
    context: ProviderRequestContext
  ): Promise<ProviderResult<CampaignSendResult>>;
  processWebhook(
    input: ProcessWebhookInput,
    context: ProviderRequestContext
  ): Promise<ProviderResult<WebhookEventResult>>;
};

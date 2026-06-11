import type {
  EmailFinderProvider,
  EmailVerificationProvider,
  EnrichmentProvider,
  LeadSourceProvider,
  OutreachSenderProvider,
  PhoneLookupProvider
} from "@/lib/providers/interfaces";
import { providerConfig } from "@/lib/providers/registry";
import type {
  CampaignSendResult,
  DiscoveredCompany,
  DiscoveredContact,
  EnrichedCompany,
  EnrichedContact,
  FoundEmail,
  FoundPhone,
  ProviderId,
  ProviderRequestContext,
  ProviderResult,
  VerifiedEmail,
  VerifiedPhone,
  WebhookEventResult
} from "@/lib/providers/types";

function emptyResult<T>(providerId: ProviderId, context: ProviderRequestContext, warning: string): ProviderResult<T> {
  return {
    status: "skipped",
    data: [],
    meta: {
      providerId,
      requestId: context.requestId,
      warnings: [warning]
    }
  };
}

function displayName(providerId: ProviderId) {
  return providerConfig(providerId).name;
}

export function createMockLeadSourceProvider(providerId: ProviderId): LeadSourceProvider {
  return {
    id: providerId,
    displayName: displayName(providerId),
    isMock: true,
    async discoverCompanies(_input, context): Promise<ProviderResult<DiscoveredCompany>> {
      return emptyResult(providerId, context, "Mock lead source does not perform network discovery.");
    },
    async discoverContacts(_input, context): Promise<ProviderResult<DiscoveredContact>> {
      return emptyResult(providerId, context, "Mock lead source does not perform network contact discovery.");
    }
  };
}

export function createMockEmailFinderProvider(providerId: ProviderId): EmailFinderProvider {
  return {
    id: providerId,
    displayName: displayName(providerId),
    isMock: true,
    async findEmail(_input, context): Promise<ProviderResult<FoundEmail>> {
      return emptyResult(providerId, context, "Mock email finder does not call external email APIs.");
    }
  };
}

export function createMockEmailVerificationProvider(providerId: ProviderId): EmailVerificationProvider {
  return {
    id: providerId,
    displayName: displayName(providerId),
    isMock: true,
    async verifyEmail(_input, context): Promise<ProviderResult<VerifiedEmail>> {
      return emptyResult(providerId, context, "Mock email verifier does not call external verification APIs.");
    }
  };
}

export function createMockPhoneLookupProvider(providerId: ProviderId): PhoneLookupProvider {
  return {
    id: providerId,
    displayName: displayName(providerId),
    isMock: true,
    async findPhone(_input, context): Promise<ProviderResult<FoundPhone>> {
      return emptyResult(providerId, context, "Mock phone finder does not call external phone APIs.");
    },
    async verifyPhone(_input, context): Promise<ProviderResult<VerifiedPhone>> {
      return emptyResult(providerId, context, "Mock phone lookup does not call external phone APIs.");
    }
  };
}

export function createMockEnrichmentProvider(providerId: ProviderId): EnrichmentProvider {
  return {
    id: providerId,
    displayName: displayName(providerId),
    isMock: true,
    async enrichCompany(_input, context): Promise<ProviderResult<EnrichedCompany>> {
      return emptyResult(providerId, context, "Mock enrichment provider does not call external company APIs.");
    },
    async enrichContact(_input, context): Promise<ProviderResult<EnrichedContact>> {
      return emptyResult(providerId, context, "Mock enrichment provider does not call external contact APIs.");
    }
  };
}

export function createMockOutreachSenderProvider(providerId: ProviderId): OutreachSenderProvider {
  return {
    id: providerId,
    displayName: displayName(providerId),
    isMock: true,
    async sendCampaign(_input, context): Promise<ProviderResult<CampaignSendResult>> {
      return emptyResult(providerId, context, "Mock outreach sender does not send email or call external APIs.");
    },
    async processWebhook(input, context): Promise<ProviderResult<WebhookEventResult>> {
      return {
        status: "skipped",
        data: [
          {
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            status: "ignored",
            receivedAt: new Date(0).toISOString(),
            reason: "Mock outreach sender does not process live webhooks."
          }
        ],
        meta: {
          providerId,
          requestId: context.requestId,
          warnings: ["Mock outreach sender does not process live webhooks."]
        }
      };
    }
  };
}

export type ProviderId =
  | "apollo"
  | "google_places"
  | "apify"
  | "hunter"
  | "zerobounce"
  | "lusha"
  | "people_data_labs"
  | "twilio_lookup"
  | "ringcentral"
  | "smartlead"
  | "amazon_ses";

export type ProviderCategory =
  | "lead_source"
  | "email_finder"
  | "email_verification"
  | "phone_lookup"
  | "telephony_sms"
  | "enrichment"
  | "outreach_sender"
  | "transactional_email";

export type ProviderExecutionMode = "mock" | "live";

/**
 * Credential delivered to a live adapter at call time. Resolved during the
 * (sync, state-bound) plan phase and carried on the request context into the
 * (async, stateless) invoke phase — the secret never touches persisted state.
 * For multi-field providers, `secret` is a JSON string by convention.
 */
export type ProviderCredential = {
  source: "vault" | "environment";
  secret: string;
  keyId?: string;
};

export type ProviderRequestContext = {
  workspaceId: string;
  providerId: ProviderId;
  executionMode: ProviderExecutionMode;
  requestId?: string;
  actorUserId?: string;
  credential?: ProviderCredential;
};

export type ProviderCapability =
  | "discover_companies"
  | "discover_contacts"
  | "find_email"
  | "verify_email"
  | "find_phone"
  | "verify_phone"
  | "enrich_company"
  | "enrich_contact"
  | "send_campaign"
  | "process_webhook"
  | "send_transactional_email";

export type ProviderConfig = {
  id: ProviderId;
  name: string;
  categories: ProviderCategory[];
  capabilities: ProviderCapability[];
  envVars: string[];
  enabledByDefault: boolean;
  executionMode: ProviderExecutionMode;
};

export type ProviderResponseMeta = {
  providerId: ProviderId;
  requestId?: string;
  sourceRecordId?: string;
  rawPayload?: Record<string, string | number | boolean | undefined>;
  warnings?: string[];
};

export type ProviderResultStatus = "ok" | "empty" | "skipped" | "error";

export type ProviderResult<T> = {
  status: ProviderResultStatus;
  data: T[];
  meta: ProviderResponseMeta;
  errorMessage?: string;
};

export type DiscoveredCompany = {
  providerCompanyId: string;
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  sourceUrl?: string;
  confidence?: number;
};

export type DiscoveredContact = {
  providerContactId: string;
  companyProviderId?: string;
  companyName?: string;
  fullName: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  city?: string;
  state?: string;
  country?: string;
  confidence?: number;
};

export type FoundEmail = {
  email: string;
  confidence?: number;
  source: string;
  pattern?: string;
};

export type VerifiedEmail = {
  email: string;
  status: "valid" | "risky" | "invalid" | "unknown";
  grade: "A" | "B" | "C" | "D" | "S";
  catchAll?: boolean;
  disposable?: boolean;
  roleEmail?: boolean;
  reasonCodes: string[];
  checkedAt: string;
  ttlDays?: number;
};

export type FoundPhone = {
  phone: string;
  confidence?: number;
  source: string;
  phoneType?: "mobile" | "landline" | "voip" | "unknown";
};

export type VerifiedPhone = {
  phone: string;
  normalizedPhone?: string;
  status: "valid" | "invalid" | "unknown";
  lineType?: "mobile" | "landline" | "voip" | "toll_free" | "unknown";
  carrier?: string;
  countryCode?: string;
  checkedAt: string;
  reasonCodes: string[];
};

export type EnrichedCompany = {
  name?: string;
  domain?: string;
  website?: string;
  industry?: string;
  employeeBand?: string;
  revenueBand?: string;
  city?: string;
  state?: string;
  country?: string;
  technologies?: string[];
  confidence?: number;
};

export type EnrichedContact = {
  fullName?: string;
  title?: string;
  seniority?: string;
  department?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  country?: string;
  confidence?: number;
};

export type CampaignSendResult = {
  providerCampaignId?: string;
  providerMessageId?: string;
  status: "queued" | "sent" | "skipped" | "failed";
  recipient?: string;
  scheduledAt?: string;
  sentAt?: string;
  reason?: string;
};

export type WebhookEventResult = {
  providerEventId: string;
  eventType: string;
  status: "processed" | "duplicate" | "ignored" | "failed";
  processedRecordId?: string;
  receivedAt: string;
  reason?: string;
};

export type DiscoverCompaniesInput = {
  query?: string;
  industries?: string[];
  geographies?: string[];
  limit?: number;
};

export type DiscoverContactsInput = DiscoverCompaniesInput & {
  companyIds?: string[];
  titles?: string[];
};

export type FindEmailInput = {
  fullName: string;
  domain?: string;
  companyName?: string;
};

export type VerifyEmailInput = {
  email: string;
};

export type FindPhoneInput = {
  fullName?: string;
  companyName?: string;
  domain?: string;
};

export type VerifyPhoneInput = {
  phone: string;
  countryCode?: string;
};

export type EnrichCompanyInput = {
  name?: string;
  domain?: string;
  providerCompanyId?: string;
};

export type EnrichContactInput = {
  fullName?: string;
  email?: string;
  providerContactId?: string;
  companyName?: string;
  domain?: string;
};

export type SendCampaignInput = {
  campaignId: string;
  recipientEmail?: string;
  subject?: string;
  body?: string;
};

export type ProcessWebhookInput = {
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

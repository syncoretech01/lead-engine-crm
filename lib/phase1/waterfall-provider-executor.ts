import { getLiveProviderOperation } from "@/lib/providers/live-adapters";
import type { WaterfallLeadState } from "@/lib/phase1/waterfall-conditions";
import type { WaterfallProviderOutcome } from "@/lib/phase1/waterfall-engine";
import type { WaterfallExecutor } from "@/lib/phase1/waterfall-runner";
import type { FieldProvenanceStatus, PhoneLineType } from "@/lib/phase1/types";
import type {
  ProviderCapability,
  ProviderCredential,
  ProviderId,
  ProviderRequestContext,
  ProviderResult
} from "@/lib/providers/types";

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function emailStatus(value: unknown, catchAll: unknown): FieldProvenanceStatus {
  if (catchAll === true) return "catch_all";
  const status = String(value ?? "");
  if (status === "valid" || status === "risky" || status === "invalid" || status === "unknown") return status;
  return "unknown";
}

function phoneStatus(value: unknown): FieldProvenanceStatus {
  const status = String(value ?? "");
  if (status === "valid" || status === "invalid" || status === "unknown") return status;
  return "unknown";
}

function phoneType(value: unknown): PhoneLineType | undefined {
  switch (String(value ?? "")) {
    case "mobile":
      return "mobile";
    case "direct_dial":
      return "direct_dial";
    case "landline":
      return "landline";
    case "voip":
      return "voip";
    case "toll_free":
    case "company_main":
      return "company_main";
    default:
      return undefined;
  }
}

/** Normalize a provider's typed result into the engine's accept/gate outcome. Pure. */
export function mapProviderResultToOutcome(
  capability: ProviderCapability,
  result: ProviderResult<unknown>
): WaterfallProviderOutcome {
  if (result.status !== "ok" || result.data.length === 0) {
    return { found: false };
  }
  const row = result.data[0] as Record<string, unknown>;

  switch (capability) {
    case "find_email":
      return { found: true, value: String(row.email ?? ""), confidence: num(row.confidence) };
    case "verify_email":
      return {
        found: true,
        value: String(row.email ?? ""),
        validationStatus: emailStatus(row.status, row.catchAll),
        confidence: num(row.confidence)
      };
    case "find_phone":
      return { found: true, value: String(row.phone ?? ""), phoneType: phoneType(row.phoneType), confidence: num(row.confidence) };
    case "verify_phone":
      return {
        found: true,
        value: String(row.phone ?? row.normalizedPhone ?? ""),
        validationStatus: phoneStatus(row.status),
        phoneType: phoneType(row.lineType ?? row.phoneType)
      };
    default:
      // discover_contacts / enrich_* / discover_companies — presence is the signal.
      return { found: result.data.length > 0 };
  }
}

function buildProviderInput(capability: ProviderCapability, lead: WaterfallLeadState): Record<string, unknown> {
  switch (capability) {
    case "find_email":
      return { fullName: lead.fullName, domain: lead.domain, companyName: lead.companyName };
    case "verify_email":
      return { email: lead.email };
    case "find_phone":
      return { fullName: lead.fullName, companyName: lead.companyName, domain: lead.domain };
    case "verify_phone":
      return { phone: lead.phone, countryCode: lead.country };
    case "discover_contacts":
      return { companyName: lead.companyName, domain: lead.domain };
    case "enrich_contact":
      return { fullName: lead.fullName, email: lead.email, domain: lead.domain };
    case "enrich_company":
      return { name: lead.companyName, domain: lead.domain };
    case "discover_companies":
      return { query: lead.companyName, geographies: lead.country ? [lead.country] : undefined };
    default:
      return {};
  }
}

/**
 * Build the executor that backs a real enrichment run. It calls the registered
 * live adapter for the dispatched (provider, capability) **only** when that
 * provider is in `liveProviderIds` (connections in live mode with the global
 * flag on, computed in the read phase) and an adapter is registered. Otherwise
 * it returns "not found" and makes **no network call** — so mock mode and the
 * `SYNCORE_ENABLE_LIVE_PROVIDERS` kill-switch are both honored. Credentials are
 * resolved in the state-bound read phase and passed in.
 */
export function createWaterfallExecutor(input: {
  workspaceId: string;
  liveProviderIds: Set<string>;
  credentials?: Record<string, ProviderCredential>;
}): WaterfallExecutor {
  return async (dispatch, leadState) => {
    if (!input.liveProviderIds.has(dispatch.providerId)) {
      return { found: false };
    }
    const handler = getLiveProviderOperation(dispatch.providerId as ProviderId, dispatch.capability);
    if (!handler) {
      return { found: false };
    }
    const context: ProviderRequestContext = {
      workspaceId: input.workspaceId,
      providerId: dispatch.providerId as ProviderId,
      executionMode: "live",
      requestId: `wf-${dispatch.stepId}-${dispatch.providerId}`,
      credential: input.credentials?.[dispatch.providerId]
    };
    const result = (await handler(buildProviderInput(dispatch.capability, leadState), context)) as ProviderResult<unknown>;
    return mapProviderResultToOutcome(dispatch.capability, result);
  };
}

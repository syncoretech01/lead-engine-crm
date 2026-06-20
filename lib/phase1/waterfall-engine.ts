import { estimatedProviderCostCents } from "@/lib/phase1/money";
import { evaluateCondition, type WaterfallLeadState } from "@/lib/phase1/waterfall-conditions";
import type {
  FieldProvenanceStatus,
  PhoneLineType,
  ProviderConnection,
  WaterfallQualityGate,
  WaterfallStep,
  WaterfallTemplate
} from "@/lib/phase1/types";
import type { ProviderCapability } from "@/lib/providers/types";

/**
 * Pure, synchronous waterfall planner (see docs/CAMPAIGN_WATERFALLS.md §7).
 * Given a template, a lead's current state, the workspace's provider
 * connections, what's already been attempted, and the lead's accumulated cost,
 * it returns the next provider to dispatch — or `done`. The worker re-invokes
 * it after each provider result. No store access, so it is unit-testable.
 */
export type WaterfallPlanOptions = {
  connections: ProviderConnection[];
  attempted: Set<string>;
  leadCostCents: number;
};

export type WaterfallPlan =
  | {
      kind: "dispatch";
      stepId: string;
      stage: WaterfallStep["stage"];
      capability: ProviderCapability;
      providerId: string;
      estimatedCostCents: number;
    }
  | { kind: "done"; reason: string };

export type WaterfallProviderOutcome = {
  found: boolean;
  value?: string;
  confidence?: number;
  validationStatus?: FieldProvenanceStatus;
  phoneType?: PhoneLineType;
};

export function isHighValueLead(state: WaterfallLeadState, template: Pick<WaterfallTemplate, "highValueScoreThreshold">): boolean {
  if (state.isHighValue) return true;
  if (template.highValueScoreThreshold != null && state.leadScore != null) {
    return state.leadScore >= template.highValueScoreThreshold;
  }
  return false;
}

/** A step is satisfied (skippable) when its stop condition already holds. */
export function trackSatisfied(step: WaterfallStep, state: WaterfallLeadState): boolean {
  return step.stopIf ? evaluateCondition(step.stopIf, state) : false;
}

/**
 * Eligible providers for a step, in priority order: enabled + capable + (if the
 * template targets a country) country-eligible. An explicit `providerIds` list
 * is the ranked subset; otherwise fall back to the global `waterfallOrder`.
 * Pseudo-ids (e.g. "cache", "csv") have no connection and are filtered out.
 */
export function rankProviders(step: WaterfallStep, connections: ProviderConnection[], country?: string): string[] {
  const isEligible = (providerId: string): boolean => {
    const connection = connections.find((item) => item.providerId === providerId);
    if (!connection || !connection.enabled) return false;
    if (!connection.capabilities.includes(step.capability)) return false;
    if (
      country &&
      connection.supportedCountries &&
      connection.supportedCountries.length > 0 &&
      !connection.supportedCountries.includes(country)
    ) {
      return false;
    }
    return true;
  };

  if (step.providerIds.length > 0) {
    return step.providerIds.filter(isEligible);
  }
  return connections
    .filter((connection) => isEligible(connection.providerId))
    .sort((a, b) => a.waterfallOrder - b.waterfallOrder)
    .map((connection) => connection.providerId);
}

export function planNextWaterfallStep(
  template: WaterfallTemplate,
  state: WaterfallLeadState,
  options: WaterfallPlanOptions
): WaterfallPlan {
  const steps = [...template.steps].sort((a, b) => a.order - b.order);

  for (const step of steps) {
    if (trackSatisfied(step, state)) continue; // stop condition already met
    if (!evaluateCondition(step.runIf, state)) continue; // run-only-if gate
    if (step.highValueOnly && !isHighValueLead(state, template)) continue;

    for (const providerId of rankProviders(step, options.connections, template.country)) {
      if (options.attempted.has(`${step.id}:${providerId}`)) continue;

      const connection = options.connections.find((item) => item.providerId === providerId);
      const estimatedCostCents =
        connection?.costPerUnitCents ??
        estimatedProviderCostCents({ provider: providerId, operation: step.capability, unitsUsed: 1 });

      if (step.costCapCents != null && estimatedCostCents > step.costCapCents) continue;
      if (
        template.maxCostPerLeadCents != null &&
        options.leadCostCents + estimatedCostCents > template.maxCostPerLeadCents
      ) {
        continue; // lead budget would be exceeded; try a cheaper provider/step
      }

      return {
        kind: "dispatch",
        stepId: step.id,
        stage: step.stage,
        capability: step.capability,
        providerId,
        estimatedCostCents
      };
    }
  }

  return { kind: "done", reason: "No eligible waterfall steps remain for this lead." };
}

/**
 * Acceptance gate for a provider result (see §10). A failed gate means the
 * engine falls through to the next provider rather than accepting the value.
 * `rejectVoipForSms` is an SMS-eligibility flag handled downstream, not a
 * rejection here (VoIP is still acceptable for calling).
 */
export function passesQualityGate(outcome: WaterfallProviderOutcome, gate?: WaterfallQualityGate): boolean {
  if (!outcome.found) return false;
  if (!gate) return true;

  if (gate.minConfidence != null && (outcome.confidence ?? 0) < gate.minConfidence) return false;
  if (gate.acceptStatus && outcome.validationStatus && !gate.acceptStatus.includes(outcome.validationStatus)) return false;
  if (gate.rejectStatus && outcome.validationStatus && gate.rejectStatus.includes(outcome.validationStatus)) return false;
  if (gate.allowCatchAll === false && outcome.validationStatus === "catch_all") return false;

  if (gate.phoneTypeIn && outcome.phoneType && !gate.phoneTypeIn.includes(outcome.phoneType)) {
    const companyMainAllowed = gate.allowCompanyMain === true && outcome.phoneType === "company_main";
    if (!companyMainAllowed) return false;
  }

  return true;
}

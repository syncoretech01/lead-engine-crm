import { randomUUID } from "node:crypto";
import {
  passesQualityGate,
  planNextWaterfallStep,
  type WaterfallPlan,
  type WaterfallProviderOutcome
} from "@/lib/phase1/waterfall-engine";
import type { WaterfallLeadState } from "@/lib/phase1/waterfall-conditions";
import type { FieldSource, ProviderConnection, WaterfallStep, WaterfallTemplate } from "@/lib/phase1/types";

/**
 * Executes one provider dispatch and returns the normalized outcome. In
 * production this calls the real provider job machinery (out-of-band worker);
 * in tests a fake executor stands in. This is the only async/side-effecting
 * seam — the planner and gate around it stay pure.
 */
export type WaterfallExecutor = (dispatch: Extract<WaterfallPlan, { kind: "dispatch" }>) => Promise<WaterfallProviderOutcome>;

export type WaterfallRunResult = {
  fieldSources: FieldSource[];
  attempts: number;
  accepted: number;
  costCents: number;
  reason: string;
  finalState: WaterfallLeadState;
};

const defaultMaxIterations = 50;

/**
 * Drive a single lead through a template: plan → execute → gate → accept →
 * re-plan, until the planner reports `done` (all tracks satisfied / no eligible
 * provider / budget exhausted). Pure orchestration — the caller persists the
 * returned field sources and accumulated cost.
 */
export async function runWaterfallForLead(input: {
  template: WaterfallTemplate;
  workspaceId: string;
  targetType: "contact" | "company";
  targetId: string;
  initialState: WaterfallLeadState;
  connections: ProviderConnection[];
  executor: WaterfallExecutor;
  now?: string;
  maxIterations?: number;
}): Promise<WaterfallRunResult> {
  const now = input.now ?? new Date().toISOString();
  const maxIterations = input.maxIterations ?? defaultMaxIterations;
  const state: WaterfallLeadState = { ...input.initialState };
  const attempted = new Set<string>();
  const fieldSources: FieldSource[] = [];
  let costCents = 0;
  let attempts = 0;
  let accepted = 0;

  for (let i = 0; i < maxIterations; i += 1) {
    const plan = planNextWaterfallStep(input.template, state, { connections: input.connections, attempted, leadCostCents: costCents });
    if (plan.kind === "done") {
      return { fieldSources, attempts, accepted, costCents, reason: plan.reason, finalState: state };
    }

    attempted.add(`${plan.stepId}:${plan.providerId}`);
    attempts += 1;
    costCents += plan.estimatedCostCents; // a dispatched call costs whether or not it's accepted

    const step = input.template.steps.find((item) => item.id === plan.stepId);
    const outcome = await input.executor(plan);

    if (passesQualityGate(outcome, step?.qualityGate)) {
      applyOutcomeToState(state, plan, outcome);
      const field = fieldForStage(plan.stage);
      if (field) {
        fieldSources.push(
          buildFieldSource({
            workspaceId: input.workspaceId,
            targetType: input.targetType,
            targetId: input.targetId,
            field,
            value: outcome.value ?? (field === "email" ? state.email : field === "phone" ? state.phone : "") ?? "",
            providerId: plan.providerId,
            capability: plan.capability,
            outcome,
            costCents: plan.estimatedCostCents,
            isVerify: plan.stage === "verify_email" || plan.stage === "verify_phone",
            now
          })
        );
      }
      accepted += 1;
    }
  }

  return { fieldSources, attempts, accepted, costCents, reason: "Reached max iterations.", finalState: state };
}

function fieldForStage(stage: WaterfallStep["stage"]): "email" | "phone" | "contact" | undefined {
  switch (stage) {
    case "find_email":
    case "verify_email":
      return "email";
    case "find_phone":
    case "verify_phone":
      return "phone";
    case "discover_contacts":
      return "contact";
    default:
      return undefined; // source / enrich / suppression_check do not write a tracked field value
  }
}

function applyOutcomeToState(
  state: WaterfallLeadState,
  plan: Extract<WaterfallPlan, { kind: "dispatch" }>,
  outcome: WaterfallProviderOutcome
) {
  switch (plan.stage) {
    case "find_email":
      if (outcome.value) state.email = outcome.value;
      if (outcome.validationStatus) state.emailValidationStatus = outcome.validationStatus;
      break;
    case "verify_email":
      if (outcome.validationStatus) state.emailValidationStatus = outcome.validationStatus;
      break;
    case "find_phone":
      if (outcome.value) state.phone = outcome.value;
      if (outcome.phoneType) state.phoneType = outcome.phoneType;
      break;
    case "verify_phone":
      if (outcome.validationStatus) state.phoneValidationStatus = outcome.validationStatus;
      if (outcome.phoneType && !state.phoneType) state.phoneType = outcome.phoneType;
      break;
    case "discover_contacts":
      state.contactsFound = (state.contactsFound ?? 0) + 1;
      break;
    default:
      break;
  }
}

function buildFieldSource(input: {
  workspaceId: string;
  targetType: "contact" | "company";
  targetId: string;
  field: string;
  value: string;
  providerId: string;
  capability: FieldSource["capability"];
  outcome: WaterfallProviderOutcome;
  costCents: number;
  isVerify: boolean;
  now: string;
}): FieldSource {
  return {
    id: `fs-${randomUUID()}`,
    workspaceId: input.workspaceId,
    targetType: input.targetType,
    targetId: input.targetId,
    field: input.field,
    value: input.value,
    providerId: input.providerId,
    capability: input.capability,
    confidence: input.outcome.confidence ?? 0,
    validationStatus: input.outcome.validationStatus ?? "unverified",
    phoneType: input.outcome.phoneType,
    costCents: input.costCents,
    cacheHit: false,
    enrichmentDate: input.now,
    lastVerifiedDate: input.isVerify ? input.now : undefined
  };
}

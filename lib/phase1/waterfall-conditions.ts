import type { FieldProvenanceStatus, PhoneLineType, WaterfallCondition } from "@/lib/phase1/types";

/**
 * A snapshot of a lead's enrichment-relevant state, evaluated by waterfall step
 * conditions (see docs/CAMPAIGN_WATERFALLS.md §6). Company-level fields alias the
 * same values for company-centric campaigns (e.g. local business).
 */
export type WaterfallLeadState = {
  /** Identity fields — not used in conditions, but passed to provider adapters as input. */
  fullName?: string;
  companyName?: string;
  email?: string;
  emailValidationStatus?: FieldProvenanceStatus;
  phone?: string;
  phoneType?: PhoneLineType;
  phoneValidationStatus?: FieldProvenanceStatus;
  linkedinUrl?: string;
  domain?: string;
  country?: string;
  leadScore?: number;
  isHighValue?: boolean;
  companyId?: string;
  contactsFound?: number;
  engagement?: string[];
  dnc?: boolean;
};

type FieldValue = string | number | boolean | string[] | undefined;

/** Resolve a dotted condition field path against the lead state. Unknown paths
 * resolve to `undefined` (so they read as "missing" rather than throwing). */
export function resolveField(state: WaterfallLeadState, field: string): FieldValue {
  switch (field) {
    case "email":
    case "company.email":
      return state.email;
    case "email.validationStatus":
    case "company.email.validationStatus":
      return state.emailValidationStatus;
    case "phone":
    case "company.phone":
      return state.phone;
    case "phone.type":
      return state.phoneType;
    case "phone.validationStatus":
    case "company.phone.validationStatus":
      return state.phoneValidationStatus;
    case "linkedinUrl":
      return state.linkedinUrl;
    case "domain":
      return state.domain;
    case "country":
      return state.country;
    case "leadScore":
      return state.leadScore;
    case "isHighValue":
      return state.isHighValue;
    case "companyId":
      return state.companyId;
    case "contactsFound":
      return state.contactsFound;
    case "engagement":
      return state.engagement;
    case "dnc":
      return state.dnc;
    default:
      return undefined;
  }
}

function present(value: FieldValue): boolean {
  if (value === undefined || value === null) return false;
  if (value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function matchesIn(value: FieldValue, list: string[]): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => list.includes(String(item)));
  }
  return value !== undefined && list.includes(String(value));
}

/**
 * Evaluate a storable predicate against the lead state. A missing/undefined
 * condition means "always run". Supports nested all/any/not.
 */
export function evaluateCondition(condition: WaterfallCondition | undefined, state: WaterfallLeadState): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((child) => evaluateCondition(child, state));
  if ("any" in condition) return condition.any.some((child) => evaluateCondition(child, state));
  if ("not" in condition) return !evaluateCondition(condition.not, state);

  const value = resolveField(state, condition.field);
  switch (condition.op) {
    case "exists":
      return present(value);
    case "isMissing":
      return !present(value);
    case "equals":
      return value !== undefined && String(value) === condition.value;
    case "notEquals":
      return !(value !== undefined && String(value) === condition.value);
    case "in":
      return matchesIn(value, condition.value);
    case "notIn":
      return !matchesIn(value, condition.value);
    case "gte":
      return typeof value === "number" && value >= condition.value;
    case "lte":
      return typeof value === "number" && value <= condition.value;
    default:
      return false;
  }
}

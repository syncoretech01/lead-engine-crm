# Campaign-Specific Provider Waterfalls — Design & Build Plan

Created: 2026-06-20. Status: **Design approved, not yet implemented.** No live provider calls.

This document specifies campaign-scoped provider waterfalls for the Lead Engine: each campaign/lead job runs a **different, data-driven provider order** (sourcing → email → phone → enrichment → verification) based on campaign type, available data, required output, country, budget, and outreach channel. It supersedes the prose-only, global-only routing in [`PROVIDER_WATERFALL.md`](PROVIDER_WATERFALL.md) by turning those waterfalls into **editable data**.

---

## 1. Goal & scope

- **Campaign-specific waterfalls, not one global order.** Global provider settings remain as defaults/limits; campaign templates define the actual order.
- **Credit-efficient:** enrich only ICP-fit, deduped contacts; stop the moment required verified data is found.
- **Traceable:** store source, cost, confidence, and validation status for every enriched field.
- **Outreach-ready:** only verified emails reach email senders; only validated phones reach RingCentral; phone type controls SMS eligibility.
- **RBAC:** Admins manage providers/limits; Managers author templates; SDRs never touch waterfalls (assigned-contact outreach only).

## 2. Grounding in the current codebase

**Already exists (reuse — do not rebuild):**
- `ProviderConnection` — per-workspace global settings: `enabled`, `executionMode`, `capabilities`, `allowedOperations`, `rateLimitPerMinute`, `dailyBudgetCents`, `waterfallOrder` (global default ranking).
- `ProviderJob` / `ProviderJobRun` — idempotent, optimistically-locked, retried execution units.
- `ProviderUsageLedger` + `money.ts` (`estimatedProviderCostCents`, `evaluateBudgetStopRules`).
- `ProviderCacheEntry` — TTL provider-result cache (`cacheKey` + `inputHash`).
- Provider **registry** (`lib/providers/registry.ts`, 11 providers), typed **interfaces**, **mock adapters**, **secret vault** (AES-256-GCM), the M1 **live-execution framework** (`provider-live-execution.ts`: plan → invoke → apply) and **worker runner** (`provider-worker-runner.ts`).
- `LeadJob` budget fields (`budgetCapCents`, `enrichmentBudgetCents`, `highValueOnlyEnrichment`, `preflightSourceEstimates`), dedupe + ICP gating, suppression records, consent/lawful-basis.

**Missing (this project adds):**
- Campaign-scoped templates/steps (`WaterfallTemplate`, `WaterfallStep`).
- A **waterfall engine** that picks the next provider per lead from a template + lead state.
- **Field-level provenance** (`FieldSource`) — today `EnrichmentResult` has no phone/email/source fields and `provider` is a 3-value local enum.
- ~13 providers referenced by the templates but not yet in the registry (see §5.5).
- Provider performance metrics + auto-tune.

**Design principle:** the engine never names a provider in code — it asks the registry for *enabled, capable, country-eligible* providers and orders them by the step then `waterfallOrder`. New providers are config + adapter, never code branches.

## 3. Architecture — three layers

```
Campaign / LeadJob ──selects──▶ WaterfallTemplate ──has many──▶ WaterfallStep[]
                                       │                              │
                                       ▼                              ▼
                              Waterfall Engine (NEW)      step = stage + capability + ranked providerIds
                                       │                         + runIf / stopIf / qualityGate / costCap
                          per lead, per step: evaluate conditions
                                       │
                                       ▼
                        ProviderJob / ProviderJobRun (EXISTING)  ← cache check first
                                       │ plan→invoke→apply (EXISTING live-exec, out-of-band worker)
                                       ▼
              EnrichmentResult + FieldSource (provenance) + ProviderUsageLedger (cost)
                                       │ acceptance gate (quality)
                                       ▼
        CRM/outreach gates: verified-email→Smartlead/SES · validated-phone→RingCentral
```

- **Layer 1 — Global limits** (`ProviderConnection`): credentials, enabled, rate, daily budget, capabilities. Admin-owned. The floor/ceiling.
- **Layer 2 — Campaign templates** (`WaterfallTemplate` + `WaterfallStep`): ordered, conditional steps per campaign type. Manager-owned, clonable/overridable per job.
- **Layer 3 — Per-lead execution** (new engine): walks the template against live lead state, dispatches existing `ProviderJob`s, with cache → budget → quality → stop gates.

New modules: `lib/phase1/waterfall-templates.ts` (CRUD/defaults), `lib/phase1/waterfall-engine.ts` (pure planner), `lib/phase1/waterfall-conditions.ts` (pure evaluator). Reuse everything in §2.

## 4. Why a single global waterfall is not enough

| Driver | Why one order fails |
|---|---|
| Input data differs | Hunter CSV already has emails → email steps waste credits; a Maps list has no contacts → must source first. |
| Required output differs | Cold-calling needs a validated mobile; cold email needs a verified email; ABM needs 2–4 contacts/company. Stop conditions are mutually exclusive. |
| Cost posture differs | "Email-first" must not enrich phones upfront; phone-heavy must enrich phones first. |
| Channel differs | Phone campaigns reject VoIP/company-main; email campaigns don't care about line type. |
| Geo/compliance differs | US phone-heavy vs EU/UK consent-friendly need different providers + gates. |
| Provider economics | Premium providers (Lusha/Kaspr) should run only for high-value leads — a per-campaign, per-step decision. |

## 5. Core data model

Extends existing models; new tables marked **NEW**. Implement as `AppState` arrays + normalized projection (the repo's pattern), bumping `migrateState`.

### 5.1 ProviderConnection (existing — minor extension)
Add `costPerUnitCents Int?` (for `estimatedProviderCostCents`) and `supportedCountries String[]` (`[]` = any). `waterfallOrder` stays the global tie-breaker ranking.

### 5.2 WaterfallTemplate (NEW)
```prisma
model WaterfallTemplate {
  id String @id
  workspaceId String
  name String
  campaignType String        // hunter_phone_only | local_business | email_first_call_later |
                             // phone_heavy_cold_calling | linkedin_sales_navigator | company_first_abm |
                             // email_only_low_cost | high_value_premium | eu_compliance | reenrichment
  description String?
  status String              // Draft | Active | Archived
  isDefault Boolean
  country String?            // "US" | "EU" | null=any
  outreachChannel String     // email | phone | both
  requiredFields String[]    // e.g. ["email:verified"], ["phone:validated"], ["contactsPerCompany:3"]
  personas String[]          // ABM persona filter
  allowGenericEmail Boolean @default(false)
  maxCostPerLeadCents Int?
  maxCostPerCampaignCents Int?
  highValueScoreThreshold Int?
  steps WaterfallStep[]
  createdById String
  createdAt DateTime; updatedAt DateTime
}
```

### 5.3 WaterfallStep (NEW)
```prisma
model WaterfallStep {
  id String @id
  templateId String
  order Int
  stage String               // source | discover_contacts | find_email | find_phone | enrich |
                             // verify_email | verify_phone | suppression_check
  capability String          // maps to ProviderCapability
  providerIds String[]       // ranked subset; [] = any enabled+capable provider
  runIf Json?                // condition expr (§6)
  stopIf Json?               // stop-track expr
  qualityGate Json?          // acceptance gate (§10)
  costCapCents Int?
  highValueOnly Boolean @default(false)
  allowCompanyMainPhone Boolean @default(false)
  optional Boolean @default(true)
}
```

### 5.4 FieldSource (NEW — field-level provenance)
```prisma
model FieldSource {
  id String @id
  workspaceId String
  targetType String          // contact | company
  targetId String
  field String               // email | phone | title | ...
  value String
  providerId String          // email_source / phone_source
  capability String
  sourcePlatform String?     // LinkedIn | Google Maps | CSV | website | ...
  confidence Int             // 0–100
  validationStatus String    // unverified | valid | risky | catch_all | invalid | unknown
  phoneType String?          // mobile | direct_dial | company_main | landline | voip | unknown
  costCents Int
  cacheHit Boolean
  providerJobRunId String?
  enrichmentDate DateTime
  lastVerifiedDate DateTime?
  expiresAt DateTime?        // TTL for re-enrichment
}
```

### 5.5 ProviderJobRun (existing — add linkage)
Add `waterfallStepId String?`, `templateId String?`, `leadTargetType String?`, `leadTargetId String?`.

### 5.6 ProviderMetricDaily (NEW — or derive from ledger + FieldSource)
```prisma
model ProviderMetricDaily {
  id String @id
  workspaceId String; providerId String; capability String; date DateTime
  attempts Int; hits Int; valid Int; failures Int
  mobileCount Int; companyMainCount Int; wrongNumber Int; bounces Int
  costCents Int
}
```

### 5.7 LeadJob / Campaign (existing — add)
`waterfallTemplateId String?`, `waterfallOverride Json?` (inline step edits merged onto the template at run time). Reuse existing budget fields.

### 5.8 Providers to add to the registry (mock-first)
`leadmagic`, `prospeo`, `findymail`, `contactout`, `lead411`, `bettercontact`, `fullenrich`, `bouncer`, `millionverifier`, `kaspr`, `apify_maps`, `apify_harvest`, `website_scrape`, `dnc` — each declaring `capabilities`/`categories`/`costPerUnitCents`/`supportedCountries`. (`apollo`, `hunter`, `google_places`, `apify`, `zerobounce`, `lusha`, `people_data_labs`, `twilio_lookup`, `ringcentral`, `smartlead`, `amazon_ses` already exist.)

## 6. Condition DSL (steps)

```ts
type Condition =
  | { field: string; op: "exists" | "isMissing" }
  | { field: string; op: "equals" | "notEquals"; value: string }
  | { field: string; op: "in" | "notIn"; value: string[] }
  | { field: string; op: "gte" | "lte"; value: number }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition };
```
Resolvable fields from live lead state: `email`, `email.validationStatus`, `phone`, `phone.type`, `phone.validationStatus`, `linkedinUrl`, `domain`, `country`, `leadScore`, `isHighValue`, `companyId`, `contactsFound`, `engagement`, `dnc`, `<field>.expiresAt`.

- **runIf** gates the step ("run only if phone missing", "only US", "only if LinkedIn URL exists", "high-value only").
- **stopIf** ends the track when satisfied ("stop if valid phone found", "stop if verified email found", "N contacts/company").
- **qualityGate** accepts-or-continues a provider result (§10). A failed gate falls through to the next provider; the track stops only on `stopIf` (a good result) or budget exhaustion — this is exactly "continue if catch-all/risky/invalid/low-confidence".

## 7. Execution engine

For each ICP-fit, deduped lead:

1. Load template (merged with job override). Initialize tracks (email / phone / contacts) from `requiredFields`.
2. For each step in `order`:
   - skip if the track is already satisfied (`stopIf` true from existing data);
   - skip if `runIf` is false; skip if `highValueOnly` and lead not high-value;
   - **budget pre-check** (lead/campaign/provider/step caps via `evaluateBudgetStopRules`) — skip if exhausted;
   - resolve providers: `step.providerIds ∩ {enabled, credentialed, capable, country-ok}`, ordered by step then `waterfallOrder`;
   - for each provider: **cache lookup** → fresh hit (zero cost) else dispatch a `ProviderJob`;
   - on result: **quality gate** → accept (write field + `FieldSource` + ledger; if `stopIf` now true, stop track) or continue to next provider.
3. Compute completeness → route to CRM/outreach gates (§16).

Runs out-of-band on `provider-worker-runner.ts`: the engine produces the next job; the worker executes; on `apply` the engine is re-invoked. The planner (`planNextWaterfallStep`) is **pure/sync** (like `planLiveProviderRun`) so it's unit-testable without the store.

Pseudocode:
```ts
async function enrichLead(job, lead) {
  const tmpl = mergeOverride(getTemplate(job.waterfallTemplateId), job.waterfallOverride);
  let state = leadState(lead);
  for (const step of orderBy(tmpl.steps, "order")) {
    if (trackSatisfied(step, state, tmpl.requiredFields)) continue;
    if (!evaluateCondition(step.runIf, state)) continue;
    if (step.highValueOnly && state.leadScore < tmpl.highValueScoreThreshold) continue;
    const providers = rankProviders(step, workspaceConnections(state.workspaceId));
    for (const provider of providers) {
      if (!budgetAllows(provider, step, lead, job, tmpl)) continue;
      let result = cacheLookup(provider, step.capability, inputHash(lead, step))
                ?? await runProviderJob({ provider, capability: step.capability, input: lead,
                                          waterfallStepId: step.id, templateId: tmpl.id });
      recordCost(result);
      if (passesQualityGate(result, step.qualityGate)) {
        applyToRecord(lead, result);
        writeFieldSource(lead, result, provider, step);
        if (evaluateCondition(step.stopIf, refresh(state, lead))) break;
      }
    }
    state = refresh(state, lead);
  }
  return completeness(lead, tmpl.requiredFields);
}
```

## 8. Default templates (seed 10)

| # | Template | Channel | Stop | Company-main? | Mobile req? | Phone timing |
|---|---|---|---|---|---|---|
| 1 | Existing Hunter – Phone Only | phone | valid phone | ✘ | preferred | upfront (phone only) |
| 2 | Local Business – Google Maps First | both | company phone + ≥1 usable email/contact | ✔ | no | upfront |
| 3 | Email First, Call Later | email→phone | verified email; phone post-engagement | ✘ | preferred | **after engagement** |
| 4 | US Phone-Heavy Cold Calling | phone | validated mobile/direct dial | ✘ (unless flag) | **yes** | upfront |
| 5 | LinkedIn / Sales Navigator | both | verified email and/or valid phone | ✘ | optional | upfront |
| 6 | Company-First ABM | both | N verified contacts/company | ✔ (account) | no | upfront |
| 7 | Email Only – Low Cost | email | verified email | n/a | n/a | never |
| 8 | High-Value Premium | both | verified email + validated mobile | ✘ | yes | upfront (premium ok) |
| 9 | EU/UK Compliance-Friendly | email | verified email; phone w/ lawful basis | ✘ | no | consent-gated |
| 10 | Re-enrichment / Data Refresh | both | refresh stale fields only | inherit | inherit | expired only |

Detailed per-template rules (when / order / requires / stop / validate / skip / output / company-main / mobile / timing) for the 6 priority templates are encoded in the JSON in §9; templates 7–10 follow the same shape (low-cost email-only; premium-always-on; GDPR sources + consent-gated phone; per-field TTL `runIf` on expiry).

## 9. Sample JSON — the 6 priority templates

**1. Existing Hunter – Phone Only**
```json
{ "name": "Existing Hunter - Phone Only", "campaignType": "hunter_phone_only", "outreachChannel": "phone",
  "requiredFields": ["phone:validated"], "maxCostPerLeadCents": 80, "highValueScoreThreshold": 80,
  "steps": [
    {"order":1,"stage":"find_phone","capability":"find_phone","providerIds":["cache"],"runIf":{"field":"phone","op":"isMissing"}},
    {"order":2,"stage":"find_phone","capability":"find_phone","providerIds":["leadmagic"],"runIf":{"field":"phone","op":"isMissing"}},
    {"order":3,"stage":"find_phone","capability":"find_phone","providerIds":["prospeo"],"runIf":{"field":"phone","op":"isMissing"}},
    {"order":4,"stage":"find_phone","capability":"find_phone","providerIds":["contactout"],"runIf":{"all":[{"field":"phone","op":"isMissing"},{"field":"linkedinUrl","op":"exists"}]}},
    {"order":5,"stage":"find_phone","capability":"find_phone","providerIds":["bettercontact","fullenrich","apollo"],"runIf":{"field":"phone","op":"isMissing"}},
    {"order":6,"stage":"find_phone","capability":"find_phone","providerIds":["lusha"],"highValueOnly":true,"runIf":{"field":"phone","op":"isMissing"}},
    {"order":7,"stage":"verify_phone","capability":"verify_phone","providerIds":["twilio_lookup"],
      "qualityGate":{"phoneTypeIn":["mobile","direct_dial"],"rejectVoipForSms":true,"minConfidence":70},
      "stopIf":{"field":"phone.validationStatus","op":"in","value":["valid"]}}
  ]}
```
**2. Local Business – Google Maps First**
```json
{ "name": "Local Business - Google Maps First", "campaignType": "local_business", "outreachChannel": "both",
  "requiredFields": ["company.phone:validated","company.email:verified|contact:1"], "allowGenericEmail": true,
  "steps": [
    {"order":1,"stage":"source","capability":"discover_companies","providerIds":["google_places","apify_maps"]},
    {"order":2,"stage":"enrich","capability":"enrich_company","providerIds":["website_scrape"],"runIf":{"field":"domain","op":"exists"}},
    {"order":3,"stage":"find_email","capability":"find_email","providerIds":["website_scrape","leadmagic","prospeo"],"runIf":{"field":"email","op":"isMissing"}},
    {"order":4,"stage":"discover_contacts","capability":"discover_contacts","providerIds":["lead411","contactout"],"optional":true},
    {"order":5,"stage":"verify_email","capability":"verify_email","providerIds":["bouncer","millionverifier"],"qualityGate":{"acceptStatus":["valid","catch_all"],"allowCatchAll":true}},
    {"order":6,"stage":"verify_phone","capability":"verify_phone","providerIds":["twilio_lookup"],"qualityGate":{"allowCompanyMain":true},
      "stopIf":{"all":[{"field":"company.phone.validationStatus","op":"in","value":["valid"]},{"any":[{"field":"email.validationStatus","op":"in","value":["valid","catch_all"]},{"field":"contactsFound","op":"gte","value":1}]}]}}
  ]}
```
**3. Email First, Call Later**
```json
{ "name": "Email First, Call Later", "campaignType": "email_first_call_later", "outreachChannel": "both",
  "requiredFields": ["email:verified"], "maxCostPerLeadCents": 60,
  "steps": [
    {"order":1,"stage":"find_email","capability":"find_email","providerIds":["cache","hunter","leadmagic","prospeo"],"runIf":{"field":"email","op":"isMissing"}},
    {"order":2,"stage":"find_email","capability":"find_email","providerIds":["findymail"],"runIf":{"all":[{"field":"email","op":"isMissing"},{"field":"linkedinUrl","op":"exists"}]}},
    {"order":3,"stage":"verify_email","capability":"verify_email","providerIds":["bouncer","millionverifier"],
      "qualityGate":{"acceptStatus":["valid"],"allowCatchAll":false,"minConfidence":80},
      "stopIf":{"field":"email.validationStatus","op":"in","value":["valid"]}},
    {"order":4,"stage":"find_phone","capability":"find_phone","providerIds":["cache","leadmagic","prospeo","contactout","bettercontact","fullenrich"],
      "runIf":{"all":[{"field":"phone","op":"isMissing"},{"any":[{"field":"engagement","op":"in","value":["opened","clicked","replied","booked"]},{"field":"leadScore","op":"gte","value":70}]}]}},
    {"order":5,"stage":"verify_phone","capability":"verify_phone","providerIds":["twilio_lookup"],
      "qualityGate":{"phoneTypeIn":["mobile","direct_dial"],"rejectVoipForSms":true},
      "stopIf":{"field":"phone.validationStatus","op":"in","value":["valid"]}}
  ]}
```
**4. US Phone-Heavy Cold Calling**
```json
{ "name": "US Phone-Heavy Cold Calling", "campaignType": "phone_heavy_cold_calling", "country": "US", "outreachChannel": "phone",
  "requiredFields": ["phone:validated"], "maxCostPerLeadCents": 120, "highValueScoreThreshold": 75,
  "steps": [
    {"order":1,"stage":"suppression_check","capability":"verify_phone","providerIds":["dnc"],"runIf":{"field":"country","op":"equals","value":"US"}},
    {"order":2,"stage":"find_phone","capability":"find_phone","providerIds":["cache","lead411","leadmagic","prospeo","bettercontact","fullenrich","apollo"],"runIf":{"field":"phone","op":"isMissing"}},
    {"order":3,"stage":"find_phone","capability":"find_phone","providerIds":["lusha"],"highValueOnly":true,"runIf":{"field":"phone","op":"isMissing"}},
    {"order":4,"stage":"verify_phone","capability":"verify_phone","providerIds":["twilio_lookup"],
      "qualityGate":{"phoneTypeIn":["mobile","direct_dial"],"allowCompanyMain":false,"rejectVoipForSms":true,"rejectStatus":["invalid","unknown","risky"],"minConfidence":75},
      "stopIf":{"field":"phone.validationStatus","op":"in","value":["valid"]}}
  ]}
```
**5. LinkedIn / Sales Navigator**
```json
{ "name": "LinkedIn / Sales Navigator", "campaignType": "linkedin_sales_navigator", "outreachChannel": "both",
  "requiredFields": ["email:verified"],
  "steps": [
    {"order":1,"stage":"enrich","capability":"enrich_contact","providerIds":["apify_harvest"],"runIf":{"field":"linkedinUrl","op":"exists"}},
    {"order":2,"stage":"find_email","capability":"find_email","providerIds":["findymail","leadmagic","prospeo","contactout"],"runIf":{"field":"email","op":"isMissing"}},
    {"order":3,"stage":"find_email","capability":"find_email","providerIds":["bettercontact"],"runIf":{"field":"email","op":"isMissing"}},
    {"order":4,"stage":"verify_email","capability":"verify_email","providerIds":["bouncer"],"qualityGate":{"acceptStatus":["valid"],"minConfidence":80},"stopIf":{"field":"email.validationStatus","op":"in","value":["valid"]}},
    {"order":5,"stage":"find_phone","capability":"find_phone","providerIds":["leadmagic","prospeo","contactout"],"runIf":{"field":"phone","op":"isMissing"}},
    {"order":6,"stage":"verify_phone","capability":"verify_phone","providerIds":["twilio_lookup"],"qualityGate":{"phoneTypeIn":["mobile","direct_dial"]}}
  ]}
```
**6. Company-First ABM**
```json
{ "name": "Company-First ABM", "campaignType": "company_first_abm", "outreachChannel": "both",
  "requiredFields": ["contactsPerCompany:3"],
  "personas": ["owner","ceo","general_manager","operations_manager","marketing_manager","sales_manager","procurement_manager"],
  "steps": [
    {"order":1,"stage":"source","capability":"discover_companies","providerIds":["apify_maps","apollo","csv"]},
    {"order":2,"stage":"enrich","capability":"enrich_company","providerIds":["website_scrape","apollo"],"runIf":{"field":"domain","op":"exists"}},
    {"order":3,"stage":"discover_contacts","capability":"discover_contacts","providerIds":["lead411","apollo","leadmagic","prospeo","contactout"],"stopIf":{"field":"contactsFound","op":"gte","value":3}},
    {"order":4,"stage":"discover_contacts","capability":"discover_contacts","providerIds":["fullenrich"],"highValueOnly":true,"stopIf":{"field":"contactsFound","op":"gte","value":3}},
    {"order":5,"stage":"verify_email","capability":"verify_email","providerIds":["bouncer","millionverifier"],"qualityGate":{"acceptStatus":["valid"]}},
    {"order":6,"stage":"verify_phone","capability":"verify_phone","providerIds":["twilio_lookup"],"qualityGate":{"allowCompanyMain":true}}
  ]}
```

## 10. Quality & validation controls (acceptance gate)

`qualityGate` keys: `minConfidence`, `acceptStatus`/`rejectStatus`, `allowCatchAll`, `phoneTypeIn`, `allowCompanyMain`, `rejectVoipForSms`. DNC/suppression is a hard gate (reuse existing suppression). Failed gate → continue to next provider (fall-through); track stops only on `stopIf` or budget.

## 11. Cost & budget controls (reuse `money.ts`)

Cascade pre-checked before every dispatch: max cost/lead (`maxCostPerLeadCents`) → max cost/campaign (`maxCostPerCampaignCents`/job `budgetCapCents`) → max cost/provider/day (`ProviderConnection.dailyBudgetCents`) → max cost/step (`costCapCents`) → premium-only-for-high-value (`highValueOnly` + `highValueScoreThreshold`). Pre-check with `estimatedProviderCostCents`; record actuals in `ProviderUsageLedger`.

## 12. Caching & duplicate prevention

- Enrich only deduped leads (email ∪ linkedinUrl ∪ domain+fullName; ABM dedups contacts across companies).
- `runIf:{field:"phone",op:"isMissing"}` + fresh `FieldSource` ⇒ never re-enrich a field already present (within TTL). Re-enrichment template flips to "only if expired".
- `ProviderCacheEntry`: key `provider:capability:inputHash`; fresh hit returns cached result at zero cost with `FieldSource.cacheHit=true`. TTLs: email ~90d, phone ~60d, firmographics ~180d.
- Job idempotency keys prevent double-charge on replay.

## 13. Field-level provenance

Each accepted field writes a `FieldSource` row (§5.4) capturing provider, capability, sourcePlatform, confidence, validationStatus, phoneType, costCents, cacheHit, enrichment/verify dates, expiresAt, runId. The record keeps the current best value; `FieldSource` is the full history → drives the timeline UI, "via {provider}" chips, TTL re-enrichment, and metrics. Every value is traceable to its run.

## 14. Provider performance & auto-tune

Aggregate `FieldSource` + `ProviderJobRun` + outreach events → `ProviderMetricDaily` per provider×capability: email found/valid, bounce rate, phone found/valid, mobile-vs-company ratio, wrong-number rate, failure rate, avg cost/enrichment, cost-per-usable-field, cost-per-booked-meeting (join FieldSource→Contact→Opportunity). Nightly, score each capability's providers by `valid_rate / cost_per_usable_field` (min-volume guard) and **suggest** a re-order in the editor (manager approves; never auto-apply).

## 15. UI/UX, RBAC

- **UI:** Templates list (campaignType chips, status, default badge) · Template editor (drag-drop step order; per-step stage/provider/condition builders, cost cap, highValueOnly, allowCompanyMain) · Budget panel · Quality panel · **Dry-run preview** (estimate mode via the lead-job preflight estimator — projected steps/cost/fill, no live calls) · Campaign setup selector (campaignType → recommended template → accept/clone/override) · Provider performance dashboard · Lead enrichment timeline · Field-source chips on records.
- **RBAC** (extend `permissionsByRole`, add `manage_waterfalls`): Admin (`manage_workspace`) = everything incl. provider credentials/global limits; Manager (`manage_outreach` + `manage_waterfalls`) = author templates + per-campaign budgets within limits; Data Operator (`run_jobs`) = run jobs on existing templates; **SDR (`send_direct_outreach`) = no waterfall/provider access — assigned-contact outreach only.**

## 16. CRM / outreach integration (gates)

- Email senders (Smartlead/SES): only `FieldSource` email `validationStatus=valid` (catch-all only if allowed).
- RingCentral: only `validationStatus=valid` phones; `phoneType` controls SMS (mobile→SMS; company_main/landline/voip→call-only or `sms_blocked`); company-main routes to a different script/queue.
- Phone-heavy → build call queue on completion (validation mandatory before SDR assignment).
- Email-first → phone track fires only on engagement webhooks (open/click/reply/booked) → then SDR.
- ABM → attach 2–4 verified contacts to the same Account; track account vs contact completeness.
- Reuses existing suppression/consent/export gates — the waterfall only *populates* validated fields.

## 17. Edge cases

No capable provider in workspace → skip step, flag `needs_provider`. All providers in a stage fail/low-quality → `enrichment_incomplete`, not exported. Budget exhausted → stop, `budget_stopped`, pause for top-up. Conflicting values → keep highest confidence/most-recent validated; retain all in `FieldSource`. Catch-all/risky loop → cap email-find attempts/lead (≈3). LinkedIn-tool without LinkedIn URL → excluded by `runIf`. VoIP in SMS campaign → accept for calls, set `sms_blocked`. ABM <N contacts → keep partial account. Fresh field in re-enrichment → skipped, zero cost. Live connection but global live flag off → `resolveProviderExecutionMode` downgrades to mock (engine still completes — great for dry-runs). Duplicate lead across jobs → idempotency + cache prevent double-charge.

---

## 18. Phased build plan (task breakdown)

**Mock-first throughout:** the entire engine + UI is built and validated against mock adapters before any provider goes live. Effort: S = ≤2d, M = 3–5d, L = 1–2wk. Each phase ships green (typecheck + lint + tests).

### Phase 0 — Data model & types (M)
- [ ] Add `WaterfallTemplate`, `WaterfallStep`, `FieldSource`, `ProviderMetricDaily` to `types.ts` + `AppState` arrays.
- [ ] Extend `ProviderConnection` (`costPerUnitCents`, `supportedCountries`), `ProviderJobRun` (waterfall linkage), `LeadJob`/Campaign (`waterfallTemplateId`, `waterfallOverride`); widen `EnrichmentResult.provider` to registry id.
- [ ] Prisma migration + `persistence-projection.ts` mappers + `normalized-write-tables.ts` + bump `migrateState` version.
- **Exit:** typecheck green; projection round-trips new tables; migration applies on Neon (BOM-free). **Dep:** none.

### Phase 1 — Registry expansion (mock adapters) (M)
- [ ] Add the 13 providers (§5.8) to `registry.ts` with capabilities/categories/cost/countries.
- [ ] Mock adapters returning deterministic per-capability results; contract fixtures in `provider-contracts.json`.
- **Exit:** `providers.test.ts`/contract suite green for all providers; all default to `executionMode:"mock"`. **Dep:** Phase 0.

### Phase 2 — Condition evaluator (S)
- [ ] `lib/phase1/waterfall-conditions.ts`: `evaluateCondition(cond, leadState)` + `leadState(lead)` resolver.
- [ ] Unit tests for every op + nesting (this is the riskiest logic — test exhaustively).
- **Exit:** `waterfall-conditions.test.ts` green incl. `all/any/not`, missing-field, type coercion. **Dep:** Phase 0.

### Phase 3 — Waterfall engine / planner (L)
- [ ] `lib/phase1/waterfall-engine.ts`: `planNextWaterfallStep(template, leadState, budgets)` (pure/sync) → next `ProviderJob` spec or `{done, reason}`; `trackSatisfied`, `rankProviders`, `passesQualityGate`.
- [ ] Budget pre-check via `money.ts`; cache lookup via `ProviderCacheEntry`.
- [ ] Unit tests: stop-early, run-only-if, high-value-only, fall-through on bad quality, budget stop, cache hit.
- **Exit:** `waterfall-engine.test.ts` green against mock leads/templates. **Dep:** Phases 1–2.

### Phase 4 — Engine ↔ worker glue (M)
- [ ] Extend `provider-worker-runner.ts`: dispatch engine's next job → on `apply`, run acceptance gate → write `FieldSource` + ledger → re-invoke engine.
- [ ] `waterfall-templates.ts` CRUD service (`updateState`-based) + job→template resolution + override merge.
- [ ] End-to-end mock test: a lead job with a template enriches sample leads through to completion.
- **Exit:** mock job runs a full waterfall; `FieldSource`/ledger populated; budgets honored. **Dep:** Phase 3.

### Phase 5 — Default templates + RBAC (S)
- [ ] Seed the 10 default templates (§8/§9) via `ensure*Defaults`.
- [ ] Add `manage_waterfalls` permission; gate template CRUD; confirm SDR has no access.
- **Exit:** templates seeded per workspace; `auth-rbac.test.ts` covers the new permission. **Dep:** Phase 4.

### Phase 6 — Template UI (L)
- [ ] Waterfall Templates page + editor (drag-drop step order, provider multi-select limited to enabled+capable, visual condition/quality/budget builders).
- [ ] Campaign setup waterfall selector (campaignType → recommended template → accept/clone/override).
- [ ] **Dry-run preview** in estimate mode (extend the lead-job preflight estimator; no live calls).
- **Exit:** a manager can author/clone a template and dry-run it; SDRs can't see the page. **Dep:** Phase 5.

### Phase 7 — Provenance & metrics UI (M)
- [ ] Lead enrichment timeline + field-source chips on contact/company records.
- [ ] `ProviderMetricDaily` aggregation + provider performance dashboard + auto-tune **suggestion** (approve-to-apply).
- **Exit:** every enriched field shows its source; dashboard shows per-provider valid-rate/cost. **Dep:** Phase 4 (+6 for UI).

### Phase 8 — Outreach integration (M)
- [ ] Gate Smartlead/SES on verified email; RingCentral on validated phone; SMS by phone type; phone-heavy → call queue; email-first → engagement-triggered phone track; ABM → multi-contact accounts.
- **Exit:** only validated data reaches outreach; engagement webhook re-enters the phone track. **Dep:** Phases 4, 7; M3 outreach adapters for live.

### Phase 9 — Go live per provider (L, incremental)
- [ ] Flip providers to live one at a time in the M2/M3 order, each behind contract fixtures + a real key + dry-run validation; tune metrics with real data.
- **Exit:** first real campaign sources + verifies + (later) sends end-to-end with real cost tracked. **Dep:** all prior; provider keys; legal sign-off before any live send.

**Critical path:** 0 → 1 → 2 → 3 → 4 → 5 → 6. Phases 7–8 can overlap once 4 lands. Phase 9 is gated by procurement + legal, independent of UI polish.

## 19. Final recommendation

Build three layers — global limits (`ProviderConnection`), campaign templates (`WaterfallTemplate`/`WaterfallStep`), and a pure per-lead **waterfall engine** dispatching existing `ProviderJob`s — all **mock-first** on the machinery already in the repo. Seed the 10 templates, validate the engine + UI end-to-end against mocks, then flip providers live one at a time. This delivers credit-efficient, stop-early, campaign-specific enrichment with full per-field provenance/cost and validated-only outreach hand-off, while keeping SDRs strictly on assigned-contact outreach.

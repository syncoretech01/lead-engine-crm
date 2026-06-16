# Acceptance Criteria Audit

Generated: 2026-06-09

Source blueprint: `C:\Users\LENOVO\Desktop\lead-engine-crm Final.md`

Production architecture decision: `docs/PRODUCTION_ARCHITECTURE.md`

This audit maps the blueprint acceptance criteria to the current local MVP implementation. Status definitions:

- `Done`: Implemented in the current local app with a visible workflow and data model.
- `Partial`: Implemented as a local simulation, missing production hardening, or missing part of the stated criterion.
- `Not started`: No meaningful implementation yet.

Summary:

| Status | Count |
|---|---:|
| Done | 48 |
| Partial | 27 |
| Not started | 2 |
| Total | 77 |

## 24.1 Lead Engine

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| User can create and save a Search Profile. | Done | `app/search-profiles/page.tsx`, `app/actions.ts:createSearchProfileAction`, `lib/phase1/types.ts:SearchProfile` | Add production auth and DB persistence later. |
| User can run a Search Profile against one or multiple selected sources. | Partial | `app/lead-jobs/page.tsx`, `app/actions.ts:createLeadJobAction`, `app/api/import/csv/route.ts` | Lead jobs store selected sources, but real provider extraction is not implemented. |
| Extraction handles pagination, rate limits, retries, and resume after failure. | Partial | `AsyncJobRun`, checkpoints, provider run IDs, retry attempts, and job logs in `lib/phase1/jobs.ts` | Add real provider adapters, pagination, rate-limit handling, and background workers. |
| Every raw record stores source, source record ID, source payload, extraction ID, and timestamp. | Partial | `RawLead` in `lib/phase1/types.ts`, CSV route creates `source`, `sourceRecordId`, `sourcePayload`, `leadJobId`, `extractedAt` | `leadJobId` approximates extraction ID; add explicit extraction run ID and provider run metadata. |
| Normalization converts raw data into canonical schema. | Done | `lib/phase1/normalization.ts`, `app/api/import/csv/route.ts` | Add broader provider-specific normalization tests. |
| Deduplication merges companies and contacts on exact and fuzzy keys. | Done | `lib/phase1/dedupe.ts`, `app/data-quality/page.tsx` | Add regression tests for fuzzy merge edge cases. |
| Survivorship rules are logged and visible. | Partial | `lib/phase1/dedupe.ts`, `app/actions.ts:mergeDedupeMatchAction`, `app/data-quality/page.tsx` | Merge actions are audited, but field-level survivorship rules are not fully visible. |
| Suppression checks block unsubscribed, bounced, DNC, existing customer, and blocked records. | Done | `lib/phase1/verification.ts`, `lib/phase1/outreach.ts`, signed webhook tests, `app/compliance/page.tsx` | Add real provider credential integration tests. |
| Re-running a job does not duplicate records. | Partial | CSV import idempotency keys, webhook event idempotency keys, job idempotency records, `lib/phase1/dedupe.ts`, Prisma unique indexes, normalized projection mirror | Extend idempotency to normalized-table read/write cutover and real provider extraction runs. |
| Job progress and errors are visible to the user. | Done | `app/lead-jobs/page.tsx`, `LeadJob.progress`, structured runs, latest logs, retry controls | Add streaming/live worker updates when background queue lands. |

## 24.2 Verification

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Every email receives A/B/C/D/S grade. | Done | `lib/phase1/verification.ts` | Replace local heuristic with provider-backed verification when credentials exist. |
| D-grade emails are never exported as verified email leads. | Done | `lib/phase1/exporting.ts:recordIdsForExport`, `defaultExportRules` | Add automated tests. |
| Suppressed emails are never exported or assigned. | Done | `lib/phase1/exporting.ts`, `lib/phase1/sdr.ts`, `lib/phase1/verification.ts` | Add end-to-end suppression tests. |
| Catch-all and risky emails are segmented separately. | Partial | `VerificationResult.catchAll`, grade `C`, `app/data-quality/page.tsx` | Risk flags exist, but dedicated segmentation/export views need tightening. |
| Phone numbers are normalized and validated where possible. | Done | `lib/phase1/normalization.ts`, `lib/phase1/verification.ts:phoneStatusFor` | Connect Twilio Lookup for validation and RingCentral for telephony/SMS once credentials exist. |
| Verification result stores provider, timestamp, raw response, and TTL. | Done | `VerificationResult` in `lib/phase1/types.ts`, `lib/phase1/verification.ts` | Add provider-specific raw payload preservation. |
| Stale verification can be re-run without duplicating records. | Partial | `runWorkspaceVerification` updates contacts and writes verification history | No stale-only TTL selector; repeated runs append new verification history. |

## 24.3 Enrichment

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Enrichment fills target fields from selected providers. | Partial | `lib/phase1/enrichment.ts`, `app/enrichment/page.tsx` | Local providers run automatically; no real provider selection or credentials yet. |
| Enrichment waterfall stops when required fields are filled. | Partial | `coverageForCompany`, `coverageForContact`, provider loop break in `lib/phase1/enrichment.ts` | Stops on coverage threshold, not configurable required-field sets. |
| Existing fresh fields are not re-enriched unnecessarily. | Partial | Provider cache in `lib/phase1/enrichment.ts`, `ProviderCacheEntry` | Cache exists, but re-runs still write enrichment result history. |
| Enrichment result stores provider, timestamp, confidence, and raw response. | Done | `EnrichmentResult` in `lib/phase1/types.ts`, `writeEnrichmentResult` | Add real provider payloads later. |
| User can see enrichment field coverage. | Done | `app/enrichment/page.tsx`, CRM contact/account pages | Add tests for displayed coverage. |
| Expensive enrichment can be limited to high-value leads. | Not started | N/A | Add enrichment budgets and high-value gating controls. |

## 24.4 Segmentation and Scoring

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Segment rules assign deterministic tags. | Done | `lib/phase1/scoring.ts`, `app/enrichment/page.tsx` | Add tests for each default rule. |
| Lead score is calculated from explainable categories. | Done | `LeadScore.breakdown`, `lib/phase1/scoring.ts` | Add calibration tests. |
| User can see score breakdown. | Done | `app/enrichment/page.tsx`, CRM contact pages | Add deep-link from contact to score history. |
| Priority tiers P1/P2/P3/P4/S are assigned correctly. | Done | `lib/phase1/scoring.ts`, `lib/phase1/verification.ts` | Add tests for threshold boundaries. |
| Manager/admin can manually override priority or segment. | Not started | N/A | Add explicit override action, reason field, and audit record. |
| Segment-based exports work. | Partial | Export rows include `segment`; export rules use grade/status/score | Add export filters by segment, priority, and campaign. |

## 24.5 CSV Outputs

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Companies CSV exports with defined columns. | Done | `lib/phase1/exporting.ts:exportColumns`, `app/exports/page.tsx` | Add column contract tests. |
| Contacts CSV exports with defined columns. | Done | `lib/phase1/exporting.ts:exportColumns` | Add custom field export handling. |
| Verified email leads CSV includes only approved email grades. | Done | `recordIdsForExport` for `verified_email_leads` | Add tests. |
| Phone leads CSV includes valid/phone-ready leads. | Partial | `sdr_assignments` export type, phone-required rule | No dedicated phone leads export type yet. |
| Segmented CSV exports by segment/priority/campaign. | Partial | Export rows include segment/priority; campaigns exist | Add filter UI and saved filter snapshots. |
| SDR-ready assignment CSV includes SDR, due date, channel, and CRM link. | Partial | `sdr_assignments` export includes owner, due date, channel, next task | CRM link and richer assignment metadata are missing. |
| Exports exclude suppressed, unsubscribed, hard-bounced records. | Done | `lib/phase1/exporting.ts`, suppression side effects in `lib/phase1/outreach.ts`, `tests/unit/webhooks.test.ts` | Add export E2E after real provider webhooks land. |
| Export history stores user, timestamp, job ID, filter snapshot, and record count. | Partial | `ExportRecord.createdById`, `createdAt`, `leadJobId`, `recordCount`, `exportRuleId`, normalized `Export.filterSnapshot`, `lib/phase1/export-read-path.ts` | Local snapshot stores export rule and IDs; normalized projection now stores the filter snapshot shape. Add richer UI filters by segment/priority/campaign. |

## 24.6 CRM

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Each company has an account page. | Done | `app/crm/accounts/[id]/page.tsx` | Add 404/permission tests. |
| Each contact has a profile page linked to an account. | Done | `app/crm/contacts/[id]/page.tsx` | Add 404/permission tests. |
| Account page shows firmographics, contacts, deals, activity, notes, tasks, compliance, and source history. | Done | `app/crm/accounts/[id]/page.tsx` | Add screenshot QA. |
| Contact page shows verification, enrichment, scoring, outreach history, notes, tasks, and compliance. | Done | `app/crm/contacts/[id]/page.tsx`, `lib/phase1/outreach.ts` views | Add richer outreach aggregation tests. |
| Opportunities track stage, amount, probability, expected close date, owner, and source. | Done | `Opportunity` type, `app/crm/opportunities/page.tsx`, normalized `Opportunity` read adapter | Add validation for stage transitions. |
| Activity timeline captures emails, calls, SMS, notes, tasks, meetings, and status changes. | Done | `Activity`, `lib/phase1/outreach.ts`, CRM detail pages, `lib/phase1/crm-event-read-path.ts` | Dedicated meeting logging can be expanded. |
| Custom fields can be created and exported. | Partial | `CustomField`, `CustomFieldValue`, CRM pages | Custom fields are visible in CRM but not included in CSV exports. |
| Merge, reassign, suppress, and delete/anonymize actions are admin-controlled. | Partial | Dedupe merge, SDR reassignment, compliance suppression, retention anonymization, data subject deletion workflow | Needs a unified admin-controlled object action center. |

## 24.7 SDR Workflow

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Leads can be assigned manually and automatically. | Partial | `lib/phase1/sdr.ts`, `app/sdr/queue/page.tsx`, reassignment actions | Automatic assignment exists; manual assignment should be more explicit. |
| Round-robin routing works. | Done | `assignWorkspaceLeads`, assignment methods in `lib/phase1/sdr.ts` | Add tests. |
| Territory/industry/score-based routing works where configured. | Done | `lib/phase1/sdr.ts` routing/team logic | Add scenario tests per routing mode. |
| SDR sees assigned leads only unless permission allows more. | Partial | `assertPermission`, `sdrQueueSnapshot` supports owner filtering | Demo session is admin; route-level role filtering is not production-complete. |
| SDR queue shows priority, due date, status, and recommended channel. | Done | `app/sdr/queue/page.tsx` | Add screenshot tests. |
| First-touch and follow-up SLA timers work. | Done | `refreshSlaStatuses`, reminders in `lib/phase1/sdr.ts` | Add time-based tests. |
| Overdue tasks are visible. | Done | `app/sdr/queue/page.tsx`, CRM task views | Add date-boundary tests. |
| Manager can view team activity and reassign leads. | Done | `app/sdr/manager/page.tsx`, reassignment actions | Add manager role tests. |

## 24.8 Outreach Tracking

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Email sent/opened/clicked/replied/bounced/unsubscribed events are stored. | Done | `EmailEvent`, signed `/api/webhooks/email`, `lib/phase1/webhooks.ts`, `app/outreach/events/page.tsx`, `lib/phase1/outreach-read-path.ts` | Add real provider adapter mapping. |
| Hard bounces automatically suppress email. | Done | `applyEmailEventSideEffects`, `applyHardSuppression`, signed webhook tests | Add live provider credential test lane. |
| Unsubscribes immediately suppress contact/email. | Done | `createEmailEvent`, suppression side effects | Add one-click unsubscribe endpoint. |
| Calls are logged with status, duration, notes, and recording link where enabled. | Done | `TrackedCall`, `CallLog`, outreach/CRM pages, RingCentral Local placeholder, normalized CRM/outreach read adapters | Add real RingCentral call webhooks. |
| SMS events are stored with delivery/reply/opt-out status. | Done | `SmsEvent`, `createSmsEvent`, signed `/api/webhooks/sms`, webhook idempotency tests, RingCentral Local placeholder, `lib/phase1/outreach-read-path.ts` | Add real RingCentral signature compatibility when credentials are available. |
| Meetings can be logged or synced. | Partial | `Activity.type = Meeting`, opportunity/assignment meeting statuses | No dedicated meeting sync or meeting form yet. |
| Positive reply or meeting can create opportunity. | Partial | AI reply classification, manual opportunity creation, campaign opportunity metrics | No automatic prompt/action creates opportunities from positive replies yet. |

## 24.9 Compliance

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| Every record has source and extraction timestamp. | Partial | `RawLead.source`, `RawLead.extractedAt`, `sourceLineage` on contacts/companies | Source exists broadly; extraction timestamp is not propagated to every object. |
| Consent/lawful basis fields exist. | Done | `Contact.lawfulBasis`, `Contact.consentStatus`, `Contact.consentSource`, contact detail compliance form, migration defaults | Add production legal review of basis choices and provider capture evidence. |
| Suppression list is enforced globally. | Done | Verification, exporting, outreach, SDR side effects | Add comprehensive suppression regression tests. |
| Delete/anonymize workflow exists. | Done | `DataSubjectRequest`, `createDataSubjectRequestAction`, `completeDataSubjectRequestAction`, compliance report request queue, deletion suppression evidence | Add production identity verification and legal hold handling. |
| Data retention settings are configurable. | Done | `app/reports/compliance/page.tsx`, `updateRetentionPolicyAction` | Add policy validation tests. |
| LinkedIn scraping automation is not supported unless sanctioned integration exists. | Done | `app/compliance/page.tsx`, blueprint-aligned UI copy | Add source-connector guard when real integrations land. |
| Cold email templates require unsubscribe mechanism and physical address fields. | Done | `enforceSequenceStepCompliance`, sequence-step editor physical address field, campaign step compliance status, compliance tests | Add provider-rendered email preview tests. |
| SMS STOP and DNC suppression are supported. | Done | `SuppressionRecord` types, `createSmsEvent`, signed SMS webhook tests, compliance page, RingCentral Local placeholder | Add real RingCentral STOP webhook fixture once credentials exist. |
| Call recording retention and consent settings exist. | Done | `TrackedCall.recordingConsent`, call event consent form, consent-gated recording storage, retention policy and tests, RingCentral Local placeholder | Add real RingCentral consent webhook fixtures when credentials exist. |
| Audit logs track critical changes. | Done | `appendAudit`, audit sections in compliance/reporting pages | Add audit coverage tests. |

## 24.10 Roles, Dashboards, and Reliability

| Criteria | Status | Evidence | Gap / next step |
|---|---|---|---|
| RBAC enforces role permissions. | Partial | `lib/phase1/auth.ts`, cookie/env session resolver, page/API/action gates, filtered app shell, auth tests | Needs production identity provider integration and signed session management. |
| Workspace isolation is enforced. | Partial | Active session workspace filters pages, query helpers, export routes, action mutations, Prisma workspace-scoped schema, normalized projection sync, normalized contact/account/compliance/CRM/outreach/export read-path tests, scoped normalized export/outreach write tables | Continue normalized write-path cutover for CRM/compliance/reporting actions, then add production tenant/session tests. |
| Admin dashboard shows lead source, SDR, campaign, deliverability, pipeline, and data quality metrics. | Done | `app/reports/page.tsx`, `lib/phase1/reporting.ts` | Add metric contract tests. |
| Async jobs are observable with status, retries, failures, and logs. | Partial | `AsyncJobRun`, `JobLog`, `JobIdempotencyRecord`, provider execution job/run records, local worker queue claiming/leases/retries, retry action, and Lead Jobs monitor | Needs production worker process/deployment and real provider execution. |
| Webhooks are validated and idempotent. | Partial | Signed `/api/webhooks/email` and `/api/webhooks/sms`, HMAC validation, `WebhookEvent` receipts, duplicate suppression tests, scoped normalized email/SMS write tables | Add provider-native signature schemes and production replay-window checks. |
| Audit logs show who changed what and when. | Done | `AuditLog`, `appendAudit`, compliance/report pages | Add audit event tests. |
| System can safely retry failed jobs without creating duplicates. | Partial | Retry attempts reuse idempotency keys and CSV imports replay existing jobs | Extend to provider event idempotency and persisted queue locks. |

## Highest Priority Follow-up Work

1. Continue persistence hardening: contact/account, compliance/reporting, CRM event, outreach event, and export read paths can now prefer normalized Prisma rows; export and outreach event/webhook writes now use scoped normalized table sync. Next cut over CRM/compliance/reporting write paths, then add production migrations and backup/restore checks.
2. Expand the test baseline with workflow-specific E2E, webhook, auth/RBAC, and persistence migration coverage.
3. Add production identity provider integration, signed sessions, and expanded route/data permission E2E coverage.
4. Add real provider adapters, provider rate limits, and resumable extraction execution behind feature flags and contract tests.
5. Add first real provider integration lane when credentials and production safety checks are ready.
6. Add provider-native webhook signature compatibility, replay-window enforcement, and real provider webhook fixtures.
7. Run production legal/privacy review for lawful basis defaults, DSR identity verification, legal holds, and outbound footer language before live sending.

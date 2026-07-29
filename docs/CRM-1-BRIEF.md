/goal Run phase CRM-1 (the spine) from GROWTH_OS_PLAN.lead-engine-crm.md: the six Growth OS models Prisma-native, transactional repositories, paginated read models, the stage state machine, the Approval Inbox with the revision flow, the chat API, and the IA change. CRM-0's guardrails are merged to main and CI enforces the projection invariant.

Canonical context, all committed in this repo root: CLAUDE.md (read first — golden rules, resolved conflicts, open items), GROWTH_OS_PLAN.lead-engine-crm.md §CRM-1, GROWTH_OS_END_TO_END_PLAN_v9.1.md §6 §7 §10 §11, GROWTH_OS_EXECUTION_ROADMAP.md P1, GROWTH_OS_ERRATA.md (all five entries binding — entry 5 especially: decision and identity fields are NOT approved content). Also read docs/CRM-0-BASELINE.md — measured ground truth supersedes the plan's approximations (77 models, deleteMany at persistence-projection.ts:1599, two stepNumber===1 sites at outreach.ts:341 and :824, 455-test baseline).

@syncore/contracts is pinned at v0.2.1 (file:../syncore-contracts locally, authenticated sibling checkout in CI). It is authoritative for every shape it defines: ApprovalType, ApprovalStatus, StageType (18 members), the ApprovalPayload discriminated union (11 types), the ApprovalRecord split (payloadSha256 and approvalId live on the record, never in the hashed payload), decide/revise payloads, NicheRequest/NicheBrief with brands, ResearchRun* shapes. Import — never redeclare. Where a contracts shape and v9.1 §6 prose differ, contracts wins (that is errata entry 5's whole point).

Housekeeping first, one early commit:
- Add to CLAUDE.md open items: the e2e job's Playwright smoke step carries continue-on-error: true (pre-existing; mobile responsive-overflow + SDR-scoped routing unstable), so a green e2e job does not certify green e2e tests. Do not attempt to stabilize that suite in this phase — but any UI you build in CRM-1 (Approval Inbox, revision flow, IA changes) must add its Playwright coverage OUTSIDE the continue-on-error step, so new surfaces get real enforcement while the legacy smoke stays advisory.

Scope, per the repo plan:

1. Prisma models — NicheRequest, ResearchRun, NicheBrief, Campaign, CampaignStageRun, Approval — all native, composite indexes with workspaceId leading, never in AppState/upsertOrder/updateState (the CI check enforces the projection file; your tests must additionally assert no updateState write path, per the plan's hardened tests). NicheBrief.researchRunId is required — the schema-level enforcement of "no brief before research," matching the contracts brand. Field definitions from v9.1 §6 as refined by contracts 0.2.1.

2. Transactional repositories per model, following the lib/phase1/auth-fast-path.ts precedent. The Approval repository exposes create, decide, revise ONLY — no update method on the payload exists at the repository layer. revise: original → SUPERSEDED, new row with supersedesApprovalId and a fresh SHA-256. Hashing input is the payload's canonical JSON form as documented in the contracts README — implement the few lines here, matching the fixture canonicalization exactly, with a hash-stability test against a contracts fixture.

3. CampaignStageRun state machine: PENDING → AWAITING_APPROVAL → APPROVED → RUNNING → COMPLETED | FAILED | PARKED | CANCELLED. Illegal transitions rejected at the repository layer; failureCode + retryCount on FAILED; a transition-matrix test covering every pair.

4. CostEntry: extend ProviderUsageLedger with stageRunId (nullable for legacy rows). One ledger — never a second table.

5. Read models: server-side pagination, tight select, workspaceId in every where. No take:500/take:1500 caps — the baseline documents the existing anti-pattern; do not replicate it in anything new.

6. Approval Inbox UI + revision flow. Render from the contracts discriminated union — exhaustive switch, so an unhandled approval type is a compile error. Approve / Decline / Edit; Edit routes through revise, never a mutated decide. Two-person threshold (T1/T2) lands as workspace config fields with enforcement in the decide path — a decide above T2 requires a second distinct approver before the approval reaches APPROVED; keep the UI minimal, full policy UI is later. Playwright coverage for the Inbox and revision flow, outside the continue-on-error step.

7. Chat API:
   - POST /api/chat/niche-request — creates a NicheRequest (never a brief; the guard that no NicheBrief and no NICHE_TEST approval can exist without a completed ResearchRun is asserted in tests, per the plan)
   - POST /api/approvals/{id}/decide — records decision + acting identity + decidedAt
   - POST /api/approvals/{id}/revise — supersession semantics as above
   All bearer-authed with constant-time compare; acting human resolved from the identity the bot passes and recorded on the decision.
   Outbound notify to the bot: POST {bot}/notify with the contracts NotifyEnvelope, HMAC-signed per the contracts webhook scheme (headers and replay window imported from contracts, the HMAC lines written here per the no-shared-crypto-helper rule), origin allow-listed, with an outbox/retry so a bot outage never delays or blocks a decision — the dashboard is authoritative when the bot is down.

8. IA: Campaigns as nav root; existing function nav into a secondary Library/Ops group; a Lead Hub launch tile placeholder; outreach area labeled "Outreach (legacy sequences)" with a header comment marking OutreachCampaign legacy at both stepNumber sites (:341 and :824).

9. Contracts INFERRED confirmation duty: contracts 0.2.1 incorporates the CRM-1 confirmation and corrected canonical fixture hash recorded in docs/CRM-1-CONTRACTS-FEEDBACK.md. Never silently diverge from a contracts shape; if one is wrong, the fix lands there first and this repo consumes the bump.

Current implementation note (Wave 1, Step 1.3): final NICHE_TEST decisions from dashboard and chat now share one serializable, row-locked transaction. It validates the Contracts payload/hash and request/run/brief chain, approves the brief, creates one DRAFT Campaign, initializes RESEARCH as COMPLETED and HUB_SEARCH as PENDING, and enqueues one deterministic final notification. Replay, concurrency, retry, rollback, and seeded-route behavior are verified against PostgreSQL. See the implementation tracker for the remaining CRM-1 gaps and exact next step.

Hardened tests per the plan, in addition to the above: new tables absent from upsertOrder and never written via updateState; approval payload has no update path and a revise creates a referencing row with the original SUPERSEDED; a two-workspace tenant-isolation roundtrip returns zero cross-tenant rows; read models paginate; the two-person threshold enforced server-side.

Acceptance: create a campaign → an approval appears in the Approval Inbox → decide it → state persists → an edit produces a revision chain → the bot receives a signed, replay-protected notify (fake bot server in tests — the real bot's B1 is being built in parallel and the joint P1 test comes after both phases close). Nothing new touches the blob. CI green on every push including the projection check.

This is a 3–4 week phase — the largest so far. Propose a step plan with commit boundaries before writing anything; small commits, lint/typecheck/test green after each. Where the plan, v9.1, contracts, and the errata leave a genuine gap, surface the judgment call and wait, as the contracts sessions did — do not smooth over ambiguity.

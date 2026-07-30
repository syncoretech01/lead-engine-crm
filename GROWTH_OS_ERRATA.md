# GROWTH_OS_ERRATA — supersessions to Plan v9.1

Where this file conflicts with `GROWTH_OS_END_TO_END_PLAN_v9.1.md` or any per-repo plan, this
file wins. Each entry is a settled decision with its reasoning recorded — do not re-litigate,
and do not "fix" code to match the losing side.

---

## 1. Personalization runs in the CRM (2026-07-24, Execution Roadmap §1)

Supersedes v9.1 §13 and §31, which say to repurpose the Research Console's email writer as a
scan-fed personalization microservice.

**Decision:** personalization is an inline CRM pipeline stage between "list ready" and "launch."
The Console's writing logic and QA rules are **ported** into the CRM (see the research-console
plan §RC4), never called remotely.

**Reasoning:** the Console runs on a local Windows machine that may be off — acceptable for
research (occasional, human-initiated, delay-tolerant), not for a stage that blocks campaigns.
Data gravity is also in the CRM: audit findings, tiers, brief angles, and the cost ledger its
Tier-A model calls must write to.

## 2. Seven repos, not five (2026-07-24, Execution Roadmap §1)

Supersedes v9.1 §1/§5.3, which govern five repos and classify the Chatbot as a non-repo service.

**Decision:** seven repos — the five originals plus `syncore-contracts` (shared contract
package; every service depends on it, so it can live inside none of them) and
`syncore-growth-bot` (own runtime, own deploy cadence; physically separate to reinforce that it
is a remote control, not a second system of record). The Console Agent remains inside
`syncore-research-console` at `/agent`.

## 3. The pilot chat surface is Slack, not Telegram (2026-07-27, syncore-growth-bot CLAUDE.md § Platform decision)

Supersedes v9.1 §15/§18/§22 G0, the Execution Roadmap's repo table ("Telegram control
surface"), and the growth-bot repo plan §1.

**Decision:** Slack is the pilot surface. The `ChatPlatform` interface is unchanged; the
Telegram adapter remains implemented, tested, and selectable via `SYNCORE_BOT_PLATFORM=telegram`.
All platform enums keep `telegram | slack | dashboard` members.

**Reasoning:** Telegram does not open in Pakistan without a VPN, where the operator is — a
remote control that needs a VPN is not a remote control. On the remaining criteria Slack won:
Socket Mode needs no public inbound endpoint, Block Kit gives the best approval buttons,
threading suits the report narrative, free at this scale. WhatsApp was runner-up, rejected
because business-initiated messages outside a 24-hour window require Meta-pre-approved
templates — this bot's job is unsolicited notifications, so every new notify kind would gain a
multi-day external approval dependency.

**Known cost, deliberately deferred:** Slack voice is weaker than Telegram's, and B2
(voice → approved campaign) is the first real demo. Decision point at B2: if Slack voice is
inadequate, add WhatsApp as an intake-only second adapter. Do not pre-empt this.

## 4. Verifier ground truth lives in the contracts package (2026-07-27, syncore-contracts CHANGELOG § Reconciled against source)

v9.1 §3.4's verifier summary remains directionally correct, but exact shapes were reconciled
against the Go source on 2026-07-27 and the draft was wrong in most details (reason-code names,
callback headers, batch shapes, paging, limits). `@syncore/contracts` ≥ 0.1.0 is authoritative
for every verifier wire shape. Notable corrections: the verifier signs the **raw body alone**
(no timestamp/nonce — replay protection is open item A against the verifier repo, P3);
`BATCH_MAX_EMAILS` is 10,000 with a 65,536-byte body cap that binds first; results paging is
offset/limit; batch states are `queued | running | done`.

## 5. Decision and identity fields are not approved content (2026-07-28, syncore-contracts 0.2.0 CHANGELOG)

Refines v9.1 §6's `Approval` and `ProviderRunProposal` field lists, which conflate the approved
payload with its identity and outcome.

**Decision:** the hashed `ApprovalPayload` contains **content only**. `approvalId` and
`payloadSha256` live on the separate `ApprovalRecord` — hashing the id would make identical
content hash differently across revisions, destroying the one question a revision chain exists
to answer ("did the content change?"). `ProviderRunProposal` carries **no `decision` field** in
the approved payload — a decision is an outcome; embedding it means the hashed content mutates
when someone decides, which is exactly the mutation §10 forbids. Decisions are recorded on the
`ApprovalRecord` / decide payload.

**Consequence for implementers:** where v9.1 §6 prose and `@syncore/contracts` differ on these
shapes, the contracts package wins.

## 6. Provider usage evidence and the Growth financial ledger are separate concerns (2026-07-30, ADR-001)

Supersedes `GROWTH_OS_END_TO_END_PLAN_v9.1.md` §§6, 21, and 26;
`CLAUDE.md`; `docs/CRM-1-BRIEF.md`; and every repository instruction that:

- requires native Growth financial events to be written directly into the existing
  `ProviderUsageLedger`;
- interprets "one cost ledger" as requiring one physical database table;
- treats provider operational usage and financial-control events as the same record; or
- requires `CostEntry` to be removed merely because it is a second physical table.

**Decision:** the Syncore Tech project owner accepted ADR-001 Option C on 2026-07-30. Provider
operational usage evidence and Growth financial-control events are separate concerns with distinct
ownership and semantics:

1. `CostEntry` is the authoritative Prisma-native Growth OS financial control ledger.
2. `ProviderUsageLedger` remains legacy operational provider evidence while it is owned by the
   `AppState` projection.
3. Native Growth financial events must not be written directly into `ProviderUsageLedger` while it
   remains projection-owned.
4. Only authoritative `CostEntry` financial events contribute to Growth OS spend, campaign spend,
   stage spend, budget consumption, authorization reconciliation, overrun calculations, and unit
   economics.
5. A provider-usage row may link to a `CostEntry` financial event as supporting evidence, but it is
   not another financial charge and must never be counted twice.
6. Growth financial facts are append-only.
7. Corrections use explicit adjustment or reversal events, never destructive amount updates or
   deletion.
8. Historical provider rows must not be assigned to campaigns, stages, approvals, authorizations,
   or financial actions unless authoritative evidence proves the linkage.
9. Existing rows in both tables must be preserved.
10. Implementation must use additive, reversible schema changes and preflight existing data.
11. The current timestamp-only union of `CostEntry` and `ProviderUsageLedger` is a temporary
    compatibility seam, not the final authoritative public financial read model.
12. The legacy blob ownership peel remains a separate, deferred project and is not required before
    the pilot.

**Meaning of one ledger:** the public Growth OS "cost ledger" is one authoritative financial
reporting model. It does not require one physical database table. Only `CostEntry` financial events
count toward authoritative financial totals; linked operational evidence remains evidence.

**Reasoning:**

- Projection synchronization deletes normalized database rows whose IDs are absent from the
  `AppState` blob.
- Projection upserts can overwrite database rows with matching IDs.
- Native financial facts therefore cannot safely live in the currently projected
  `ProviderUsageLedger`.
- Mutable provider telemetry and immutable financial control records serve different operational,
  audit, authorization, and correction purposes.
- Option C avoids silent financial data loss and makes the no-double-counting rule explicit.
- A native financial event model supports non-provider expenses—including research,
  MillionVerifier authorization/results, Audit Bot scans, full audits, videos, personalization and
  AI models, Mailshake, and other outreach tools—without fabricating provider-job records.
- The separation permits incremental implementation without forcing the full blob migration before
  the pilot.

**Implementation boundary:** this erratum makes the ownership decision binding; it does not approve
a final Prisma schema or authorize implementation. Exact fields, constraints, migrations, writers,
budget gates, reconciliation, and the public financial read model belong to a separately approved
Wave 1, Step 1.4B. No paid Growth OS execution is enabled by this documentation decision.

---

*Maintained alongside v9.1. New supersessions append here with date, source, decision, and
reasoning. A supersession that isn't in this file hasn't happened.*

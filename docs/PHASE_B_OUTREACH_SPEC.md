# Phase B — Outreach e-blast + engagement-ranked assignment (Flow A & Flow B)

**Audience:** an automated coding agent (Codex) executing this end-to-end without further questions.
**Repo:** `lead-engine-crm` (Next.js 16 App Router, React 19, TS6 strict, Prisma/Postgres on Neon, Vitest).
**Author context:** this continues "Phase B" of the SES work. Phase A (transactional send), A.5 (link hardening), and Phase C (bounce/complaint webhook + auto-suppress) are **already shipped and live**. Do **not** rebuild them.

The owner has **signed off legally** and supplied: physical address `1500 N Grant St, Denver, CO 80203, USA`, outreach **From** `bobby@syncoretech.com` (display "Bobby Jones"), outreach **Reply-To** `replies@syncoretech.com`. SES domain `syncoretech.com` is verified (so any `@syncoretech.com` From sends with no extra verification). Live sends are gated by `SYNCORE_ENABLE_LIVE_PROVIDERS=true` **and** an enabled `amazon_ses` provider connection in `live` mode.

---

## 0. The two flows this delivers

- **Flow A — assign *before or after* on the existing deterministic lead score.** Owner/Manager click "Assign now"; uses `partitionLeadsForAssignment` + `assignWorkspaceLeads` exactly as today. **No scoring change.**
- **Flow B — assign *after* a campaign on a PURE ENGAGEMENT score.** Owner/Manager click "Score by engagement & assign" on a campaign that has send results. The pre-campaign deterministic score is **discarded** for these contacts: their `score`/`priority` are **overwritten** from blast engagement (replied/clicked/opened/delivered), then assigned in engagement-rank order.

Assignment and campaign membership are **independent** in the data model (a campaign's audience is selected by `sourceJobIds`, not by assignment), so both orderings already work. This spec adds the **real e-blast engine** (the thing both flows send through) and the **engagement scorer** (Flow B only).

**Explicitly OUT of scope (later phases — do not build here):** per-SDR individual sending identities, SDR self-serve bulk send, RingCentral live SMS/voice (still `executionMode: "mock"`), inbound reply capture. Phase B's e-blast sends as the **manager identity** (`bobby@`), which is what the owner asked for the blast.

---

## 1. Owner-side prerequisites (already done OR the owner will do in Vercel/AWS)

These are **config, not code**. Code must read them, never hardcode secrets.

| Where | Variable | Value |
|---|---|---|
| Vercel env | `SYNCORE_MAILING_ADDRESS` | `Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA` |
| Vercel env | `SYNCORE_OUTREACH_FROM` | `Bobby Jones <bobby@syncoretech.com>` |
| Vercel env | `SYNCORE_OUTREACH_REPLY_TO` | `replies@syncoretech.com` |
| Vercel env | `SYNCORE_UNSUBSCRIBE_SECRET` | a long random secret (HMAC key for unsubscribe tokens) |
| Vercel env (exists) | `SYNCORE_APP_URL` | `https://leadenginecrm-five.vercel.app` (or custom domain) |
| Vercel env (exists) | `SYNCORE_ENABLE_LIVE_PROVIDERS` | `true` |
| AWS SES | sending quota | owner verifies SES → Account dashboard quota covers blast volume; warm up / request production increase if needed |

Add all new vars to `.env.example` with safe placeholder values and a one-line comment each. **Code must degrade gracefully if a var is missing** (see §2/§3 fallbacks) — never crash a page render because an env var is unset.

---

## 2. Config helpers (new small module)

Create `lib/phase1/outreach-config.ts` (server-only):

```ts
export function outreachMailingAddress(env = process.env): string {
  return env.SYNCORE_MAILING_ADDRESS?.trim() || "Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA";
}
export function outreachFrom(env = process.env): string {
  return env.SYNCORE_OUTREACH_FROM?.trim() || "Bobby Jones <bobby@syncoretech.com>";
}
export function outreachReplyTo(env = process.env): string {
  return env.SYNCORE_OUTREACH_REPLY_TO?.trim() || "replies@syncoretech.com";
}
export function outreachBatchSize(env = process.env): number {
  const n = Number(env.SYNCORE_OUTREACH_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}
```

Also update `lib/phase1/compliance.ts`:
- Change `defaultPhysicalAddress` from the hardcoded SF string to read the env:
  `export const defaultPhysicalAddress = process.env.SYNCORE_MAILING_ADDRESS?.trim() || "Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA";`
  (compliance.ts is already server-side — it imports `node:crypto` — so reading `process.env` is fine.)
- In `appendEmailFooter`, change the unsubscribe line from the literal `defaultUnsubscribeUrl` to the placeholder so the renderer can inject a per-contact signed URL:
  `parts.push("Unsubscribe: {{unsubscribe_url}}");`
  (`hasUnsubscribeMechanism` already matches `{{unsubscribe_url}}`, so compliance status stays "Compliant".)

---

## 3. Build item A — signed unsubscribe token + public unsubscribe endpoints

### A1. Token module — `lib/phase1/unsubscribe-token.ts` (new)
HMAC-SHA256 over `${workspaceId}:${contactId}`, no expiry (unsubscribe links must never expire), URL-safe.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(env = process.env): string {
  return env.SYNCORE_UNSUBSCRIBE_SECRET?.trim() || "syncore-dev-unsubscribe-secret-change-me";
}
function b64url(buf: Buffer | string): string { /* base64 → base64url */ }

export function signUnsubscribeToken(workspaceId: string, contactId: string, env = process.env): string {
  const payload = b64url(`${workspaceId}:${contactId}`);
  const sig = b64url(createHmac("sha256", secret(env)).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string, env = process.env):
  | { ok: true; workspaceId: string; contactId: string }
  | { ok: false } {
  // split on ".", recompute sig, timingSafeEqual, decode payload, split on first ":"
}

export function buildUnsubscribeUrl(workspaceId: string, contactId: string, env = process.env): string {
  const base = (env.SYNCORE_APP_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "")).replace(/\/$/, "");
  const token = signUnsubscribeToken(workspaceId, contactId, env);
  return `${base}/unsubscribe/${encodeURIComponent(contactId)}?t=${encodeURIComponent(token)}`;
}

export function buildOneClickUnsubscribeUrl(workspaceId: string, contactId: string, env = process.env): string {
  // same base, points at the POST API for RFC 8058 one-click:
  // `${base}/api/unsubscribe?t=${token}`
}
```
Guard: `verifyUnsubscribeToken` must reject when token's `contactId` ≠ the `contactId` in the route param (caller checks).

### A2. Public confirm page — `app/unsubscribe/[contactId]/page.tsx` (new, server component)
- `export const dynamic = "force-dynamic"; export const runtime = "nodejs";`
- Read `searchParams.t`; `verifyUnsubscribeToken`; if invalid OR `result.contactId !== params.contactId` → render a neutral "This link is invalid" message (do **not** leak whether the contact exists).
- If valid: render a minimal branded page (reuse existing global CSS/panel classes) with a confirm `<form method="post" action="/api/unsubscribe?t=...">` containing a submit button "Unsubscribe me". On success the API redirects back here with `?done=1`; show "You've been unsubscribed."
- No app chrome/nav, no auth. This page must be reachable logged-out.

### A3. One-click API — `app/api/unsubscribe/route.ts` (new)
- `export const runtime = "nodejs";`
- Handle **POST** (RFC 8058 `List-Unsubscribe-Post` one-click + the page's confirm button). Optionally also handle GET→render-less 405 or redirect to the page.
- Read `?t=` token; `verifyUnsubscribeToken`. Invalid → `200` anyway (don't reveal validity) but do nothing, OR `400` — pick `200` no-op to avoid mail-client retry storms.
- Valid → mutate via **`updateAuthState`** (unauthenticated, cross-workspace — mirror `app/api/webhooks/ses/route.ts`), `{ normalizedTables: outreachEmailWriteTables }`:
  - find `contact` by `id === result.contactId && workspaceId === result.workspaceId`;
  - if found and not already suppressed: `suppressContact(contact, "List-Unsubscribe (email recipient)")`, upsert a `SuppressionRecord` (type `"Unsubscribe"`, email, source `"List-Unsubscribe"`), and `appendWorkspaceAudit(... action: "email_unsubscribe")`. Reuse the helpers already imported by the SES webhook route.
- Rate-limit like the SES route (`checkRateLimit` keyed by IP).
- Return `200` (for one-click) or `303` redirect to `/unsubscribe/{contactId}?done=1` when the submitter is the HTML form (detect via `Accept`/a hidden `redirect=1` field).

### A4. Proxy allowlist — `lib/phase1/auth-routes.ts` + `proxy.ts`
- Add `export function isPublicUnsubscribePath(pathname: string)` returning true for `pathname === "/api/unsubscribe"` or `pathname.startsWith("/unsubscribe/")`.
- In `proxy.ts`, add `|| isPublicUnsubscribePath(pathname)` to the early allow `if` (next to `isSignedWebhookPath`). Import it.
- **Why:** `proxy.ts` 401s/redirsects everything without a session; without this the mail-client one-click POST and the public page are blocked (this is the exact class of bug that blocked the SES subscription earlier).

---

## 4. Build item B — SES raw-MIME send with List-Unsubscribe headers

Extend `lib/providers/adapters/amazon-ses.ts`. The current adapter uses `Content.Simple` which **cannot carry custom headers**; one-click unsubscribe requires raw MIME.

### B1. Input type
Add optional fields to `SesSendInput`:
```ts
export type SesSendInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  from?: string;                       // NEW: overrides credential.fromAddress (outreach uses bobby@)
  headers?: Record<string, string>;    // NEW: e.g. List-Unsubscribe, List-Unsubscribe-Post
};
```
- When `input.from` is set, use it as `FromEmailAddress` and the MIME `From:` header.
- When `input.headers` is non-empty → build a **raw MIME** message and send with `Content: { Raw: { Data: <Uint8Array> } }`. Otherwise keep the existing `Content.Simple` path (so transactional is untouched).

### B2. MIME builder — add `buildMimeMessage(input, from): Uint8Array` (exported for tests)
Hand-roll (no new deps — consistent with the hand-rolled SNS verifier):
- Headers: `From`, `To`, `Subject` (RFC 2047 `=?UTF-8?B?...?=` encode only if non-ASCII), `Reply-To` (if `replyTo`), `MIME-Version: 1.0`, `Date`, plus every entry of `input.headers`.
- Body: if both `text` and `html` → `multipart/alternative` with a generated boundary; each part `Content-Type` + `Content-Transfer-Encoding: base64` + base64 of the content (wrap at 76 cols). If only one, single part.
- CRLF (`\r\n`) line endings throughout. Return `Buffer.from(message, "utf8")`.
- Unit-test this builder in isolation (no network).

### B3. Keep return shape identical (`ProviderResult<SesSendResult>`). No behavior change for callers that don't pass `headers`/`from`.

---

## 5. Build item C — outreach send service (real SES, batched, idempotent, out-of-band)

**Hard rule (repo invariant):** provider/network I/O must **never** run inside an `updateState`/`updateAuthState` mutator (mutators are synchronous). Use the **3-phase** pattern already used by `lib/phase1/provider-live-execution.ts` and `lib/phase1/transactional-email-service.ts`.

Create `lib/phase1/outreach-send.ts`:

### C1. Strict audience (fixes the dangerous fuzzy fallback)
```ts
export function campaignAudience(state: AppState, campaign: OutreachCampaign): Contact[];
```
- Return contacts in `campaign.workspaceId` whose `sourceLineage` references **any** of `campaign.sourceJobIds` (exact substring match per existing convention), AND (for legacy campaigns with no `sourceJobIds`) fall back to the **segment match only** — but **never** the "first 8 unsuppressed" fallback in `campaignContacts` (outreach.ts:1057). For real sends, if `sourceJobIds` is empty and segment matches nothing → audience is empty (send nothing; surface "0 recipients").
- Do **not** delete `campaignContacts`; the simulator/metrics still use it. Add `campaignAudience` as the strict path for real send + engagement scoring.

### C2. Eligibility (suppression-before-send)
```ts
export function isSendEligible(contact: Contact): boolean;
```
Mirror `simulateCampaignSend`'s skip rules + compliance: exclude when `contact.isSuppressed`, `contact.doNotContact`, no `contact.email`, `contact.grade === "S"`, `contact.grade === "D"`, or `contact.priority === "S"`.

### C3. Render
```ts
export function renderOutreachEmail(args: {
  step?: SequenceStep; campaign: OutreachCampaign; contact: Contact; companyName: string;
  unsubscribeUrl: string; physicalAddress: string;
}): { subject: string; text: string; html: string };
```
- Start from `step.subject` / `step.bodyTemplate` (fall back to a sane default like the simulator does). Run the same token replacement as `personalize()` in outreach.ts but inject the **real** `unsubscribeUrl` for `{{unsubscribe_url}}` and `physicalAddress` for `{{physical_address}}`, plus `{{first_name}}`, `{{company}}`, `{{segment}}`.
- `enforceSequenceStepCompliance` already guarantees the template carries the `{{unsubscribe_url}}` + `{{physical_address}}` footer (after §2's `appendEmailFooter` change), so a missing footer can't slip through.
- `html`: HTML-escape the text, convert newlines to `<br>`, and render the unsubscribe URL as a real `<a href>`. `text`: the rendered template as-is.

### C4. Phase 1 — plan (sync, inside updateState)
```ts
export function buildCampaignSendBatch(
  state: AppState, workspaceId: string, campaignId: string, opts: { batchSize: number }
): { recipients: PlannedRecipient[]; credentialOk: boolean; reason?: string; totalEligible: number; remaining: number };
```
- Resolve the live SES connection with the same logic as `findLiveSesConnection` in `transactional-email-service.ts` (provider `amazon_ses`, enabled, `resolveProviderExecutionMode(executionMode) === "live"`, prefer the workspace-scoped one). If none → `{ credentialOk:false, reason:"SES not live", recipients:[] }` (caller falls back to `simulateCampaignSend`).
- `resolveLiveProviderCredential(state, connection)`; if not ok → `credentialOk:false`.
- audience = `campaignAudience(state, campaign)`, filtered by `isSendEligible`, **minus** any contact that already has a `Sent` email event for this `campaignId` (idempotency — re-clicking never double-sends). Take first `batchSize`.
- For each → build `PlannedRecipient { contactId, to, subject, text, html, headers, from, replyTo }`:
  - `from = outreachFrom()`, `replyTo = outreachReplyTo()`.
  - `unsubscribeUrl = buildUnsubscribeUrl(workspaceId, contactId)`; `oneClick = buildOneClickUnsubscribeUrl(...)`.
  - `headers = { "List-Unsubscribe": "<" + oneClick + ">, <mailto:" + outreachReplyTo() + "?subject=unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }`.
  - render via `renderOutreachEmail` using `outreachMailingAddress()`.
- Set `campaign.status = "Active"` and `campaign.updatedAt` if any recipients planned.
- Return `recipients`, the resolved `credential` (rides out of the sync phase like `planLiveProviderRun` does), `totalEligible`, and `remaining` (eligible minus this batch).

### C5. Phase 2 — send (async, NO state)
```ts
export async function sendCampaignBatch(
  recipients: PlannedRecipient[], credential: ProviderCredential, workspaceId: string
): Promise<SendOutcome[]>;  // SendOutcome = { contactId; status:"sent"|"failed"; providerMessageId?; reason? }
```
- `ensureLiveProviderAdaptersRegistered()`. For each recipient call `amazonSesSendEmail({ to, subject, html, text, replyTo, from, headers }, { workspaceId, providerId:"amazon_ses", executionMode:"live", requestId:`outreach-${campaignId}-${contactId}`, credential })`.
- Send sequentially or in small concurrency (≤5) to respect SES max send rate. Catch per-recipient; one failure must not abort the batch.

### C6. Phase 3 — record (sync, inside updateState)
```ts
export function recordCampaignSendResults(
  state: AppState, workspaceId: string, campaignId: string, actorUserId: string, outcomes: SendOutcome[]
): { sent: number; failed: number; completed: boolean };
```
- For each `sent` outcome → `createEmailEvent(state, { workspaceId, contactId, campaignId, sequenceId, sequenceStepId, eventType:"Sent", subject, bodySnapshot, actorUserId, messageId: providerMessageId, provider:"Amazon SES", senderEmail: <addr part of outreachFrom()> })`.
  - **Requires extending `createEmailEvent`** (outreach.ts:99) to accept optional `provider?: string` and `senderEmail?: string`; default to the current hardcoded `"Syncore Mail Local"` / provider sender so existing callers are unchanged.
- `failed` outcomes: record nothing (leave un-sent so the next batch retries). Do **not** suppress on a send failure — real hard bounces arrive via the existing SES→SNS webhook and auto-suppress.
- After recording, if `campaignAudience` ∩ eligible ∩ not-yet-Sent is now empty → set `campaign.status = "Completed"` and return `completed:true` (this is the "campaign ended" trigger Flow B waits on).
- `refreshCampaignMetrics(state, workspaceId)`.

---

## 6. Build item D — wire the e-blast action (real when live, simulate fallback)

In `app/actions.ts`, **replace the body** of `simulateCampaignSendAction` (line 1227) with a real-or-simulate send, keeping the export name **and** adding a clearer alias `sendCampaignAction`:

```ts
export async function sendCampaignAction(formData: FormData) {
  const campaignId = stringValue(formData.get("campaignId"));

  // Phase 1: plan (sync)
  const plan = await updateState((state, session) => {
    assertPermission(session, "manage_outreach");
    const batch = buildCampaignSendBatch(state, session.workspace.id, campaignId, { batchSize: outreachBatchSize() });
    return { workspaceId: session.workspace.id, actorUserId: session.user.id, ...batch };
  }, { normalizedTables: outreachCampaignSendWriteTables });

  // Fallback to the simulator when SES isn't live (local/dev parity)
  if (!plan.credentialOk) {
    await updateState((state, session) => {
      assertPermission(session, "manage_outreach");
      const result = simulateCampaignSend(state, session.workspace.id, campaignId, session.user.id);
      appendAudit(state, session, { objectType:"outreach_campaign", objectId:campaignId, action:"provider_send_simulated", newValue:result });
    }, { normalizedTables: outreachCampaignSendWriteTables });
    revalidatePath("/", "layout");
    return;
  }

  // Phase 2: send (async, no state)
  const outcomes = plan.recipients.length
    ? await sendCampaignBatch(plan.recipients, plan.credential, plan.workspaceId)
    : [];

  // Phase 3: record (sync)
  await updateState((state, session) => {
    assertPermission(session, "manage_outreach");
    const summary = recordCampaignSendResults(state, session.workspace.id, campaignId, session.user.id, outcomes);
    appendAudit(state, session, { objectType:"outreach_campaign", objectId:campaignId, action:"provider_send_live", newValue:{ ...summary, remaining: plan.remaining } });
  }, { normalizedTables: outreachCampaignSendWriteTables });

  revalidatePath("/", "layout");
}
export { sendCampaignAction as simulateCampaignSendAction }; // keep the existing import in campaigns/page.tsx working
```
- Note `updateState` must return the closure's value (the transactional service + SES webhook already rely on `updateAuthState` returning a value; confirm `updateState` does too — if not, read state via the existing read path in the action and pass `credential` through). If `updateState` doesn't return, use the same shape as `transactional-email-service.ts`: `readState()` for the plan read, but the credential decryption must still go through `resolveLiveProviderCredential(state, …)`.
- Update the button label in `app/outreach/campaigns/page.tsx` (line ~215) from "Simulate send" to **"Send campaign"**, and add a small helper line under it: when SES live, it sends a real batch of up to `batchSize`; click again to send the next batch until the campaign shows **Completed**.

---

## 7. Build item E — engagement scoring + Flow B assignment

Create `lib/phase1/engagement-scoring.ts`:

### E1. Per-contact engagement for one campaign
```ts
export type EngagementTier = "Replied" | "Clicked" | "Opened" | "Delivered" | "None";
export function computeCampaignEngagement(
  state: AppState, workspaceId: string, campaignId: string
): { contactId: string; score: number; tier: EngagementTier; priority: Priority }[];
```
- Consider only events with `event.campaignId === campaignId && event.workspaceId === workspaceId` (so prior-campaign activity never leaks in). Include SMS events too (`smsEvents` with same campaignId) for future-proofing: `Replied`/`Opt-out`.
- Per contact, take the **strongest** signal: Replied → 100 (`P1`); Clicked → 75 (`P1`); Opened → 45 (`P2`, +5 per extra open capped at +15); Delivered only → 15 (`P3`); Sent only → 5 (`P4`); nothing → 0 (`P4`).
- Exclude contacts that are `Bounced`/`Unsubscribed`/`Spam complaint`/`Opt-out` for this campaign (they're suppressed anyway) — omit them from the result.
- Sort by `score` desc.

### E2. Overwrite contact score with engagement (Flow B only)
```ts
export function applyCampaignEngagementScores(
  state: AppState, workspaceId: string, campaignId: string, now = new Date().toISOString()
): { rescored: number; orderedContactIds: string[] };
```
- For each engagement row, set `contact.score = row.score`, `contact.priority = row.priority`, `contact.fitReason = "Engagement (" + row.tier + ") from campaign " + campaignId`, `contact.updatedAt = now`. (Suppressed contacts keep grade/priority `S`.)
- Return `orderedContactIds` = engagement-desc contact ids (used to drive ordered assignment).
- **This intentionally discards the pre-campaign deterministic score for these contacts** — that is the product requirement for Flow B.

### E3. Ordered assignment
Extend `assignWorkspaceLeads` (sdr.ts:86) options:
```ts
options?: { eligibleContactIds?: Set<string>; orderedContactIds?: string[] }
```
- When `orderedContactIds` is provided, iterate contacts in that order (restricted to those ids) instead of `state.contacts.filter(...)` array order, so the hottest leads are distributed first across SDRs (existing `routeContact` territory/industry/least-loaded rules still apply within that order).
- Keep all existing skip rules (already-assigned, suppressed, priority S).

---

## 8. Build item F — the two owner/manager actions + UI

### F1. Flow A — "Assign now" (existing score)
Add `app/actions.ts` → `assignLeadsNowAction(formData)`:
- `assertPermission(session, "manage_sdr_team")` (Admin/Manager — owner is Admin).
- Optional `sourceJobIds`/audience filter from the form; compute eligible via `partitionLeadsForAssignment({ contacts, requiredFields })` then `assignWorkspaceLeads(state, workspaceId, session.user.id, now, { eligibleContactIds })`.
- Audit `action:"leads_assigned_precampaign"`. `revalidatePath("/", "layout")`.

### F2. Flow B — "Score by engagement & assign"
Add `app/actions.ts` → `scoreAndAssignByCampaignAction(formData)`:
- `assertPermission(session, "manage_sdr_team")` (and the campaign is workspace-scoped).
- `const { orderedContactIds } = applyCampaignEngagementScores(state, workspaceId, campaignId);`
- `assignWorkspaceLeads(state, workspaceId, session.user.id, now, { orderedContactIds: orderedContactIds, eligibleContactIds: new Set(orderedContactIds) });`
- Audit `action:"leads_assigned_by_engagement"`, `newValue:{ campaignId, rescored }`. `revalidatePath`.
- All in **one** `updateState` (no network — engagement reads existing events).

### F3. UI placement
- On `app/outreach/campaigns/page.tsx`, in the campaign row "Action" cell, alongside "Send campaign" add a **"Score & assign by engagement"** submit (form posting `campaignId` to `scoreAndAssignByCampaignAction`). Only show it when the campaign has `sentCount > 0` (results exist).
- Put **"Assign now (current score)"** where lead assignment already lives (the Build List finalize stage / SDR view). If there is an existing assign trigger, reuse it; otherwise add a button calling `assignLeadsNowAction`.
- Both buttons are server-action `<form>`s, same pattern as the existing actions on this page. Gate visibility on `session.permissions.includes("manage_sdr_team")`.

---

## 9. Tests (Vitest, offline, deterministic — no network)

Add/extend under `tests/unit/`:
1. `unsubscribe-token.test.ts` — sign/verify round-trip; tampered payload rejected; tampered signature rejected; wrong-contact mismatch caught; `buildUnsubscribeUrl` shape.
2. `amazon-ses-mime.test.ts` — `buildMimeMessage` includes `From`, `To`, `Subject`, `Reply-To`, `MIME-Version`, `List-Unsubscribe`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, multipart boundary + both base64 parts; CRLF endings.
3. `engagement-scoring.test.ts` — ordering Replied>Clicked>Opened>Delivered>None; campaign-scoped (events from another campaign ignored); suppressed/bounced excluded; `applyCampaignEngagementScores` overwrites `contact.score`/`priority` and ignores the pre-campaign score.
4. `outreach-send.test.ts` — `campaignAudience` locks to `sourceJobIds` and has **no** "first 8" fallback; `isSendEligible` excludes suppressed/no-email/grade D&S; `buildCampaignSendBatch` skips contacts that already have a `Sent` event (idempotent), respects `batchSize`, injects signed unsubscribe URL + physical address + List-Unsubscribe headers; `recordCampaignSendResults` writes `Sent` events with `provider:"Amazon SES"` + messageId and marks the campaign `Completed` when drained. Inject a fake send outcome list (don't call SES).
5. Assignment: extend the existing sdr/assignment test to cover `orderedContactIds` ordering.

Keep the existing `tests/unit/transactional-email.test.ts`, `ses-events.test.ts`, provider/webhook suites green.

---

## 10. Validation + ship

Run, in order, and fix anything red:
```
npm run lint
npm run typecheck
npm test
npm run build
```
(If Vitest reports a flaky cold-transform "0 tests/failed", re-run once — it's a known transform race in this repo.)

Then commit on a feature branch and open + merge a PR (the repo owner has a standing instruction to self-merge finished green work):
- branch e.g. `ses-outreach-phase-b`
- commit message ends with the Co-Authored-By trailer used in this repo's history
- PR body ends with the Claude Code generated-by line

---

## 11. Guardrails / invariants Codex MUST preserve (do not violate)

1. **No provider/network call inside `updateState`/`updateAuthState`.** SES sends happen only in Phase 2 (`sendCampaignBatch`), outside any state mutator.
2. **Live gating unchanged.** Real send only when `SYNCORE_ENABLE_LIVE_PROVIDERS=true` AND an enabled `amazon_ses` connection resolves to `live`; otherwise fall back to `simulateCampaignSend`. Never bypass `resolveProviderExecutionMode`.
3. **Suppression before send.** Every recipient passes `isSendEligible` (no suppressed / DNC / no-email / grade D&S / priority S). Bounces & complaints continue to flow through the existing SES webhook → auto-suppress; do not duplicate that logic.
4. **Audience is strict.** Real sends use `campaignAudience` (job-locked). Never the `campaignContacts` "first 8 unsuppressed" fallback.
5. **Every outreach email carries** a working unsubscribe link in the body **and** `List-Unsubscribe` + `List-Unsubscribe-Post` headers **and** the physical mailing address (CAN-SPAM). The footer is guaranteed by `enforceSequenceStepCompliance`.
6. **Unsubscribe is signed + public.** Token is HMAC-verified; `/unsubscribe/*` and `/api/unsubscribe` are allow-listed in `proxy.ts`; the page must not reveal whether a contact exists for an invalid token.
7. **Idempotent batches.** Re-clicking "Send campaign" never re-sends to a contact that already has a `Sent` event for that campaign.
8. **Flow B discards the pre-campaign score** for the campaign's contacts (engagement-only), and **Flow A keeps it** — they are separate code paths; do not blend them.
9. **No secrets in code, logs, or audit `newValue`.** Read From/Reply-To/address/secret from env; the credential rides the request context exactly as in `provider-live-execution.ts` / `transactional-email-service.ts`.
10. **RBAC:** sending = `manage_outreach`; assignment (both flows) = `manage_sdr_team`. SDRs never see or trigger these.

---

## 12. Reference map (verified symbols this spec builds on)

- Live send pattern: `lib/phase1/transactional-email-service.ts` (`findLiveSesConnection`, `resolveLiveProviderCredential`, `amazonSesSendEmail` call shape).
- Out-of-band 3-phase: `lib/phase1/provider-live-execution.ts` (`planLiveProviderRun` / `invokeLiveProviderAdapter` / `applyLiveProviderRunOutcome`).
- SES adapter: `lib/providers/adapters/amazon-ses.ts` (`SesSendInput`, `amazonSesSendEmail`, currently `Content.Simple`).
- Campaign engine: `lib/phase1/outreach.ts` (`simulateCampaignSend` @317, `createEmailEvent` @99 — hardcodes `provider:"Syncore Mail Local"`, `campaignContacts` @1047 — has the fuzzy fallback @1057, `refreshCampaignMetrics`, `applyEmailEventSideEffects`, `personalize` @1108).
- Compliance: `lib/phase1/compliance.ts` (`enforceSequenceStepCompliance` @126, `appendEmailFooter` @347, `suppressContact` @275, `defaultPhysicalAddress` @33, `defaultUnsubscribeUrl` @34).
- Lead gate / assignment: `lib/phase1/lead-gate.ts` (`partitionLeadsForAssignment`), `lib/phase1/sdr.ts` (`assignWorkspaceLeads` @86 with `options.eligibleContactIds`, `routeContact`, `sdrWorkloads`).
- Scoring (Flow A, unchanged): `lib/phase1/scoring.ts` (`calculateLeadScore` @164).
- Action plumbing: `app/actions.ts` (`updateState`, `assertPermission`, `stringValue`, `splitList`, `appendAudit`, `revalidatePath`, `simulateCampaignSendAction` @1227, write-table sets `outreachCampaignSendWriteTables`, `outreachEmailWriteTables`).
- Unauthenticated cross-workspace mutation + proxy allowlist: `app/api/webhooks/ses/route.ts` (`updateAuthState`, `appendWorkspaceAudit`, `systemActorForWorkspace`), `lib/phase1/auth-routes.ts` (`isSignedWebhookPath`), `proxy.ts`.

---

## 13. Owner-facing follow-ups (NOT code — note in PR description)

- Verify SES sending quota covers the blast; warm up / request a production limit increase if needed.
- Consider a dedicated sending subdomain (e.g. `send.syncoretech.com`) before high-volume cold blasts, to protect the main domain reputation that the SDRs' 1:1 mail also depends on.
- Rotate the Neon DB password (long-standing open item).
- Later phases (separate specs): per-SDR sending identities + SDR self-serve bulk; RingCentral live SMS/voice; inbound reply capture into the CRM.

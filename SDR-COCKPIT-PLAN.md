# SDR Cockpit — Implementation Plan

Recreate the **Syncore CRM — SDR Cockpit** redesign (`design_handoff_sdr_cockpit/`) in the live Next.js app, as close to the prototype as possible, shipped incrementally via the near-zero-downtime deploy flow.

## Fidelity bar & sources of truth
- **Pixels:** `SDR Cockpit.dc.html` (the interactive prototype) is the authority for exact layout, spacing, and states. Render it (self-contained) and screenshot each state as the reference.
- **Spec:** `design_handoff_sdr_cockpit/README.md` — tokens, interactions, keyboard map, implementation mapping.
- **"As close as possible" method:** (1) extract the design tokens into the theme; (2) build with the existing shadcn/Tailwind library, *extended* to the exact tokens (never hand-rolled from scratch, never shadcn-default where the prototype differs); (3) after each screen, **render the built page (local prod standalone build — `next dev` is unusable here) and diff it side-by-side against the prototype screenshot**, iterating on spacing/color deltas. This visual-QA loop is how we hit fidelity.

## Guardrails
- **Scope = CRM only.** Do not touch Lead Gen, Enrichment, Data Quality, Exports, Automation, Compliance admin, Reports, Auth, or User admin.
- **Permissions unchanged** — SDR nav gating stays; no `view_all_records` grants.
- **No new tables for v1.** Activity, Task, Opportunity, Note, CallLog, SdrAssignment, custom fields, suppression all already exist.
- **Calendar/meeting = deferred** (build only the "current truth" panel; the full scheduling flow ships as a permanently-disabled CONCEPT, exactly as the prototype shows).
- **Real data, not the demo set.** The prototype runs on a curated 13-lead sample; the build wires the existing fast read models. This is where the **500-row cap** (the "Sam's leads invisible" bug) gets fixed with real pagination.

## Rollout strategy
- **In-place & incremental.** Each screen is its own PR against the route it maps to, deployed via `redeploy.sh` (near-zero). No parallel route tree to clean up later.
- **Focus is reachable once its core loop works** — earlier PRs land the plumbing; the "Focus" nav item lights up when the call loop is solid.
- **Route/nav mapping:**
  | Design screen | Route |
  |---|---|
  | My Day | `app/sdr/queue/page.tsx` (replace body) |
  | Focus workspace | **new** `app/sdr/focus/page.tsx` |
  | My Contacts | `app/crm/my-contacts/page.tsx` |
  | Accounts | `app/crm/accounts/page.tsx` |
  | Opportunities | `app/crm/opportunities/page.tsx` |
  | Calls | `app/crm/calls/page.tsx` |
  Sidebar becomes the design's two groups (CRM: My Day, Focus · RECORDS: My Contacts, Accounts, Opportunities, Calls) for the SDR role.

## The live-call dock — architecture (the crux, now de-risked)
`SoftphoneEngine` (`components/softphone-button.tsx`) is mounted **once** by `CallProvider` (`components/call/call-provider.tsx`) above the page tree and already owns the WebRTC `sessionRef`, the full state machine (`status`, `seconds`, `muted`, `notes`, `consent`, transfer state), and emits `onStateChange`. The refactor is therefore **presentational, not a telephony rewrite**:
1. **Widen `CallContext`** to expose the full call state + controls (`dial`, `mute`, `sendDtmf`, `toggleRecord`, `hangup`, `loadTransferTargets`, `transfer`, `setNotes`, consent) — promoting what's already in the engine.
2. The engine keeps owning the SIP session (unchanged → live calls still survive navigation); its built-in dialog becomes optional.
3. A new **`components/crm/focus/call-dock.tsx`** renders the pre-call / live-call / wrap-up / success states from that context.
4. Wrap `SoftphoneEngine` in `next/dynamic` (also a review item).

## Phases & PRs

### Phase 0 — Foundation + dock spike *(de-risk before committing)*
- **PR 0.1 — Design tokens.** Reconcile the prototype palette/type/spacing into `app/globals.css` + the Tailwind theme (navy/blue/teal/amber/red, sunken surfaces `#FBFDFE`/`#FAFCFE`, the exact grays, pill/label scales; Manrope already present). Add cockpit-specific utilities.
- **PR 0.2 — Dock spike (SPIKE, may stay behind a flag).** Widen `CallContext`; render a minimal docked call panel driven by real engine state; `next/dynamic` the engine. **Exit criterion: a full call loop (dial → connecting → ringing → connected → mute/DTMF/record → hangup) drives the docked panel, with the engine still mounted once.** If a snag appears, it surfaces here — cheaply — not mid-cockpit.

### Phase 1 — Records pages + peeks *(low-risk, visible wins)*
- **PR 1.1 — Shared record table + peek shell.** The dense bordered table style (uppercase header on `#FAFCFE`, 12.5px rows, badge pills) + the redesigned full-height 440px slide-over peek (fixes the close-×/badge overlap). Extend `components/crm/record-peek.tsx`.
- **PR 1.2 — My Contacts** (`/crm/my-contacts`): new table + filters (All/Call-ready/Replied/Blocked) + contact peek. **Fix the 500-cap here → server-side pagination** (closes the Sam bug).
- **PR 1.3 — Accounts** (`/crm/accounts`): table + "With opportunity" filter + **account peek** (firmographics, open work, Key account fields, contacts-at-account).
- **PR 1.4 — Opportunities** (`/crm/opportunities`): List⇄Board toggle (board = existing `opportunity-board.tsx`) + opportunity peek.
- **PR 1.5 — Calls** (`/crm/calls`): table + Connected/Recorded filters + call peek (reuse `recording-player.tsx`).
- Each peek footer gets **"Open in Focus workspace"** → `/sdr/focus?lead=<id>` (disabled + honest note when the contact isn't in the SDR's queue).

### Phase 2 — Focus workspace *(the core)*
- **PR 2.1 — Focus shell + queue rail** (`app/sdr/focus/page.tsx`): 3-zone layout; queue rail wired to the existing queue read model, URL-driven `?lead=&view=`; keyboard J/K, `/` search, filter chips; selection never resets the list.
- **PR 2.2 — Dossier:** identity header, compliance guardrail band (renders the P0.3 send/call block signals + suppression), pre-call scan strip, tabs (Overview/Activity/Tasks/Opportunities/Details), Call brief with honest "Not captured yet", Company & account, **Key account fields** component (workspace custom fields).
- **PR 2.3 — Dock: pre-call + quick actions** (from Phase 0): Next-best-action, 2×3 quick-action inline panels (email/SMS/note/follow-up/task/log — composing existing actions), Open work, Call-readiness checklist.
- **PR 2.4 — Dock: live call + transfer** — the docked call strip from the spike, full-height live-call notes with quick-prompt chips, transfer panel.
- **PR 2.5 — Unified wrap-up** — new **`saveCallWrapupAction`** in `app/actions.ts` composing `logSoftphoneCallAction` + `logFirstTouchAction` + optional `createTaskAction`/`createOpportunityAction`/`createNoteAction`, returning **per-step results** for the partial-failure UI. Outcome chips + side-effects, follow-up presets, +Task/+Opportunity, Meeting-booked honesty panel, **Save & next lead** (⌘↵) + success checklist + auto-advance.

### Phase 3 — My Day + shell
- **PR 3.1 — My Day** (`/sdr/queue` body): eyebrow/title/date + **Start calling**, the single 4-cell counter strip, grouped work queue, right rail (follow-ups/replies/progress). Data from the queue snapshot + reminder read models.
- **PR 3.2 — Shell + session bar:** the design's sidebar groups, auto-collapse on entering Focus, session chip/bar (client-side session concept over queue order; optional localStorage persist).

### Phase 4 — States, fidelity & a11y pass
- **PR 4.x — Required states** as variants: loading skeletons, empty queue, no-phone, invalid-phone, DNC/suppressed/no-basis, connecting/ringing/connected, muted, recording, transfer loading/sent/failed, no-answer, call-failed, notes draft/saving/saved, wrap-up saving, **partial save failure** (what saved + what failed + Retry), success, no-next-lead.
- **PR 4.y — Fidelity + a11y sweep:** side-by-side vs prototype for every screen; focus-visible/keyboard/contrast (WCAG-AA) pass.

## Verification per phase
- Every PR: `tsc` + unit/integration lanes + `next build`, **plus the visual diff** vs the prototype screenshot for the touched screen.
- New logic (wrap-up composer, pagination, dock state) gets unit/integration tests (e.g., `saveCallWrapupAction` partial-failure; my-contacts pagination returns older leads).
- New e2e where high-value (the call loop, wrap-up → next lead).

## Effort (honest)
Multi-week. Rough order of magnitude: Phase 0 ~2–3 days · Phase 1 ~1 week · Phase 2 ~1.5–2 weeks (the bulk) · Phase 3 ~3–4 days · Phase 4 ~3–5 days. Phase 0's spike gates the rest.

## Decisions needed from you
1. **Route mapping** above — confirm My Day replaces `/sdr/queue` and Focus is a new `/sdr/focus`.
2. **Audience:** apply the Records-page redesign on those routes for **everyone who can see them** (role scoping unchanged), with My Day + Focus as the SDR flow? (Manager-only all-records pages like `/crm/contacts` + `/sdr/manager` stay out of v1 scope.)
3. **Start point:** begin with **Phase 0 (tokens + dock spike)** — recommended, since the spike gates everything.

## First step
Phase 0: extract the tokens (PR 0.1) and run the **dock spike** (PR 0.2). If the spike proves the call loop drives a docked panel, we proceed to Phase 1; if it surfaces a telephony snag, we've found it for ~2 days of cost, not mid-build.

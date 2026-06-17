# SDR Guide — Syncore CRM

Last updated: 2026-06-17

A practical guide to everything an SDR can do in the Syncore CRM: the daily flow, every surface, every action, and the rules that drive the work.

> **Note on the current build:** every workflow below is fully wired, but outreach *sending* (email/SMS/calls) is **simulated** today — providers like Smartlead and RingCentral are local placeholders, and engagement events can be captured manually. Real provider sending arrives in a later phase. This does not change how you work day to day.

---

## 1. Your access

You sign in at `/login` and land on the **CRM workspace** (`/crm`). Your role grants: `view_records`, `manage_crm`, `manage_sdr`, `send_direct_outreach`.

**SDRs do not run campaigns. SDRs only perform individual one-to-one outreach to assigned contacts.**

**You see your own book of business.** Across the CRM lists, dashboard, and detail pages you see only the accounts, contacts, and opportunities **assigned to you**. Opening a record that isn't yours by URL returns "not found." Managers and admins additionally hold `view_all_records` — the grant that unlocks the whole-team view; SDRs intentionally do not have it.

**What you can do:** work your assigned leads, log touches and activities, manage tasks/notes/calls, build and advance opportunities, and run outreach campaigns and event tracking.

**What you cannot do** (reserved for other roles):
- Lead engine — search profiles, lead jobs, data staging, enrichment, exports.
- Developer area — integrations/providers, admin reports, AI automation, user access.
- Edit compliance — you can *see* a contact's lawful basis / consent / do-not-contact, but editing requires a Compliance role.
- Team management — the SDR manager dashboard and team-wide assignment routing (the "Run assignment" trigger, reassignment, routing rules) are manager/admin only (`manage_sdr_team`).
- Campaigns & outreach settings — building campaigns/sequences/steps, simulating sends, provider pause/resume, sending domains/mailboxes, and templates/scripts are manager/admin only (`manage_outreach`).

---

## 2. The daily flow (quick start)

1. **CRM Dashboard (`/crm`)** — scan "My active leads," what's due today, and what's overdue.
2. **SDR Queue (`/sdr/queue`)** — work in this order: **Overdue → My P1 Leads → Due Today**. The queue is pre-sorted by urgency.
3. **Open the contact** — check the snapshot (grade, channels, fit) and the **compliance guardrails**. Skip anyone marked do-not-contact or without a lawful basis.
4. **Reach out** on the recommended channel (email for A/B grades, call when a phone exists), using the sequence's templates/scripts.
5. **Log the touch** (in the queue): channel + outcome + follow-up date. This advances the lead, resets the SLA clock, and **auto-creates your next reminder and task**.
6. **Track engagement** (`/outreach/events`) — replies and positive calls surface for follow-up; bounces/unsubscribes/opt-outs auto-suppress.
7. **Convert** — create an opportunity for interested leads and move it through the pipeline; book meetings.
8. **Close the day** — complete reminders and tasks. Anything missed rolls into Overdue tomorrow; SLA breaches may trigger a manager reassignment.

---

## 3. Surfaces, one by one

### CRM Dashboard — `/crm`
Your morning briefing, scoped to you.
- Stat cards: My active leads (+ P1), Due today (+ overdue), Open pipeline (+ weighted forecast), accounts/contacts counts.
- Panels: Priority SDR work, Pipeline snapshot, Account watchlist, Outreach lanes (email/call-ready, active campaigns).
- Shortcut cards to queue, accounts, contacts, pipeline, and campaigns.

### SDR Queue — `/sdr/queue` *(home base)*
Titled "My SDR queue," filtered to your assignments.
- Metrics: Assigned, P1, Due today, Overdue.
- Eight queue views: **My P1 Leads, Due Today, Overdue, Recently Replied, Call-First Leads, Email-Ready Leads, Meeting Follow-Up, Nurture Leads**.
- Priority work table (sorted overdue → P1 → due date → channel), each row links to the contact.
- **Log touch** form (the core action).
- Follow-up reminders with one-click **Complete**.
- Full assignment directory. *(The **Run assignment** routing trigger is manager-only.)*

### Contacts — list `/crm/contacts`, profile `/crm/contacts/[id]`
The **list** is your contact directory: grade, channel readiness (email/phone), score, status, owner, last activity.

The **profile** is where most work happens:
- **Snapshot:** account, email, phone, owner, seniority, department, enrichment coverage, fit reason, compliance state.
- **Current work:** contact tasks with Complete.
- **Related opportunities:** inline stage-change dropdowns.
- **Timeline:** every note, call, task, status change, and opportunity update (actor + timestamp).
- **Add contact work:** create a task or opportunity.
- **Log activity:** add a note, or log a call (phone, outcome, minutes, notes).
- **Send 1:1 email / SMS:** individual outreach to this assigned contact, logged on the timeline.
- **Guardrails:** lawful basis / consent / do-not-contact (read-only for SDRs).
- **Custom fields:** set values on contact-specific fields.

### Accounts — list `/crm/accounts`, detail `/crm/accounts/[id]`
The **list** shows your accounts with owner, stage, contact count, open work, pipeline value, and source, plus a watchlist and stage overview.
The **detail page** is the account-level workspace: firmographics, all linked contacts, opportunities, tasks, notes, call logs, a full activity timeline, and custom fields — with the same create forms.

### Opportunities — `/crm/opportunities`
Your pipeline: open pipeline, weighted forecast, proposal/won counts; a **kanban stage board** (Prospecting → Qualified → Discovery → Proposal → Closed won/lost) to drag deals through; a create-opportunity form; custom forecast fields; and the full opportunity directory. Probability auto-maps to stage.

### Outreach Campaigns — `/outreach/campaigns` *(manager/admin only — not SDR access)*
Gated by `manage_outreach`, which SDRs do not have. Managers/admins build and run cold outreach here: campaign creation (Email/SMS/Call/Multichannel), sequence + step builders, simulated sends, provider readiness (SPF/DKIM/DMARC/TLS, daily limits, pause/resume), sending domains/mailboxes, and templates/scripts. SDRs cannot open it.

### Outreach Events — `/outreach/events`
Your outreach activity monitor, **scoped to your assigned contacts only**:
- **Response stream:** replies and positive call outcomes (for your contacts) to follow up.
- **Deliverability stops:** bounces, unsubscribes, complaints, and SMS opt-outs on your contacts (these auto-suppress the contact).
- Combined event stream, SMS events, and call recordings — all filtered to your contacts.
- Webhook receipts and bulk/manual event capture are manager-only and hidden from SDRs.

### SDR Manager Dashboard — `/sdr/manager` *(manager/admin only — not SDR access)*
Gated by `manage_sdr_team`, which SDRs do not have. For managers: team workload by rep, SLA adherence, untouched P1s, overdue counts, routing coverage (territory/industry pods), reassignment recommendations, manual reassignment, and reassignment rules. Listed here for context — SDRs cannot open it.

---

## 4. What you can do (action reference)

**Work assignments**
- **Log a touch:** channel (Email / Call / SMS / LinkedIn / Meeting) + outcome + follow-up due. This advances the lead's status, recalculates the SLA, auto-creates the next reminder and task, and writes the timeline.
- Complete follow-up reminders.
- *(Running team-wide assignment routing is a manager action — see below.)*

**CRM records**
- Create and complete tasks; add notes; log calls.
- Create opportunities and move them through stages.
- Set custom-field values and create custom fields.

**Outreach (1:1 only, for assigned contacts)**
- Send an individual email or SMS, and log/record an individual call.
- Record reply/outcome and set a follow-up — from `/sdr/queue` (Log touch) and the contact profile.
- You **cannot** create campaigns/sequences/steps, simulate sends, or change providers/domains/templates (manager/admin only).

**View (read-only)**
- Contact compliance guardrails, account context.

---

## 5. Lead lifecycle & SLA

**Statuses:** New → Assigned → Working → Contacted → Opened → Replied → Interested → Meeting Booked → Qualified → Proposal Sent → Won / Lost (plus Nurture, Disqualified, Invalid, Unsubscribed, Suppressed).

**SLA timers (the engine that drives your queue):**
- **First-touch deadline by priority:** P1 ≈ within 1 hour, P2 ≈ same business day, P3 ≈ within 3 days.
- **Follow-up deadlines by status** (e.g., a reply needs a fast next touch; a booked meeting a next-day step).
- Live badges: **On track / Due soon / Overdue** (and Paused / No SLA).

Logging a touch resets these timers and schedules the next action automatically. Overdue work surfaces in your queue and on the manager dashboard, where it may be recommended for reassignment.

**Assignment routing** uses methods like round-robin, weighted, territory-based, industry-based, lead-score-based, capacity-based, account ownership, team-based, and timezone/language.

---

## 6. Compliance guardrails (read before you reach out)

- Each contact carries a **lawful basis**, **consent status**, **consent source**, and a **do-not-contact** flag. SDRs see these but cannot edit them.
- **Never contact** a record flagged do-not-contact or lacking a lawful basis.
- **Automatic suppression:** hard bounces, unsubscribes, spam complaints, and SMS opt-outs immediately suppress a contact — they are blocked from future outreach, assignment, and export. You do not need to act on these manually.
- Outreach sequence steps enforce an unsubscribe footer and physical address for email compliance.

---

## 7. Quick reference

| I want to… | Go to |
|---|---|
| See what's urgent today | `/crm` then `/sdr/queue` |
| Work a lead and log the outcome | `/sdr/queue` → Log touch |
| Review a person before reaching out | `/crm/contacts/[id]` |
| Add a note / log a call | Contact profile → Log activity |
| Create or advance a deal | `/crm/opportunities` or the contact profile |
| Build/run a sequence | `/outreach/campaigns` |
| Check replies, bounces, recordings | `/outreach/events` |
| See company context | `/crm/accounts/[id]` |

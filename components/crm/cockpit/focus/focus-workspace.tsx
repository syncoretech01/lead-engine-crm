"use client";

import * as React from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { completeSdrCallingSessionAction, ensureSdrCallingSessionAction } from "@/app/actions";
import { useCall } from "@/components/call/call-context";
import { CoPill } from "@/components/crm/cockpit/co-table";
import { ContactDossier } from "@/components/crm/cockpit/contact-dossier";
import { FocusDock } from "@/components/crm/cockpit/focus/focus-dock";
import { SessionBar } from "@/components/crm/cockpit/focus/session-bar";
import { useFocusSession, type WrapupSummary } from "@/components/crm/cockpit/focus/use-focus-session";
import {
  leadBlockReason,
  leadCallTarget,
  priorityTone,
  resolveFocusSelectedLead,
  retainFocusCallLead,
  type FocusLead
} from "@/components/crm/cockpit/focus/focus-types";
import { allowsFocusKeyboardShortcut } from "@/lib/focus-keyboard-shortcuts";
import type { SdrCallingSession } from "@/lib/phase1/types";

export type { FocusLead };

// Focus workspace (SDR Cockpit) — the 3-zone calling surface: queue rail + lead
// dossier + execution dock (live call → wrap-up → Save & next). Selection and
// queue view are URL-driven (?lead=&view=) so refresh/deep-links preserve position.

const VIEWS = [
  { id: "all", label: "All active" },
  { id: "p1", label: "My P1 Leads" },
  { id: "due", label: "Due Today" },
  { id: "overdue", label: "Overdue" },
  { id: "replied", label: "Recently Replied" },
  { id: "call", label: "Call-First Leads" },
  { id: "meeting", label: "Meeting Follow-Up" },
  { id: "nurture", label: "Nurture Leads" }
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

const CHIPS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "callready", label: "Call-ready" }
] as const;
type ChipId = (typeof CHIPS)[number]["id"];

function matchesView(lead: FocusLead, view: ViewId): boolean {
  switch (view) {
    case "p1":
      return lead.priority === "P1";
    case "due":
      // Match My Day's "Due today" (the current due date falls on today), not
      // just "due within 2h / overdue" — so P2 leads due later today still show.
      return lead.dueToday;
    case "overdue":
      return lead.overdue;
    case "replied":
      return lead.status === "Replied";
    case "call":
      return lead.hasPhone;
    case "meeting":
      return lead.status === "Meeting Booked";
    case "nurture":
      return lead.status === "Nurture";
    default:
      return true;
  }
}

// Queue weight: overdue first (soonest due), then P1, then by due time.
function queueSort(a: FocusLead, b: FocusLead): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const pa = a.priority === "P1" ? 0 : 1;
  const pb = b.priority === "P1" ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return a.dueAtMs - b.dueAtMs;
}

export function FocusWorkspace({
  leads,
  initialLeadId,
  initialView,
  callerLabel = null,
  lineBlockReason = null,
  autoStart = false,
  dailyCallPlan
}: {
  leads: FocusLead[];
  initialLeadId?: string;
  initialView?: string;
  callerLabel?: string | null;
  lineBlockReason?: string | null;
  autoStart?: boolean;
  dailyCallPlan?: {
    target: number;
    completedToday: number;
    remainingToday: number;
    pass: 1 | 2 | null;
    activeBatchSize: number;
    batchRemaining: number;
  };
}) {
  const { openCallInline, call } = useCall();
  const session = useFocusSession();
  const [view, setView] = React.useState<ViewId>(
    VIEWS.some((v) => v.id === initialView) ? (initialView as ViewId) : "all"
  );
  const [chip, setChip] = React.useState<ChipId>("all");
  const [query, setQuery] = React.useState("");
  const [completedIds, setCompletedIds] = React.useState<Set<string>>(() => new Set());
  const [endingSession, setEndingSession] = React.useState(false);
  const [endedReport, setEndedReport] = React.useState<SdrCallingSession | null>(null);
  const [retainedCallLead, setRetainedCallLead] = React.useState<FocusLead | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...leads]
      .filter((lead) => matchesView(lead, view))
      .filter((lead) => (chip === "callready" ? lead.hasPhone : true))
      .filter((lead) => (chip === "open" ? lead.status !== "Meeting Booked" && lead.status !== "Suppressed" : true))
      .filter((lead) => (!q ? true : `${lead.name} ${lead.companyName}`.toLowerCase().includes(q)))
      .sort(queueSort);
  }, [leads, view, chip, query]);

  const [selectedId, setSelectedId] = React.useState<string>(
    initialLeadId && leads.some((l) => l.id === initialLeadId) ? initialLeadId : list[0]?.id ?? leads[0]?.id ?? ""
  );

  // Keep the selection valid + synced to the URL (deep-linkable ?lead=&view=).
  React.useEffect(() => {
    if (!selectedId || !leads.some((l) => l.id === selectedId)) return;
    const params = new URLSearchParams(window.location.search);
    params.set("lead", selectedId);
    params.set("view", view);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [selectedId, view, leads]);

  const callOwnsFocus = call.surface === "dock" && call.status !== "idle";
  const callLead = retainFocusCallLead(retainedCallLead, leads, call.contactId, callOwnsFocus);

  // A queue refresh can move a just-called contact out of the active batch. Keep
  // its dossier selected until the SDR explicitly advances or selects another.
  const selected = resolveFocusSelectedLead(callLead, retainedCallLead, leads, selectedId, list);
  const indexInList = list.findIndex((l) => l.id === selectedId);

  const move = React.useCallback(
    (delta: number) => {
      if (list.length === 0) return;
      const base = indexInList < 0 ? 0 : indexInList;
      const next = Math.min(list.length - 1, Math.max(0, base + delta));
      setSelectedId(list[next].id);
    },
    [list, indexInList]
  );

  // Advance to the next not-yet-completed lead (Save & next / auto-advance).
  const advance = React.useCallback(() => {
    if (list.length === 0) return;
    const start = indexInList < 0 ? -1 : indexInList;
    for (let i = start + 1; i < list.length; i += 1) {
      if (!completedIds.has(list[i].id)) {
        setRetainedCallLead(null);
        setSelectedId(list[i].id);
        return;
      }
    }
    for (let i = 0; i <= start; i += 1) {
      if (!completedIds.has(list[i].id)) {
        setRetainedCallLead(null);
        setSelectedId(list[i].id);
        return;
      }
    }
  }, [list, indexInList, completedIds]);

  const { recordComplete, start: startSession, active: sessionActive } = session;
  const onComplete = React.useCallback(
    (leadId: string, summary: WrapupSummary) => {
      setCompletedIds((current) => {
        const next = new Set(current);
        next.add(leadId);
        return next;
      });
      recordComplete(leadId, summary);
    },
    [recordComplete]
  );

  // Begin a session when the SDR arrives via "Start calling" (autoStart) or places
  // their first live call. The session is a client-side concept (localStorage).
  const queueTotal = leads.length;
  React.useEffect(() => {
    if (autoStart) startSession(queueTotal);
  }, [autoStart, startSession, queueTotal]);
  const callActive = call.status === "connecting" || call.status === "ringing" || call.status === "in-call";
  React.useEffect(() => {
    if (callActive && !sessionActive) startSession(queueTotal);
  }, [callActive, sessionActive, startSession, queueTotal]);

  React.useEffect(() => {
    if (!session.active || !session.id || !session.startedAt) return;
    void ensureSdrCallingSessionAction({ sessionId: session.id, startedAt: session.startedAt }).then((result) => {
      if (!result.ok) toast.error(result.error);
    });
  }, [session.active, session.id, session.startedAt]);

  const endSession = React.useCallback(async () => {
    if (endingSession || !session.id || !session.startedAt) return;
    setEndingSession(true);
    const result = await completeSdrCallingSessionAction({
      sessionId: session.id,
      startedAt: session.startedAt,
      activeDurationSeconds: Math.floor(session.elapsedMs / 1000)
    });
    setEndingSession(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    session.end();
    setEndedReport(result.report);
    toast.success("Session report saved.");
  }, [endingSession, session]);

  const startCall = React.useCallback(
    (lead: FocusLead) => {
      if (leadBlockReason(lead, lineBlockReason)) return;
      setRetainedCallLead(lead);
      openCallInline(leadCallTarget(lead, callerLabel, lineBlockReason));
    },
    [callerLabel, lineBlockReason, openCallInline]
  );

  const callSelected = React.useCallback(() => {
    if (selected) startCall(selected);
  }, [selected, startCall]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never reinterpret browser/OS shortcuts such as Ctrl+C or Cmd+C as the
      // bare `C` = Call shortcut. Active text selection also wins over every
      // single-key Focus shortcut so users can copy record details safely.
      if (!allowsFocusKeyboardShortcut(event)) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (window.getSelection()?.isCollapsed === false) return;
      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (key === "j") {
        event.preventDefault();
        move(1);
      } else if (key === "k") {
        event.preventDefault();
        move(-1);
      } else if (key === "c") {
        event.preventDefault();
        callSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, callSelected]);

  const selectedBlock = selected ? leadBlockReason(selected, lineBlockReason) : "No lead";
  // Is there another not-yet-completed lead to advance to after the current call?
  const hasNext = list.some((lead) => lead.id !== call.contactId && !completedIds.has(lead.id));

  return (
    <div className="cockpit flex h-full min-h-0 w-full flex-col overflow-hidden bg-co-page">
      {session.active ? (
        <SessionBar
          session={session}
          position={indexInList < 0 ? 1 : indexInList + 1}
          total={list.length}
          onEnd={() => void endSession()}
          ending={endingSession}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ───────────── Queue rail ───────────── */}
      <aside className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-r border-co-border bg-co-surface [@media(max-width:1380px)]:w-[264px]">
        <div className="flex flex-col gap-2 border-b border-co-border p-3">
          {dailyCallPlan ? (
            <div className="flex items-center justify-between rounded-md border border-co-border bg-co-sunken-2 px-2.5 py-2 text-[11px]">
              <span className="font-extrabold text-co-ink">
                Daily calls {dailyCallPlan.completedToday}/{dailyCallPlan.target}
              </span>
              <span className="font-bold text-co-text-3">
                {dailyCallPlan.pass ? `Pass ${dailyCallPlan.pass}` : "Batch complete"}
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <select
              value={view}
              onChange={(event) => setView(event.target.value as ViewId)}
              className="h-8 flex-1 rounded-md border border-co-control bg-co-surface px-2 text-[12px] font-semibold text-co-ink"
            >
              {VIEWS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] font-bold text-co-muted-2">{list.length}</span>
          </div>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search queue…  ( / )"
            aria-label="Search queue"
            className="h-8 w-full rounded-md border border-co-control bg-co-surface px-2.5 text-[12px] text-co-ink placeholder:text-co-muted-2"
          />
          <div className="flex items-center gap-1.5">
            {CHIPS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setChip(option.id)}
                aria-pressed={chip === option.id}
                className={`h-7 rounded-full px-2.5 text-[11px] font-bold transition-colors ${
                  chip === option.id
                    ? "bg-co-blue text-white"
                    : "border border-co-control bg-co-surface text-co-text-3 hover:bg-co-sunken"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {list.map((lead) => {
            const active = lead.id === selectedId;
            const done = completedIds.has(lead.id);
            return (
              <button
                key={lead.id}
                type="button"
                onClick={() => setSelectedId(lead.id)}
                className={`flex w-full flex-col gap-1 border-b border-co-divider px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-co-accent-bg" : "hover:bg-co-sunken"
                } ${done ? "opacity-55" : ""}`}
                style={active ? { boxShadow: "inset 3px 0 0 var(--co-blue)" } : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`flex items-center gap-1 truncate text-[12.5px] font-extrabold ${done ? "text-co-muted" : "text-co-ink"}`}>
                    {done ? <Check className="size-3.5 shrink-0 text-co-teal" aria-hidden="true" /> : null}
                    {lead.name}
                  </span>
                  <CoPill tone={priorityTone(lead.priority)}>{lead.priority}</CoPill>
                </div>
                <span className="truncate text-[11px] text-co-muted-2">{lead.companyName}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-co-text-3">{lead.dueLabel}</span>
                  {!lead.hasPhone ? <span className="text-[10.5px] font-bold text-co-red-text">No phone</span> : null}
                </div>
              </button>
            );
          })}
          {list.length === 0 ? (
            <div className="px-3 py-10 text-center text-[12px] text-co-muted">
              {dailyCallPlan?.remainingToday === 0
                ? `Daily target complete — ${dailyCallPlan.target} calls logged.`
                : dailyCallPlan?.pass === null
                  ? "This two-pass batch is complete. Fresh leads will appear when available."
                  : "No leads in this view."}
            </div>
          ) : null}
        </div>

        <div className="border-t border-co-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-co-text-3">
              Lead {indexInList < 0 ? 1 : indexInList + 1} of {list.length}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => move(-1)}
                className="h-7 rounded-md border border-co-control bg-co-surface px-2 text-[11px] font-bold text-co-text-3 hover:bg-co-sunken"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                className="h-7 rounded-md border border-co-control bg-co-surface px-2 text-[11px] font-bold text-co-text-3 hover:bg-co-sunken"
              >
                Next
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-[10px] text-co-muted-2">/ search · J/K next/prev · C call</p>
        </div>
      </aside>

      {/* ───────────── Dossier ───────────── */}
      <main className="min-h-0 flex-1 overflow-y-auto bg-co-surface">
        {selected ? (
          <ContactDossier lead={selected} onCall={callSelected} callBlocked={selectedBlock} />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-co-muted">
            Select a lead from the queue.
          </div>
        )}
      </main>

      {/* ───────────── Execution dock ───────────── */}
      <aside className="hidden min-h-0 w-[388px] shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-co-border bg-co-sunken xl:flex [@media(max-width:1380px)]:w-[360px] [@media(max-width:1200px)]:w-[332px]">
        <FocusDock
          selected={selected}
          callLead={callLead}
          callerLabel={callerLabel}
          lineBlockReason={lineBlockReason}
          hasNext={hasNext}
          onStartCall={startCall}
          onAdvance={advance}
          onComplete={onComplete}
          callingSession={session.active ? { id: session.id, startedAt: session.startedAt } : undefined}
        />
      </aside>
      </div>
      {endedReport ? <SessionReportDialog report={endedReport} onClose={() => setEndedReport(null)} /> : null}
    </div>
  );
}

function SessionReportDialog({ report, onClose }: { report: SdrCallingSession; onClose: () => void }) {
  const metrics = [
    ["Total calls", report.totalCalls],
    ["Connected", report.connectedCalls],
    ["Voicemail", report.voicemailCalls],
    ["Unanswered", report.unansweredCalls],
    ["Suppressed", report.suppressedContacts],
    ["Follow-ups", report.followUpContacts]
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-labelledby="session-report-title">
      <div className="w-full max-w-xl rounded-2xl border border-co-border bg-co-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-co-teal-text">Session complete</div>
            <h2 id="session-report-title" className="mt-1 text-xl font-extrabold text-co-ink">Calling session report</h2>
            <p className="mt-1 text-[12px] text-co-muted">Saved permanently in Session History.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close report" className="rounded-md p-1 text-co-muted hover:bg-co-sunken hover:text-co-ink">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-co-border bg-co-sunken-2 px-3 py-3">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-co-muted">{label}</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-co-ink">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-co-teal-border bg-co-teal-bg px-4 py-3">
          <span className="text-[12px] font-bold text-co-teal-text">Total talk time</span>
          <span className="font-mono text-lg font-extrabold tabular-nums text-co-teal-text">{formatReportDuration(report.totalTalkTimeSeconds)}</span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-co-control bg-co-surface px-4 text-[12px] font-bold text-co-text-3 hover:bg-co-sunken">
            Close
          </button>
          <Link href="/sdr/sessions" className="flex h-9 items-center rounded-lg bg-co-blue px-4 text-[12px] font-bold text-white hover:bg-co-blue-hover">
            View session history
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatReportDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

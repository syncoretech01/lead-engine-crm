"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Phone } from "lucide-react";

import { useCall } from "@/components/call/call-context";
import { CoPill } from "@/components/crm/cockpit/co-table";
import { FocusDock } from "@/components/crm/cockpit/focus/focus-dock";
import { SessionBar } from "@/components/crm/cockpit/focus/session-bar";
import { useFocusSession, type WrapupSummary } from "@/components/crm/cockpit/focus/use-focus-session";
import {
  initials,
  leadBlockReason,
  leadCallTarget,
  leadCompliance,
  priorityTone,
  recommendedAction,
  slaTone,
  statusTone,
  type FocusLead,
  type FocusTimelineItem,
  type LeadCompliance
} from "@/components/crm/cockpit/focus/focus-types";

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
      return lead.slaStatus === "Due soon" || lead.overdue;
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
  autoStart = false
}: {
  leads: FocusLead[];
  initialLeadId?: string;
  initialView?: string;
  callerLabel?: string | null;
  lineBlockReason?: string | null;
  autoStart?: boolean;
}) {
  const { openCallInline, call } = useCall();
  const session = useFocusSession();
  const [view, setView] = React.useState<ViewId>(
    VIEWS.some((v) => v.id === initialView) ? (initialView as ViewId) : "all"
  );
  const [chip, setChip] = React.useState<ChipId>("all");
  const [query, setQuery] = React.useState("");
  const [completedIds, setCompletedIds] = React.useState<Set<string>>(() => new Set());
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

  const selected = leads.find((l) => l.id === selectedId) ?? list[0] ?? null;
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
        setSelectedId(list[i].id);
        return;
      }
    }
    for (let i = 0; i <= start; i += 1) {
      if (!completedIds.has(list[i].id)) {
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

  const callSelected = React.useCallback(() => {
    if (!selected) return;
    openCallInline(leadCallTarget(selected, callerLabel, lineBlockReason));
  }, [selected, callerLabel, lineBlockReason, openCallInline]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
    <div className="cockpit flex h-[calc(100vh-3.5rem)] min-h-[560px] w-full flex-col overflow-hidden bg-co-page">
      {session.active ? (
        <SessionBar session={session} position={indexInList < 0 ? 1 : indexInList + 1} total={list.length} />
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ───────────── Queue rail ───────────── */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-co-border bg-white [@media(max-width:1380px)]:w-[264px]">
        <div className="flex flex-col gap-2 border-b border-co-border p-3">
          <div className="flex items-center gap-2">
            <select
              value={view}
              onChange={(event) => setView(event.target.value as ViewId)}
              className="h-8 flex-1 rounded-md border border-co-control bg-white px-2 text-[12px] font-semibold text-co-ink"
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
            className="h-8 w-full rounded-md border border-co-control bg-white px-2.5 text-[12px] text-co-ink placeholder:text-co-muted-2"
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
                    : "border border-co-control bg-white text-co-text-3 hover:bg-co-sunken"
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
                  active ? "bg-[#eaf3ff]" : "hover:bg-co-sunken"
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
                  <CoPill tone={slaTone(lead.slaStatus)}>{lead.slaStatus}</CoPill>
                  <span className="text-[10.5px] text-co-text-3">{lead.dueLabel}</span>
                  {!lead.hasPhone ? <span className="text-[10.5px] font-bold text-co-red-text">No phone</span> : null}
                </div>
              </button>
            );
          })}
          {list.length === 0 ? (
            <div className="px-3 py-10 text-center text-[12px] text-co-muted">No leads in this view.</div>
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
                className="h-7 rounded-md border border-co-control bg-white px-2 text-[11px] font-bold text-co-text-3 hover:bg-co-sunken"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                className="h-7 rounded-md border border-co-control bg-white px-2 text-[11px] font-bold text-co-text-3 hover:bg-co-sunken"
              >
                Next
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-[10px] text-co-muted-2">/ search · J/K next/prev · C call</p>
        </div>
      </aside>

      {/* ───────────── Dossier ───────────── */}
      <main className="flex-1 overflow-y-auto bg-white">
        {selected ? (
          <div className="mx-auto max-w-[900px] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#eaf3ff] text-[15px] font-extrabold text-co-blue">
                  {initials(selected.name)}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-[17.5px] font-extrabold text-co-ink">{selected.name}</h1>
                    <CoPill tone={statusTone(selected.status)}>{selected.status}</CoPill>
                    <CoPill tone={priorityTone(selected.priority)}>{selected.priority}</CoPill>
                    {selected.grade ? <CoPill tone="neutral">Grade {selected.grade}</CoPill> : null}
                    <CoPill tone={slaTone(selected.slaStatus)}>SLA {selected.slaStatus}</CoPill>
                  </div>
                  <p className="mt-1 text-[12.5px] text-co-text-3">
                    {[selected.title, selected.companyName, selected.companyDomain].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-co-text-2">
                    {selected.hasPhone ? <span>{selected.phone}</span> : <span className="text-co-red-text">No phone</span>}
                    {selected.email ? <span>{selected.email}</span> : null}
                    {selected.companyLocation ? <span>{selected.companyLocation}</span> : null}
                    {selected.localTimeLabel ? (
                      <span className={selected.outsideWindow ? "font-semibold text-co-amber-text" : ""}>
                        {selected.localTimeLabel}
                        {selected.outsideWindow ? " · outside calling window" : ""}
                      </span>
                    ) : null}
                    <span className="text-co-muted-2">Owner · {selected.owner}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={callSelected}
                disabled={Boolean(selectedBlock)}
                title={selectedBlock || `Call ${selected.name}`}
                className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-co-blue px-4 text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:cursor-not-allowed disabled:bg-[#dce5ee] disabled:text-co-muted-2"
              >
                <Phone className="size-4" aria-hidden="true" />
                Call
              </button>
            </div>

            <ComplianceBand compliance={leadCompliance(selected)} />

            {/* Pre-call scan strip — the three things to know before dialing. */}
            <div className="mt-4 grid grid-cols-1 divide-y divide-co-divider overflow-hidden rounded-[9px] border border-co-border bg-co-sunken-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <ScanCell label="Recommended action" value={recommendedAction(selected, Boolean(selectedBlock))} tone="blue" />
              <ScanCell label="Next follow-up" value={selected.dueLabel} tone={selected.overdue ? "red" : "ink"} />
              <ScanCell
                label="Opportunity"
                value={selected.openOpportunity || "None yet — create in wrap-up"}
                tone={selected.openOpportunity ? "teal" : "muted"}
              />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-2">
              <section>
                <h2 className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Call brief</h2>
                <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
                  <Row label="Fit reason" value={selected.fitReason} />
                  <Row label="Talking point" value="" accent />
                  <Row label="Last interaction" value={selected.lastTouchLabel} />
                  <Row label="Pain point" value="" />
                  <Row label="Objection" value="" />
                  <Row label="Decision maker" value="" />
                  <Row label="Expected next step" value="" />
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <h2 className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
                    Recent engagement
                  </h2>
                  <Link
                    href={`/crm/contacts/${selected.id}`}
                    className="text-[11px] font-semibold text-co-blue hover:underline"
                  >
                    View all activity
                  </Link>
                </div>
                <div className="mt-2 rounded-[10px] border border-co-border bg-co-sunken p-3.5">
                  {selected.timeline.length ? (
                    selected.timeline.map((item) => <TimelineRow key={item.id} item={item} />)
                  ) : (
                    <p className="text-[12px] italic text-co-muted-2">No recent activity yet.</p>
                  )}
                </div>
              </section>
              <section>
                <h2 className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
                  Company &amp; account
                </h2>
                <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
                  <Row label="Industry" value={selected.companyIndustry} />
                  <Row label="Location" value={selected.companyLocation} />
                  <Row label="Company size" value="" />
                  <Row label="Account stage" value="" />
                  <Row label="Account owner" value={selected.owner} />
                  <Row label="Open opportunity" value={selected.openOpportunity} />
                  <Row label="Open work" value={selected.openWork} />
                </div>
                <Link
                  href={`/crm/contacts/${selected.id}`}
                  className="mt-2 inline-block text-[12px] font-semibold text-co-blue hover:underline"
                >
                  Open full record →
                </Link>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-co-muted">
            Select a lead from the queue.
          </div>
        )}
      </main>

      {/* ───────────── Execution dock ───────────── */}
      <aside className="hidden w-[388px] shrink-0 flex-col border-l border-co-border bg-co-sunken xl:flex [@media(max-width:1380px)]:w-[360px] [@media(max-width:1200px)]:w-[332px]">
        <FocusDock
          selected={selected}
          leads={leads}
          callerLabel={callerLabel}
          lineBlockReason={lineBlockReason}
          hasNext={hasNext}
          onAdvance={advance}
          onComplete={onComplete}
        />
      </aside>
      </div>
    </div>
  );
}

const bandTone: Record<LeadCompliance["tone"], string> = {
  teal: "border-co-teal-border bg-co-teal-bg text-co-teal-text",
  red: "border-[#f5b5b5] bg-co-red-bg-soft text-co-red-text",
  amber: "border-[#f3d998] bg-co-amber-bg-soft text-co-amber-text",
  gray: "border-co-border bg-co-sunken-2 text-co-text-3"
};

function ComplianceBand({ compliance }: { compliance: LeadCompliance }) {
  return (
    <div className={`mt-4 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 ${bandTone[compliance.tone]}`}>
      <span className="mt-1 size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
      <div>
        <div className="text-[12.5px] font-extrabold">{compliance.title}</div>
        <p className="mt-0.5 text-[11.5px] opacity-90">{compliance.copy}</p>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-3 border-b border-co-divider py-1.5 last:border-0">
      <span className="text-[11px] font-bold text-co-muted">{label}</span>
      <span className={`text-[12.5px] font-semibold ${accent ? "text-co-blue-dark" : "text-co-ink"}`}>
        {value || <span className="font-normal italic text-co-muted-2">Not captured yet</span>}
      </span>
    </div>
  );
}

function timelineDot(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("call")) return "bg-co-teal";
  if (t.includes("email")) return "bg-co-blue";
  if (t.includes("note")) return "bg-co-amber-dot";
  return "bg-co-muted";
}

function TimelineRow({ item }: { item: FocusTimelineItem }) {
  return (
    <div className="flex items-start gap-2 border-b border-co-divider py-1.5 last:border-0">
      <span className={`mt-1 size-2 shrink-0 rounded-full ${timelineDot(item.type)}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12.5px] font-bold text-co-ink">{item.title}</span>
          <span className="shrink-0 text-[11px] text-co-muted-2">{item.meta}</span>
        </div>
        {item.body ? <p className="mt-0.5 line-clamp-1 text-[11.5px] text-co-text-2">{item.body}</p> : null}
      </div>
    </div>
  );
}

function ScanCell({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "blue" | "red" | "ink" | "muted" | "teal";
}) {
  const toneClass =
    tone === "blue"
      ? "text-co-blue-dark"
      : tone === "red"
        ? "text-co-red-text"
        : tone === "teal"
          ? "text-co-teal-text"
          : tone === "muted"
            ? "text-co-muted-2"
            : "text-co-ink";
  return (
    <div className="p-3.5">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-co-muted">{label}</div>
      <div className={`mt-1 text-[12.5px] font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

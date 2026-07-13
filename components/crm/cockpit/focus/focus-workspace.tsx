"use client";

import * as React from "react";
import Link from "next/link";
import { Phone } from "lucide-react";

import { CoPill, type CoTone } from "@/components/crm/cockpit/co-table";

// Focus workspace (SDR Cockpit) — the 3-zone calling surface: queue rail + lead
// dossier + execution dock. This first cut ships the rail (queue-weight ordered,
// view select, search, filter chips, J/K, URL-driven ?lead=&view=) + a dossier fed
// from the lead row. The live-call dock + unified wrap-up land in the next PRs.
export type FocusLead = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  hasPhone: boolean;
  priority: string;
  status: string;
  slaStatus: string;
  dueLabel: string;
  dueAtMs: number;
  overdue: boolean;
  grade: string;
  fitReason: string;
  companyName: string;
  companyDomain: string;
  companyIndustry: string;
  companyLocation: string;
  lastTouchLabel: string;
  owner: string;
};

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

function priorityTone(priority: string): CoTone {
  if (priority === "P1") return "red";
  if (priority === "P2") return "amber";
  if (priority === "P3") return "sky";
  return "neutral";
}
function slaTone(sla: string): CoTone {
  if (sla === "Overdue") return "red";
  if (sla === "Due soon") return "amber";
  if (sla === "On track") return "teal";
  return "neutral";
}
function statusTone(status: string): CoTone {
  if (status === "Replied" || status === "Meeting Booked") return "teal";
  if (status === "Suppressed") return "red";
  if (status === "New" || status === "Nurture") return "neutral";
  return "info";
}

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
  initialView
}: {
  leads: FocusLead[];
  initialLeadId?: string;
  initialView?: string;
}) {
  const [view, setView] = React.useState<ViewId>(
    VIEWS.some((v) => v.id === initialView) ? (initialView as ViewId) : "all"
  );
  const [chip, setChip] = React.useState<ChipId>("all");
  const [query, setQuery] = React.useState("");
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  return (
    <div className="cockpit flex h-[calc(100vh-3.5rem)] min-h-[560px] w-full overflow-hidden bg-co-page">
      {/* ───────────── Queue rail ───────────── */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-co-border bg-white">
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
            return (
              <button
                key={lead.id}
                type="button"
                onClick={() => setSelectedId(lead.id)}
                className={`flex w-full flex-col gap-1 border-b border-co-divider px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-[#eaf3ff]" : "hover:bg-co-sunken"
                }`}
                style={active ? { boxShadow: "inset 3px 0 0 var(--co-blue)" } : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-extrabold text-co-ink">{lead.name}</span>
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
                    <CoPill tone={slaTone(selected.slaStatus)}>{selected.slaStatus}</CoPill>
                  </div>
                  <p className="mt-1 text-[12.5px] text-co-text-3">
                    {[selected.title, selected.companyName, selected.companyDomain].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-co-text-2">
                    {selected.hasPhone ? <span>{selected.phone}</span> : <span className="text-co-red-text">No phone</span>}
                    {selected.email ? <span>{selected.email}</span> : null}
                    {selected.companyLocation ? <span>{selected.companyLocation}</span> : null}
                    <span className="text-co-muted-2">Owner · {selected.owner}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section>
                <h2 className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Call brief</h2>
                <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
                  <Row label="Fit reason" value={selected.fitReason} />
                  <Row label="Industry" value={selected.companyIndustry} />
                  <Row label="Priority" value={selected.priority} />
                  <Row label="Last interaction" value={selected.lastTouchLabel} />
                  <Row label="Due" value={selected.dueLabel} />
                </div>
              </section>
              <section>
                <h2 className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
                  Company &amp; account
                </h2>
                <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
                  <Row label="Company" value={selected.companyName} />
                  <Row label="Industry" value={selected.companyIndustry} />
                  <Row label="Location" value={selected.companyLocation} />
                  <Row
                    label="Domain"
                    value={
                      selected.companyDomain ? (
                        <a
                          href={`https://${selected.companyDomain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-co-blue"
                        >
                          {selected.companyDomain}
                        </a>
                      ) : (
                        ""
                      )
                    }
                  />
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

      {/* ───────────── Execution dock (pre-call placeholder; live dock next PR) ───────────── */}
      <aside className="hidden w-[388px] shrink-0 flex-col border-l border-co-border bg-co-sunken xl:flex">
        {selected ? (
          <div className="flex flex-col gap-4 p-4">
            <div className="rounded-[10px] border border-[#bcd8ff] bg-[#eaf3ff] p-3.5">
              <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-blue-dark">
                Next best action
              </div>
              <div className="mt-1 text-[13px] font-bold text-co-ink">
                {selected.overdue ? "Call now — SLA overdue" : selected.hasPhone ? "Call now" : "No phone on file"}
              </div>
              <button
                type="button"
                disabled={!selected.hasPhone}
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-co-blue text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:cursor-not-allowed disabled:bg-[#dce5ee] disabled:text-co-muted-2"
                title={selected.hasPhone ? "Live calling arrives in the next Focus PR" : "No phone on file"}
              >
                <Phone className="size-4" aria-hidden="true" />
                {selected.hasPhone ? `Call ${selected.phone}` : "No phone"}
              </button>
            </div>
            <div>
              <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
                Quick actions
              </div>
              <div className="grid grid-cols-2 gap-2">
                {["1:1 Email", "1:1 SMS", "Add note", "Follow-up", "Create task", "Log touch"].map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled
                    className="h-9 rounded-lg border border-co-control bg-white text-[12px] font-semibold text-co-muted-2"
                    title="Wired up with the live dock in the next Focus PR"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] italic text-co-muted-2">
              The live-call dock, quick-action panels, and unified wrap-up land in the next Focus PRs.
            </p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-3 py-1">
      <span className="text-[12px] text-co-text-3">{label}</span>
      <span className="text-[12.5px] font-semibold text-co-ink">
        {value || <span className="italic text-co-muted-2">Not captured yet</span>}
      </span>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

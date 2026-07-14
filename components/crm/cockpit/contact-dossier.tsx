"use client";

import * as React from "react";
import Link from "next/link";
import { Phone } from "lucide-react";

import { CoPill } from "@/components/crm/cockpit/co-table";
import { KeyAccountFields } from "@/components/crm/cockpit/key-account-fields";
import {
  initials,
  leadCompliance,
  priorityTone,
  recommendedAction,
  slaTone,
  statusTone,
  type FocusLead,
  type FocusTimelineItem,
  type LeadCompliance
} from "@/components/crm/cockpit/focus/focus-types";

// The shared cockpit contact dossier: identity + compliance band + pre-call scan
// strip + the 5 tabs (Overview / Activity / Tasks / Opportunities / Details).
// Rendered identically in the Focus workspace (center panel) and the standalone
// contact page, so there is exactly one contact view. `onCall` differs per host
// (Focus dials into the dock; the page opens the modal dialer); `isFullRecord`
// hides "Open full record" links when this IS the full record.

const DOSSIER_TABS = ["Overview", "Activity", "Tasks", "Opportunities", "Details"] as const;
type DossierTab = (typeof DOSSIER_TABS)[number];

export function ContactDossier({
  lead,
  onCall,
  callBlocked,
  isFullRecord = false
}: {
  lead: FocusLead;
  onCall: () => void;
  callBlocked: string | null;
  isFullRecord?: boolean;
}) {
  const [tab, setTab] = React.useState<DossierTab>("Overview");

  return (
    <div className="mx-auto max-w-[900px] px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#eaf3ff] text-[15px] font-extrabold text-co-blue">
            {initials(lead.name)}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[17.5px] font-extrabold text-co-ink">{lead.name}</h1>
              <CoPill tone={statusTone(lead.status)}>{lead.status}</CoPill>
              <CoPill tone={priorityTone(lead.priority)}>{lead.priority}</CoPill>
              {lead.grade ? <CoPill tone="neutral">Grade {lead.grade}</CoPill> : null}
              <CoPill tone={slaTone(lead.slaStatus)}>SLA {lead.slaStatus}</CoPill>
            </div>
            <p className="mt-1 text-[12.5px] text-co-text-3">
              {[lead.title, lead.companyName, lead.companyDomain].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-co-text-2">
              {lead.hasPhone ? <span>{lead.phone}</span> : <span className="text-co-red-text">No phone</span>}
              {lead.email ? <span>{lead.email}</span> : null}
              {lead.companyLocation ? <span>{lead.companyLocation}</span> : null}
              {lead.localTimeLabel ? (
                <span className={lead.outsideWindow ? "font-semibold text-co-amber-text" : ""}>
                  {lead.localTimeLabel}
                  {lead.outsideWindow ? " · outside calling window" : ""}
                </span>
              ) : null}
              <span className="text-co-muted-2">Owner · {lead.owner}</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCall}
          disabled={Boolean(callBlocked)}
          title={callBlocked || `Call ${lead.name}`}
          className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-co-blue px-4 text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:cursor-not-allowed disabled:bg-[#dce5ee] disabled:text-co-muted-2"
        >
          <Phone className="size-4" aria-hidden="true" />
          Call
        </button>
      </div>

      <ComplianceBand compliance={leadCompliance(lead)} />

      {/* Pre-call scan strip — the three things to know before dialing. */}
      <div className="mt-4 grid grid-cols-1 divide-y divide-co-divider overflow-hidden rounded-[9px] border border-co-border bg-co-sunken-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ScanCell label="Recommended action" value={recommendedAction(lead, Boolean(callBlocked))} tone="blue" />
        <ScanCell label="Next follow-up" value={lead.dueLabel || "None scheduled"} tone={lead.overdue ? "red" : "ink"} />
        <ScanCell
          label="Opportunity"
          value={lead.openOpportunity || "None yet — create in wrap-up"}
          tone={lead.openOpportunity ? "teal" : "muted"}
        />
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-5 border-b border-co-border">
        {DOSSIER_TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            aria-pressed={tab === item}
            className={`-mb-px border-b-2 pb-2 text-[13px] font-bold transition-colors ${
              tab === item ? "border-co-blue text-co-blue-dark" : "border-transparent text-co-text-3 hover:text-co-ink"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "Overview" ? (
          <OverviewGrid lead={lead} onViewActivity={() => setTab("Activity")} isFullRecord={isFullRecord} />
        ) : tab === "Activity" ? (
          <ActivityTab lead={lead} />
        ) : tab === "Tasks" ? (
          <TasksTab lead={lead} />
        ) : tab === "Opportunities" ? (
          <OpportunitiesTab lead={lead} />
        ) : (
          <DetailsTab lead={lead} isFullRecord={isFullRecord} />
        )}
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

function ScanCell({ label, value, tone }: { label: string; value: string; tone: "blue" | "red" | "ink" | "muted" | "teal" }) {
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">{children}</h2>;
}

function EmptyTab({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-co-border bg-co-sunken p-6 text-center text-[12.5px] text-co-muted-2">
      {children}
    </div>
  );
}

function OverviewGrid({
  lead,
  onViewActivity,
  isFullRecord
}: {
  lead: FocusLead;
  onViewActivity: () => void;
  isFullRecord: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section>
        <SectionLabel>Call brief</SectionLabel>
        <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
          <Row label="Fit reason" value={lead.fitReason} />
          <Row label="Talking point" value="" accent />
          <Row label="Last interaction" value={lead.lastTouchLabel} />
          <Row label="Pain point" value="" />
          <Row label="Objection" value="" />
          <Row label="Decision maker" value="" />
          <Row label="Expected next step" value="" />
        </div>
        <div className="mt-4 flex items-center justify-between">
          <SectionLabel>Recent engagement</SectionLabel>
          <button
            type="button"
            onClick={onViewActivity}
            className="mb-2 text-[11px] font-semibold text-co-blue hover:underline"
          >
            View all activity ({lead.timeline.length})
          </button>
        </div>
        <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
          {lead.timeline.length ? (
            lead.timeline.slice(0, 3).map((item) => <TimelineRow key={item.id} item={item} />)
          ) : (
            <p className="text-[12px] italic text-co-muted-2">No recent activity yet.</p>
          )}
        </div>
      </section>
      <section>
        <SectionLabel>Company &amp; account</SectionLabel>
        <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
          <Row label="Industry" value={lead.companyIndustry} />
          <Row label="Location" value={lead.companyLocation} />
          <Row label="Company size" value="" />
          <Row label="Account stage" value="" />
          <Row label="Account owner" value={lead.owner} />
          <Row label="Open opportunity" value={lead.openOpportunity} />
          <Row label="Open work" value={lead.openWork} />
        </div>
        {lead.keyAccountFields.length ? (
          <div className="mt-4">
            <KeyAccountFields fields={lead.keyAccountFields} />
          </div>
        ) : null}
        {!isFullRecord ? (
          <Link
            href={`/crm/contacts/${lead.id}`}
            className="mt-2 inline-block text-[12px] font-semibold text-co-blue hover:underline"
          >
            Open full record →
          </Link>
        ) : null}
      </section>
    </div>
  );
}

function ActivityTab({ lead }: { lead: FocusLead }) {
  if (!lead.timeline.length) return <EmptyTab>No activity recorded yet.</EmptyTab>;
  return (
    <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
      {lead.timeline.map((item) => (
        <TimelineRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function TasksTab({ lead }: { lead: FocusLead }) {
  if (!lead.tasks.length) return <EmptyTab>No open tasks for this lead.</EmptyTab>;
  return (
    <div className="rounded-[10px] border border-co-border bg-white">
      {lead.tasks.map((task, index) => (
        <div
          key={`${task.title}-${index}`}
          className="flex items-start gap-2.5 border-b border-co-divider px-3.5 py-2.5 last:border-0"
        >
          <span className="mt-0.5 size-4 shrink-0 rounded border border-co-control" aria-hidden="true" />
          <div>
            <div className="text-[13px] font-bold text-co-ink">{task.title}</div>
            <div className={`text-[11.5px] ${task.overdue ? "text-co-red-text" : "text-co-text-3"}`}>{task.dueLabel}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OpportunitiesTab({ lead }: { lead: FocusLead }) {
  if (!lead.opportunities.length) {
    return (
      <EmptyTab>No opportunity yet. When this lead qualifies, create one inside the call wrap-up — no separate form.</EmptyTab>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {lead.opportunities.map((opp, index) => (
        <div key={`${opp.name}-${index}`} className="rounded-[10px] border border-co-border bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-co-ink">{opp.name}</span>
            <span className="text-[12.5px] font-bold tabular-nums text-co-ink">{opp.amountLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-co-text-3">
            <CoPill tone="info">{opp.stage}</CoPill>
            <span>Close {opp.closeLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailsTab({ lead, isFullRecord }: { lead: FocusLead; isFullRecord: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {lead.keyAccountFields.length ? <KeyAccountFields fields={lead.keyAccountFields} /> : null}
      <section>
        <SectionLabel>Contact record</SectionLabel>
        <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
          <Row label="Email" value={lead.email} />
          <Row label="Phone" value={lead.hasPhone ? lead.phone : ""} />
          <Row label="Location" value={lead.companyLocation} />
          <Row label="Local time" value={lead.localTimeLabel} />
          <Row label="Owner" value={lead.owner} />
          <Row label="Status" value={lead.status} />
        </div>
        {!isFullRecord ? (
          <Link
            href={`/crm/contacts/${lead.id}`}
            className="mt-2 inline-block text-[12px] font-semibold text-co-blue hover:underline"
          >
            Open full record →
          </Link>
        ) : null}
      </section>
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

"use client";

import * as React from "react";
import Link from "next/link";

import { CoPill, type CoTone } from "@/components/crm/cockpit/co-table";
import { KeyAccountFields } from "@/components/crm/cockpit/key-account-fields";
import type { FocusTimelineItem, KeyAccountFieldRow } from "@/components/crm/cockpit/focus/focus-types";

// The cockpit account dossier — the same visual language as the contact dossier
// (identity + compliance band + scan strip + tabs), specialised for an account:
// Overview / Contacts / Pipeline / Activity / Details.

export type AccountContactRow = {
  id: string;
  name: string;
  email: string;
  grade: string;
  score: number;
  status: string;
  owner: string;
};
export type AccountOppRow = {
  name: string;
  stage: string;
  amountLabel: string;
  probability: number;
  closeLabel: string;
};
export type AccountTaskRow = { title: string; dueLabel: string; overdue: boolean };

export type AccountDossierData = {
  id: string;
  name: string;
  stage: string;
  priority: string;
  score: number;
  owner: string;
  domain: string;
  industry: string;
  location: string;
  employees: string;
  revenueBand: string;
  source: string;
  compliance: string;
  complianceClear: boolean;
  description: string;
  pipelineLabel: string;
  openTasksCount: number;
  contacts: AccountContactRow[];
  opportunities: AccountOppRow[];
  tasks: AccountTaskRow[];
  timeline: FocusTimelineItem[];
  keyAccountFields: KeyAccountFieldRow[];
};

const ACCOUNT_TABS = ["Overview", "Contacts", "Pipeline", "Activity", "Details"] as const;
type AccountTab = (typeof ACCOUNT_TABS)[number];

function priorityTone(priority: string): CoTone {
  if (priority === "P1") return "red";
  if (priority === "P2") return "amber";
  if (priority === "P3") return "sky";
  return "neutral";
}
function stageTone(stage: string): CoTone {
  if (stage === "Qualified" || stage === "Discovery") return "info";
  if (stage === "Proposal") return "amber";
  if (stage === "Closed won") return "teal";
  if (stage === "Closed lost") return "red";
  return "neutral";
}
function gradeTone(grade: string): CoTone {
  if (grade === "A" || grade === "B") return "teal";
  if (grade === "C") return "amber";
  if (grade === "D" || grade === "S") return "red";
  return "neutral";
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function AccountDossier({ account }: { account: AccountDossierData }) {
  const [tab, setTab] = React.useState<AccountTab>("Overview");
  const primaryContact = account.contacts[0];

  return (
    <div className="mx-auto max-w-[900px] px-6 py-5">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#eaf3ff] text-[15px] font-extrabold text-co-blue">
          {initials(account.name)}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[17.5px] font-extrabold text-co-ink">{account.name}</h1>
            <CoPill tone={stageTone(account.stage)}>{account.stage}</CoPill>
            <CoPill tone={priorityTone(account.priority)}>{account.priority}</CoPill>
            <CoPill tone="neutral">Score {account.score}</CoPill>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-co-text-2">
            {account.domain ? <span>{account.domain}</span> : null}
            {account.industry ? <span>{account.industry}</span> : null}
            {account.location ? <span>{account.location}</span> : null}
            <span className="text-co-muted-2">Owner · {account.owner}</span>
          </p>
        </div>
      </div>

      <div
        className={`mt-4 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 ${
          account.complianceClear
            ? "border-co-teal-border bg-co-teal-bg text-co-teal-text"
            : "border-[#f3d998] bg-co-amber-bg-soft text-co-amber-text"
        }`}
      >
        <span className="mt-1 size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
        <div>
          <div className="text-[12.5px] font-extrabold">{account.complianceClear ? "Clear to work" : "Review compliance"}</div>
          <p className="mt-0.5 text-[11.5px] opacity-90">{account.compliance}</p>
        </div>
      </div>

      {/* Scan strip */}
      <div className="mt-4 grid grid-cols-1 divide-y divide-co-divider overflow-hidden rounded-[9px] border border-co-border bg-co-sunken-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ScanCell label="Open pipeline" value={account.pipelineLabel} tone="teal" />
        <ScanCell label="Open work" value={`${account.openTasksCount} open task${account.openTasksCount === 1 ? "" : "s"}`} tone={account.openTasksCount ? "ink" : "muted"} />
        <ScanCell label="Primary contact" value={primaryContact ? primaryContact.name : "None yet"} tone={primaryContact ? "blue" : "muted"} />
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-5 border-b border-co-border">
        {ACCOUNT_TABS.map((item) => (
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
          <OverviewTab account={account} onViewActivity={() => setTab("Activity")} />
        ) : tab === "Contacts" ? (
          <ContactsTab account={account} />
        ) : tab === "Pipeline" ? (
          <PipelineTab account={account} />
        ) : tab === "Activity" ? (
          <ActivityTab account={account} />
        ) : (
          <DetailsTab account={account} />
        )}
      </div>
    </div>
  );
}

function OverviewTab({ account, onViewActivity }: { account: AccountDossierData; onViewActivity: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section>
        <SectionLabel>Account snapshot</SectionLabel>
        <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
          <Row label="Stage" value={account.stage} />
          <Row label="Domain" value={account.domain} />
          <Row label="Industry" value={account.industry} />
          <Row label="Location" value={account.location} />
          <Row label="Employees" value={account.employees} />
          <Row label="Revenue band" value={account.revenueBand} />
          <Row label="Source" value={account.source} />
          <Row label="Owner" value={account.owner} />
        </div>
        {account.keyAccountFields.length ? (
          <div className="mt-4">
            <KeyAccountFields fields={account.keyAccountFields} />
          </div>
        ) : null}
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Recent activity</SectionLabel>
          <button type="button" onClick={onViewActivity} className="mb-2 text-[11px] font-semibold text-co-blue hover:underline">
            View all ({account.timeline.length})
          </button>
        </div>
        <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
          {account.timeline.length ? (
            account.timeline.slice(0, 3).map((item) => <TimelineRow key={item.id} item={item} />)
          ) : (
            <p className="text-[12px] italic text-co-muted-2">No recent activity yet.</p>
          )}
        </div>
        <div className="mt-4">
          <SectionLabel>Open work</SectionLabel>
          <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
            {account.tasks.length ? (
              account.tasks.slice(0, 4).map((task, index) => (
                <div key={`${task.title}-${index}`} className="flex items-center justify-between gap-2 border-b border-co-divider py-1.5 last:border-0">
                  <span className="text-[12.5px] font-semibold text-co-ink">{task.title}</span>
                  <span className={`text-[11px] ${task.overdue ? "text-co-red-text" : "text-co-text-3"}`}>{task.dueLabel}</span>
                </div>
              ))
            ) : (
              <p className="text-[12px] italic text-co-muted-2">No open tasks.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ContactsTab({ account }: { account: AccountDossierData }) {
  if (!account.contacts.length) return <EmptyTab>No contacts linked to this account yet.</EmptyTab>;
  return (
    <div className="overflow-hidden rounded-[10px] border border-co-border bg-white">
      {account.contacts.map((contact) => (
        <Link
          key={contact.id}
          href={`/crm/contacts/${contact.id}`}
          className="grid grid-cols-[minmax(140px,1fr)_auto] items-center gap-3 border-b border-co-divider px-3.5 py-2.5 transition-colors last:border-0 hover:bg-[#f6faff]"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold text-co-ink">{contact.name}</span>
            <span className="block truncate text-[11.5px] text-co-muted-2">{contact.email}</span>
          </span>
          <span className="flex items-center gap-2">
            <CoPill tone={gradeTone(contact.grade)}>{contact.grade}</CoPill>
            <span className="text-[11.5px] tabular-nums text-co-text-3">{contact.score}</span>
            <CoPill tone="info">{contact.status}</CoPill>
          </span>
        </Link>
      ))}
    </div>
  );
}

function PipelineTab({ account }: { account: AccountDossierData }) {
  if (!account.opportunities.length) {
    return <EmptyTab>No opportunities linked to this account yet. Create one from the action rail.</EmptyTab>;
  }
  return (
    <div className="flex flex-col gap-2">
      {account.opportunities.map((opp, index) => (
        <div key={`${opp.name}-${index}`} className="rounded-[10px] border border-co-border bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-co-ink">{opp.name}</span>
            <span className="text-[12.5px] font-bold tabular-nums text-co-ink">{opp.amountLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-co-text-3">
            <CoPill tone={stageTone(opp.stage)}>{opp.stage}</CoPill>
            <span>{opp.probability}% probability</span>
            <span>Close {opp.closeLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ account }: { account: AccountDossierData }) {
  if (!account.timeline.length) return <EmptyTab>No activity recorded yet.</EmptyTab>;
  return (
    <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
      {account.timeline.map((item) => (
        <TimelineRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function DetailsTab({ account }: { account: AccountDossierData }) {
  return (
    <div className="flex flex-col gap-5">
      {account.keyAccountFields.length ? <KeyAccountFields fields={account.keyAccountFields} /> : null}
      <section>
        <SectionLabel>Firmographics</SectionLabel>
        <div className="rounded-[10px] border border-co-border bg-co-sunken p-3.5">
          <Row label="Stage" value={account.stage} />
          <Row label="Domain" value={account.domain} />
          <Row label="Industry" value={account.industry} />
          <Row label="Location" value={account.location} />
          <Row label="Employees" value={account.employees} />
          <Row label="Revenue band" value={account.revenueBand} />
          <Row label="Source" value={account.source} />
          <Row label="Account score" value={String(account.score)} />
          <Row label="Compliance" value={account.compliance} />
          <Row label="Owner" value={account.owner} />
        </div>
      </section>
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

function ScanCell({ label, value, tone }: { label: string; value: string; tone: "blue" | "ink" | "muted" | "teal" }) {
  const toneClass =
    tone === "blue" ? "text-co-blue-dark" : tone === "teal" ? "text-co-teal-text" : tone === "muted" ? "text-co-muted-2" : "text-co-ink";
  return (
    <div className="p-3.5">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-co-muted">{label}</div>
      <div className={`mt-1 text-[12.5px] font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-3 border-b border-co-divider py-1.5 last:border-0">
      <span className="text-[11px] font-bold text-co-muted">{label}</span>
      <span className="text-[12.5px] font-semibold text-co-ink">
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

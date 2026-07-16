"use client";

import * as React from "react";
import Link from "next/link";

import {
  CoChips,
  CoEmptyRow,
  CoListHeader,
  CoPill,
  CoSearch,
  CoTableShell,
  coBodyCell,
  coHeadCell,
  type CoTone
} from "@/components/crm/cockpit/co-table";
import { CoPeek, CoPeekRow, CoPeekSection } from "@/components/crm/cockpit/co-peek";
import { phoneMatchesSearch } from "@/lib/phone-search";

export type CockpitMyContactRow = {
  contactId: string;
  contactName: string;
  title: string;
  companyName: string;
  companyDomain: string;
  priority: string;
  status: string;
  slaStatus: string;
  lastTouchLabel: string;
  phone: string;
  hasPhone: boolean;
  replied: boolean;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "call", label: "Call-ready" },
  { id: "replied", label: "Replied" },
  { id: "blocked", label: "Blocked" }
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const PAGE_SIZE = 50;

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

export function MyContactsView({
  title,
  subline,
  rows
}: {
  title: string;
  subline: string;
  rows: CockpitMyContactRow[];
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<FilterId>("all");
  const [page, setPage] = React.useState(0);
  const [peek, setPeek] = React.useState<CockpitMyContactRow | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "call" && !row.hasPhone) return false;
      if (filter === "blocked" && row.hasPhone) return false;
      if (filter === "replied" && !row.replied) return false;
      if (!q) return true;
      return (
        `${row.contactName} ${row.title} ${row.companyName} ${row.companyDomain}`.toLowerCase().includes(q) ||
        phoneMatchesSearch(row.phone, q)
      );
    });
  }, [rows, query, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <CoListHeader title={title} subline={subline}>
        <CoSearch
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          placeholder="Search contacts or phones…"
        />
        <CoChips
          options={FILTERS}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(0);
          }}
        />
      </CoListHeader>

      <CoTableShell minWidth={980}>
        <thead>
          <tr className="border-b border-co-border bg-co-sunken-2">
            <th className={coHeadCell}>Contact</th>
            <th className={coHeadCell}>Account</th>
            <th className={coHeadCell}>Priority</th>
            <th className={coHeadCell}>Status</th>
            <th className={coHeadCell}>SLA</th>
            <th className={coHeadCell}>Last touch</th>
            <th className={coHeadCell}>Phone</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr
              key={row.contactId}
              onClick={() => setPeek(row)}
              className="cursor-pointer border-b border-co-divider transition-colors last:border-0 hover:bg-co-hover"
            >
              <td className={coBodyCell}>
                <Link
                  href={`/crm/contacts/${row.contactId}`}
                  onClick={(event) => event.stopPropagation()}
                  className="font-bold text-co-ink hover:text-co-blue"
                >
                  {row.contactName}
                </Link>
                {row.title ? <div className="text-[11px] text-co-muted-2">{row.title}</div> : null}
              </td>
              <td className={coBodyCell}>
                <div className="text-co-ink">{row.companyName}</div>
                {row.companyDomain ? <div className="text-[11px] text-co-muted-2">{row.companyDomain}</div> : null}
              </td>
              <td className={coBodyCell}>
                <CoPill tone={priorityTone(row.priority)}>{row.priority}</CoPill>
              </td>
              <td className={coBodyCell}>
                <CoPill tone={statusTone(row.status)}>{row.status}</CoPill>
              </td>
              <td className={coBodyCell}>
                <CoPill tone={slaTone(row.slaStatus)}>{row.slaStatus}</CoPill>
              </td>
              <td className={`${coBodyCell} text-co-text-3`}>{row.lastTouchLabel}</td>
              <td className={`${coBodyCell} whitespace-nowrap`}>
                {row.hasPhone ? (
                  <span className="tabular-nums text-co-text-2">{row.phone}</span>
                ) : (
                  <span className="font-bold text-co-red-text">No phone</span>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 ? (
            <CoEmptyRow colSpan={7} message="No contacts match — try a different search or filter." />
          ) : null}
        </tbody>
      </CoTableShell>

      {filtered.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-[12px] text-co-text-3">
          <span>
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={current === 0}
              className="h-8 rounded-lg border border-co-control bg-co-surface px-3 font-bold text-co-text-3 hover:bg-co-sunken disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-1 tabular-nums">
              {current + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={current >= pageCount - 1}
              className="h-8 rounded-lg border border-co-control bg-co-surface px-3 font-bold text-co-text-3 hover:bg-co-sunken disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <CoPeek
        open={peek !== null}
        onClose={() => setPeek(null)}
        title={peek?.contactName ?? ""}
        subtitle={peek ? [peek.title, peek.companyName].filter(Boolean).join(" · ") : undefined}
        badges={
          peek ? (
            <>
              <CoPill tone={priorityTone(peek.priority)}>{peek.priority}</CoPill>
              <CoPill tone={statusTone(peek.status)}>{peek.status}</CoPill>
              <CoPill tone={slaTone(peek.slaStatus)}>{peek.slaStatus}</CoPill>
            </>
          ) : null
        }
        footer={
          peek ? (
            <div className="flex flex-col gap-2">
              <Link
                href={`/crm/contacts/${peek.contactId}`}
                className="flex h-10 items-center justify-center rounded-lg bg-co-blue text-[12.5px] font-bold text-white transition-colors hover:bg-co-blue-hover"
              >
                Open full record
              </Link>
              <Link
                href={`/sdr/focus?lead=${encodeURIComponent(peek.contactId)}`}
                className="flex h-9 items-center justify-center rounded-lg border border-co-control bg-co-surface text-[12px] font-semibold text-co-text-3 transition-colors hover:bg-co-sunken"
              >
                Open in Focus workspace
              </Link>
            </div>
          ) : null
        }
      >
        {peek ? (
          <>
            <CoPeekSection label="Contact">
              <CoPeekRow
                label="Phone"
                value={peek.hasPhone ? peek.phone : <span className="text-co-red-text">No phone</span>}
              />
              <CoPeekRow label="Account" value={peek.companyName} />
              {peek.companyDomain ? <CoPeekRow label="Domain" value={peek.companyDomain} /> : null}
            </CoPeekSection>
            <CoPeekSection label="Engagement">
              <CoPeekRow label="Status" value={peek.status} />
              <CoPeekRow label="SLA" value={peek.slaStatus} />
              <CoPeekRow label="Last touch" value={peek.lastTouchLabel} />
            </CoPeekSection>
          </>
        ) : null}
      </CoPeek>
    </div>
  );
}

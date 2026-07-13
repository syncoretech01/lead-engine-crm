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

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "call" && !row.hasPhone) return false;
      if (filter === "blocked" && row.hasPhone) return false;
      if (filter === "replied" && !row.replied) return false;
      if (!q) return true;
      return `${row.contactName} ${row.title} ${row.companyName} ${row.companyDomain}`.toLowerCase().includes(q);
    });
  }, [rows, query, filter]);

  // Keep the current page valid as the filtered set shrinks.
  React.useEffect(() => {
    setPage(0);
  }, [query, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <CoListHeader title={title} subline={subline}>
        <CoSearch value={query} onChange={setQuery} placeholder="Search contacts…" />
        <CoChips options={FILTERS} value={filter} onChange={setFilter} />
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
              className="border-b border-co-divider transition-colors last:border-0 hover:bg-[#f6faff]"
            >
              <td className={coBodyCell}>
                <Link href={`/crm/contacts/${row.contactId}`} className="font-bold text-co-ink hover:text-co-blue">
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
              className="h-8 rounded-lg border border-co-control bg-white px-3 font-bold text-co-text-3 hover:bg-co-sunken disabled:opacity-40"
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
              className="h-8 rounded-lg border border-co-control bg-white px-3 font-bold text-co-text-3 hover:bg-co-sunken disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

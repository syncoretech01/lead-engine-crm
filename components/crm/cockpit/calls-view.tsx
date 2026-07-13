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
  coHeadCell
} from "@/components/crm/cockpit/co-table";

// Cockpit Calls table — the redesigned dense call log. Plain, serializable rows
// (display strings precomputed server-side); client-side search + All/Connected/
// Recorded chips. Built on the shared cockpit list primitives.
export type CockpitCallRow = {
  id: string;
  contactId: string;
  contactName: string;
  companyName: string;
  durationLabel: string;
  outcomeLabel: string;
  outcomeTone: "teal" | "amber" | "red" | "info";
  whenLabel: string;
  recordingLabel: string;
  recorded: boolean;
  connected: boolean;
  note: string;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "connected", label: "Connected" },
  { id: "recorded", label: "Recorded" }
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

export function CallsView({
  title,
  subline,
  rows
}: {
  title: string;
  subline: string;
  rows: CockpitCallRow[];
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<FilterId>("all");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "connected" && !row.connected) return false;
      if (filter === "recorded" && !row.recorded) return false;
      if (!q) return true;
      return `${row.contactName} ${row.companyName} ${row.outcomeLabel} ${row.note}`.toLowerCase().includes(q);
    });
  }, [rows, query, filter]);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <CoListHeader title={title} subline={subline}>
        <CoSearch value={query} onChange={setQuery} placeholder="Search call log…" />
        <CoChips options={FILTERS} value={filter} onChange={setFilter} />
      </CoListHeader>

      <CoTableShell>
        <thead>
          <tr className="border-b border-co-border bg-co-sunken-2">
            <th className={coHeadCell}>Contact</th>
            <th className={coHeadCell}>Outcome</th>
            <th className={coHeadCell}>Duration</th>
            <th className={coHeadCell}>When</th>
            <th className={coHeadCell}>Recording</th>
            <th className={coHeadCell}>Note</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr
              key={row.id}
              className="border-b border-co-divider transition-colors last:border-0 hover:bg-[#f6faff]"
            >
              <td className={coBodyCell}>
                {row.contactId ? (
                  <Link href={`/crm/contacts/${row.contactId}`} className="font-bold text-co-ink hover:text-co-blue">
                    {row.contactName}
                  </Link>
                ) : (
                  <span className="font-bold text-co-ink">{row.contactName}</span>
                )}
                {row.companyName ? <div className="text-[11px] text-co-muted-2">{row.companyName}</div> : null}
              </td>
              <td className={coBodyCell}>
                <CoPill tone={row.outcomeTone}>{row.outcomeLabel}</CoPill>
              </td>
              <td className={`${coBodyCell} whitespace-nowrap tabular-nums text-co-text-3`}>{row.durationLabel}</td>
              <td className={`${coBodyCell} whitespace-nowrap text-co-text-3`}>{row.whenLabel}</td>
              <td className={coBodyCell}>
                {row.recorded ? (
                  <CoPill tone="teal">{row.recordingLabel}</CoPill>
                ) : (
                  <span className="text-[12px] text-co-muted-2">{row.recordingLabel}</span>
                )}
              </td>
              <td className={`${coBodyCell} max-w-[360px] text-co-text-2`}>
                <span className="line-clamp-2">{row.note || "—"}</span>
              </td>
            </tr>
          ))}
          {filtered.length === 0 ? (
            <CoEmptyRow colSpan={6} message="No calls match — try a different search or filter." />
          ) : null}
        </tbody>
      </CoTableShell>
    </div>
  );
}

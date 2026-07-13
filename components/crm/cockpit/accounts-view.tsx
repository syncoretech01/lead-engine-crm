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

export type CockpitAccountRow = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  location: string;
  stage: string;
  primaryContactName: string;
  primaryContactTitle: string;
  lastActivity: string;
  hasOpportunity: boolean;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "opps", label: "With opportunity" }
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function stageTone(stage: string): CoTone {
  if (stage === "Qualified" || stage === "Discovery") return "info";
  if (stage === "Proposal") return "amber";
  if (stage === "Closed won") return "teal";
  if (stage === "Closed lost") return "red";
  return "neutral";
}

export function AccountsView({
  title,
  subline,
  rows
}: {
  title: string;
  subline: string;
  rows: CockpitAccountRow[];
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<FilterId>("all");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "opps" && !row.hasOpportunity) return false;
      if (!q) return true;
      return `${row.name} ${row.domain} ${row.industry} ${row.location} ${row.primaryContactName}`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, filter]);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <CoListHeader title={title} subline={subline}>
        <CoSearch value={query} onChange={setQuery} placeholder="Search accounts…" />
        <CoChips options={FILTERS} value={filter} onChange={setFilter} />
      </CoListHeader>

      <CoTableShell minWidth={900}>
        <thead>
          <tr className="border-b border-co-border bg-co-sunken-2">
            <th className={coHeadCell}>Account</th>
            <th className={coHeadCell}>Industry</th>
            <th className={coHeadCell}>Location</th>
            <th className={coHeadCell}>Stage</th>
            <th className={coHeadCell}>Primary contact</th>
            <th className={coHeadCell}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr
              key={row.id}
              className="border-b border-co-divider transition-colors last:border-0 hover:bg-[#f6faff]"
            >
              <td className={coBodyCell}>
                <Link href={`/crm/accounts/${row.id}`} className="font-bold text-co-ink hover:text-co-blue">
                  {row.name}
                </Link>
                {row.domain ? <div className="text-[11px] text-co-muted-2">{row.domain}</div> : null}
              </td>
              <td className={`${coBodyCell} text-co-text-2`}>{row.industry || "—"}</td>
              <td className={`${coBodyCell} whitespace-nowrap text-co-text-2`}>{row.location || "—"}</td>
              <td className={coBodyCell}>
                <CoPill tone={stageTone(row.stage)}>{row.stage}</CoPill>
              </td>
              <td className={coBodyCell}>
                {row.primaryContactName ? (
                  <>
                    <div className="font-semibold text-co-ink">{row.primaryContactName}</div>
                    {row.primaryContactTitle ? (
                      <div className="text-[11px] text-co-muted-2">{row.primaryContactTitle}</div>
                    ) : null}
                  </>
                ) : (
                  <span className="text-co-muted-2">—</span>
                )}
              </td>
              <td className={`${coBodyCell} text-co-text-3`}>{row.lastActivity}</td>
            </tr>
          ))}
          {filtered.length === 0 ? (
            <CoEmptyRow colSpan={6} message="No accounts match — try a different search or filter." />
          ) : null}
        </tbody>
      </CoTableShell>
    </div>
  );
}

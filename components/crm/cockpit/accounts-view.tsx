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
import { CoPeek, CoPeekRow, CoPeekSection, CoPeekSummary } from "@/components/crm/cockpit/co-peek";

export type CockpitAccountRow = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  location: string;
  stage: string;
  owner: string;
  employees: string;
  description: string;
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
  const [peek, setPeek] = React.useState<CockpitAccountRow | null>(null);

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
              onClick={() => setPeek(row)}
              className="cursor-pointer border-b border-co-divider transition-colors last:border-0 hover:bg-[#f6faff]"
            >
              <td className={coBodyCell}>
                <Link
                  href={`/crm/accounts/${row.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="font-bold text-co-ink hover:text-co-blue"
                >
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

      <CoPeek
        open={peek !== null}
        onClose={() => setPeek(null)}
        title={peek?.name ?? ""}
        subtitle={[peek?.domain, peek?.location].filter(Boolean).join(" · ")}
        badges={peek ? <CoPill tone={stageTone(peek.stage)}>{peek.stage}</CoPill> : null}
        footer={
          peek ? (
            <div className="flex flex-col gap-2">
              <Link
                href={`/crm/accounts/${peek.id}`}
                className="flex h-10 items-center justify-center rounded-lg bg-co-blue text-[12.5px] font-bold text-white transition-colors hover:bg-co-blue-hover"
              >
                Open full record
              </Link>
              <button
                type="button"
                disabled
                title="Available when the Focus workspace ships"
                className="flex h-9 items-center justify-center rounded-lg border border-co-control bg-white text-[12px] font-semibold text-co-muted-2"
              >
                Open in Focus workspace · soon
              </button>
            </div>
          ) : null
        }
      >
        {peek ? (
          <>
            {peek.description ? <CoPeekSummary>{peek.description}</CoPeekSummary> : null}
            <CoPeekSection label="Firmographics">
              <CoPeekRow label="Industry" value={peek.industry} />
              <CoPeekRow label="Company size" value={peek.employees} />
              <CoPeekRow label="Location" value={peek.location} />
              <CoPeekRow label="Account stage" value={peek.stage} />
              <CoPeekRow label="Account owner" value={peek.owner} />
            </CoPeekSection>
            <CoPeekSection label="Open work">
              <CoPeekRow label="Opportunity" value={peek.hasOpportunity ? "Open opportunity" : ""} />
              <CoPeekRow label="Last activity" value={peek.lastActivity} />
            </CoPeekSection>
            <CoPeekSection label="Primary contact">
              <CoPeekRow
                label={peek.primaryContactTitle || "Contact"}
                value={peek.primaryContactName}
              />
            </CoPeekSection>
          </>
        ) : null}
      </CoPeek>
    </div>
  );
}

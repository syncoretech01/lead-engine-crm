"use client";

import * as React from "react";
import Link from "next/link";

import { updateOpportunityStageAction } from "@/app/actions";
import {
  CoEmptyRow,
  CoListHeader,
  CoPill,
  CoSearch,
  CoTableShell,
  coBodyCell,
  coHeadCell,
  type CoTone
} from "@/components/crm/cockpit/co-table";

export type CockpitOpportunityRow = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  contactName: string;
  stage: string;
  amount: number;
  amountLabel: string;
  probability: number;
  closeLabel: string;
  nextStep: string;
};

export function stageTone(stage: string): CoTone {
  if (stage === "Qualified" || stage === "Discovery") return "info";
  if (stage === "Proposal") return "amber";
  if (stage === "Closed won") return "teal";
  if (stage === "Closed lost") return "red";
  return "neutral";
}

const stageDot: Record<string, string> = {
  Prospecting: "bg-co-muted",
  Qualified: "bg-co-blue",
  Discovery: "bg-co-blue",
  Proposal: "bg-co-amber-dot",
  "Closed won": "bg-co-teal",
  "Closed lost": "bg-co-red"
};

function money(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function OpportunitiesView({
  title,
  subline,
  rows,
  stages
}: {
  title: string;
  subline: string;
  rows: CockpitOpportunityRow[];
  stages: string[];
}) {
  const [view, setView] = React.useState<"list" | "board">("list");
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.name} ${row.companyName} ${row.contactName} ${row.stage}`.toLowerCase().includes(q)
    );
  }, [rows, query]);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <CoListHeader title={title} subline={subline}>
        <div className="inline-flex overflow-hidden rounded-lg border border-co-control">
          {(["list", "board"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              className={`h-8 px-3.5 text-[12px] font-bold capitalize transition-colors ${
                view === mode ? "bg-co-blue text-white" : "bg-white text-co-text-3 hover:bg-co-sunken"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <CoSearch value={query} onChange={setQuery} placeholder="Search opportunities…" />
      </CoListHeader>

      {view === "list" ? (
        <CoTableShell minWidth={920}>
          <thead>
            <tr className="border-b border-co-border bg-co-sunken-2">
              <th className={coHeadCell}>Opportunity</th>
              <th className={coHeadCell}>Stage</th>
              <th className={coHeadCell}>Amount</th>
              <th className={coHeadCell}>Probability</th>
              <th className={coHeadCell}>Close</th>
              <th className={coHeadCell}>Next step</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className="border-b border-co-divider transition-colors last:border-0 hover:bg-[#f6faff]"
              >
                <td className={coBodyCell}>
                  <Link href={`/crm/accounts/${row.companyId}`} className="font-bold text-co-ink hover:text-co-blue">
                    {row.name}
                  </Link>
                  <div className="text-[11px] text-co-muted-2">{row.companyName}</div>
                </td>
                <td className={coBodyCell}>
                  <CoPill tone={stageTone(row.stage)}>{row.stage}</CoPill>
                </td>
                <td className={`${coBodyCell} whitespace-nowrap font-bold tabular-nums text-co-ink`}>{row.amountLabel}</td>
                <td className={`${coBodyCell} tabular-nums text-co-text-2`}>{row.probability}%</td>
                <td className={`${coBodyCell} whitespace-nowrap text-co-text-3`}>{row.closeLabel}</td>
                <td className={`${coBodyCell} max-w-[320px] text-co-text-2`}>
                  <span className="line-clamp-2">{row.nextStep || "—"}</span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <CoEmptyRow colSpan={6} message="No opportunities match — try a different search." />
            ) : null}
          </tbody>
        </CoTableShell>
      ) : (
        <div className="flex gap-3.5 overflow-x-auto pb-2">
          {stages.map((stage) => {
            const cards = filtered.filter((row) => row.stage === stage);
            const total = cards.reduce((sum, row) => sum + row.amount, 0);
            return (
              <div key={stage} className="flex w-[246px] shrink-0 flex-col gap-2.5">
                <div className="flex items-center gap-2 px-1">
                  <span className={`size-2 rounded-full ${stageDot[stage] ?? "bg-co-muted"}`} aria-hidden="true" />
                  <span className="text-[12.5px] font-extrabold text-co-ink">{stage}</span>
                  <span className="text-[11px] font-bold text-co-muted-2">{cards.length}</span>
                  <span className="ml-auto text-[11px] font-bold tabular-nums text-co-text-3">{money(total)}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {cards.map((row) => (
                    <div key={row.id} className="rounded-[10px] border border-co-border bg-white p-3">
                      <Link href={`/crm/accounts/${row.companyId}`} className="text-[12.5px] font-bold text-co-ink hover:text-co-blue">
                        {row.name}
                      </Link>
                      <div className="mt-0.5 truncate text-[11px] text-co-muted-2">
                        {row.companyName}
                        {row.contactName ? ` · ${row.contactName}` : ""}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[12.5px] font-bold tabular-nums text-co-ink">{row.amountLabel}</span>
                        <span className="text-[11px] text-co-text-3">{row.closeLabel}</span>
                      </div>
                      <form action={updateOpportunityStageAction} className="mt-2">
                        <input type="hidden" name="id" value={row.id} />
                        <label className="sr-only" htmlFor={`stage-${row.id}`}>
                          Move {row.name} to another stage
                        </label>
                        <select
                          id={`stage-${row.id}`}
                          name="stage"
                          defaultValue={row.stage}
                          onChange={(event) => event.currentTarget.form?.requestSubmit()}
                          className="w-full rounded-md border border-co-control bg-co-sunken px-2 py-1 text-[11px] font-semibold text-co-text-3"
                        >
                          {stages.map((option) => (
                            <option key={option} value={option}>
                              Move to {option}
                            </option>
                          ))}
                        </select>
                      </form>
                    </div>
                  ))}
                  {cards.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-co-border py-8 text-center text-[11px] text-co-muted-2">
                      No deals
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

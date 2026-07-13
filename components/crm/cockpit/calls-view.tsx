"use client";

import * as React from "react";
import Link from "next/link";

// Cockpit Calls table — the redesigned dense call log (SDR Cockpit). Plain,
// serializable rows (all display strings precomputed server-side); client-side
// search + All/Connected/Recorded chips. Styled with the --co-* cockpit tokens.
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

const toneClass: Record<CockpitCallRow["outcomeTone"], string> = {
  teal: "bg-co-teal-bg text-co-teal-text",
  amber: "bg-co-amber-bg text-co-amber-text",
  red: "bg-co-red-bg text-co-red-text",
  info: "bg-[#e8f2ff] text-co-blue-dark"
};

function Pill({ tone, children }: { tone: keyof typeof toneClass; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[10px] font-bold ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

const headCell = "px-4 py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted";
const bodyCell = "px-4 py-2.5 align-middle text-[12.5px] text-co-ink";

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
      {/* Page header: title + subline (left) · search + filter chips (right) */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-extrabold tracking-tight text-co-ink">{title}</h1>
          <p className="mt-0.5 text-[12.5px] text-co-text-3">{subline}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search call log…"
            aria-label="Search call log"
            className="h-9 w-[220px] rounded-lg border border-co-control bg-white px-3 text-[12.5px] text-co-ink placeholder:text-co-muted-2"
          />
          <div className="flex items-center gap-1.5">
            {FILTERS.map((chip) => {
              const active = filter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilter(chip.id)}
                  aria-pressed={active}
                  className={`h-8 rounded-full px-3 text-[12px] font-bold transition-colors ${
                    active
                      ? "bg-co-blue text-white"
                      : "border border-co-control bg-white text-co-text-3 hover:bg-co-sunken"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Dense table */}
      <div className="overflow-x-auto rounded-[10px] border border-co-border bg-white">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-co-border bg-co-sunken-2">
              <th className={headCell}>Contact</th>
              <th className={headCell}>Outcome</th>
              <th className={headCell}>Duration</th>
              <th className={headCell}>When</th>
              <th className={headCell}>Recording</th>
              <th className={headCell}>Note</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-b border-co-divider transition-colors last:border-0 hover:bg-[#f6faff]">
                <td className={bodyCell}>
                  {row.contactId ? (
                    <Link href={`/crm/contacts/${row.contactId}`} className="font-bold text-co-ink hover:text-co-blue">
                      {row.contactName}
                    </Link>
                  ) : (
                    <span className="font-bold text-co-ink">{row.contactName}</span>
                  )}
                  {row.companyName ? <div className="text-[11px] text-co-muted-2">{row.companyName}</div> : null}
                </td>
                <td className={bodyCell}>
                  <Pill tone={row.outcomeTone}>{row.outcomeLabel}</Pill>
                </td>
                <td className={`${bodyCell} whitespace-nowrap tabular-nums text-co-text-3`}>{row.durationLabel}</td>
                <td className={`${bodyCell} whitespace-nowrap text-co-text-3`}>{row.whenLabel}</td>
                <td className={bodyCell}>
                  {row.recorded ? (
                    <Pill tone="teal">{row.recordingLabel}</Pill>
                  ) : (
                    <span className="text-[12px] text-co-muted-2">{row.recordingLabel}</span>
                  )}
                </td>
                <td className={`${bodyCell} max-w-[360px] text-co-text-2`}>
                  <span className="line-clamp-2">{row.note || "—"}</span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center text-[12.5px] text-co-muted">
                  No calls match — try a different search or filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
import { CoPeek, CoPeekRow, CoPeekSection } from "@/components/crm/cockpit/co-peek";
import { RecordingPlayer } from "@/components/recording-player";

// Cockpit Calls table — the redesigned dense call log. Plain, serializable rows
// (display strings precomputed server-side); client-side search + All/Connected/
// Recorded chips; click a row for the call peek.
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
  const [peek, setPeek] = React.useState<CockpitCallRow | null>(null);

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
              onClick={() => setPeek(row)}
              className="cursor-pointer border-b border-co-divider transition-colors last:border-0 hover:bg-[#f6faff]"
            >
              <td className={coBodyCell}>
                {row.contactId ? (
                  <Link
                    href={`/crm/contacts/${row.contactId}`}
                    onClick={(event) => event.stopPropagation()}
                    className="font-bold text-co-ink hover:text-co-blue"
                  >
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

      <CoPeek
        open={peek !== null}
        onClose={() => setPeek(null)}
        title={peek?.contactName ?? ""}
        subtitle={peek?.companyName}
        badges={
          peek ? (
            <>
              <CoPill tone={peek.outcomeTone}>{peek.outcomeLabel}</CoPill>
              {peek.recorded ? <CoPill tone="teal">Recorded</CoPill> : null}
            </>
          ) : null
        }
        footer={
          peek ? (
            <div className="flex flex-col gap-2">
              {peek.contactId ? (
                <Link
                  href={`/sdr/focus?lead=${encodeURIComponent(peek.contactId)}`}
                  className="flex h-10 items-center justify-center rounded-lg bg-co-blue text-[12.5px] font-bold text-white transition-colors hover:bg-co-blue-hover"
                >
                  Open in Focus workspace
                </Link>
              ) : null}
              {peek.contactId ? (
                <Link
                  href={`/crm/contacts/${peek.contactId}`}
                  className="flex h-9 items-center justify-center rounded-lg border border-co-control bg-white text-[12px] font-semibold text-co-text-3 transition-colors hover:bg-co-sunken"
                >
                  Open contact
                </Link>
              ) : null}
            </div>
          ) : null
        }
      >
        {peek ? (
          <>
            <CoPeekSection label="Call">
              <CoPeekRow label="Outcome" value={peek.outcomeLabel} />
              <CoPeekRow label="Duration" value={peek.durationLabel} />
              <CoPeekRow label="When" value={peek.whenLabel} />
              <CoPeekRow label="Recording" value={peek.recordingLabel} />
            </CoPeekSection>
            {peek.recorded ? (
              <CoPeekSection label="Recording">
                <RecordingPlayer callId={peek.id} />
              </CoPeekSection>
            ) : null}
            <CoPeekSection label="Call note">
              {peek.note ? (
                <div className="rounded-[10px] border border-co-border bg-co-sunken p-3 text-[12.5px] text-co-text-2">
                  {peek.note}
                </div>
              ) : (
                <p className="text-[12.5px] italic text-co-muted-2">No note captured for this call.</p>
              )}
            </CoPeekSection>
          </>
        ) : null}
      </CoPeek>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { PhoneOff } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableFilterChips } from "@/components/data-table/data-table-filter-chips";
import { EmptyState } from "@/components/ui/empty-state";
import { RecordingPlayer } from "@/components/recording-player";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";

// Plain, fully-serializable row — all display strings (duration, when, outcome)
// and the recording state are precomputed server-side so the client table never
// touches Date.now() (no hydration drift).
export type CallRow = {
  id: string;
  contactId: string;
  contactName: string;
  phoneNumber: string;
  durationLabel: string;
  durationSeconds: number;
  outcomeLabel: string;
  outcomeGroup: string;
  outcomeTone: BadgeTone;
  sdrName: string;
  whenLabel: string;
  whenAt: string;
  recordingState: "ready" | "processing" | "unavailable" | "none";
};

const OUTCOME_OPTIONS = [
  { value: "Connected", label: "Connected" },
  { value: "Voicemail", label: "Voicemail" },
  { value: "No answer", label: "No answer" },
  { value: "Failed", label: "Failed" }
];

function RecordingCell({ row }: { row: CallRow }) {
  if (row.recordingState === "ready") return <RecordingPlayer callId={row.id} />;
  if (row.recordingState === "processing")
    return <span className="text-xs text-muted-foreground">Processing…</span>;
  if (row.recordingState === "unavailable")
    return <span className="text-xs text-muted-foreground">Unavailable</span>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

export function CallsTable({
  rows,
  isSdr,
  initialQuery,
  initialSort,
  initialPage
}: {
  rows: CallRow[];
  isSdr: boolean;
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
}) {
  const columns = React.useMemo<ColumnDef<CallRow, unknown>[]>(() => {
    const defs: ColumnDef<CallRow, unknown>[] = [
      {
        id: "contact",
        accessorFn: (row) => `${row.contactName} ${row.phoneNumber}`,
        header: "Contact",
        enableHiding: false,
        cell: ({ row }) => {
          const call = row.original;
          return call.contactId ? (
            <Link href={`/crm/contacts/${call.contactId}`} className="font-medium text-foreground">
              {call.contactName}
            </Link>
          ) : (
            <span className="text-foreground">{call.contactName}</span>
          );
        }
      },
      {
        id: "number",
        accessorFn: (row) => row.phoneNumber,
        header: "Number",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">{row.original.phoneNumber || "—"}</span>
        )
      },
      {
        id: "duration",
        accessorFn: (row) => row.durationSeconds,
        header: "Duration",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {row.original.durationLabel}
          </span>
        )
      },
      {
        id: "outcome",
        accessorFn: (row) => row.outcomeGroup,
        header: "Outcome",
        filterFn: "equals",
        cell: ({ row }) => (
          <StatusBadge label={row.original.outcomeLabel} tone={row.original.outcomeTone} />
        )
      }
    ];

    if (!isSdr) {
      defs.push({
        id: "sdr",
        accessorFn: (row) => row.sdrName,
        header: "SDR",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.sdrName}</span>
      });
    }

    defs.push(
      {
        id: "when",
        accessorFn: (row) => row.whenAt,
        header: "When",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">{row.original.whenLabel}</span>
        )
      },
      {
        id: "recording",
        header: "Recording",
        enableSorting: false,
        cell: ({ row }) => <RecordingCell row={row.original} />
      }
    );

    return defs;
  }, [isSdr]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      columnLabels={{
        contact: "Contact",
        number: "Number",
        duration: "Duration",
        outcome: "Outcome",
        sdr: "SDR",
        when: "When",
        recording: "Recording"
      }}
      searchPlaceholder="Search calls, contacts, numbers…"
      initialQuery={initialQuery}
      initialSort={initialSort}
      initialPage={initialPage}
      renderToolbar={(table) => (
        <DataTableFilterChips table={table} columnId="outcome" options={OUTCOME_OPTIONS} showCounts />
      )}
      emptyState={
        <EmptyState
          icon={PhoneOff}
          title="No calls match"
          description="Try a different search or outcome filter."
        />
      }
    />
  );
}

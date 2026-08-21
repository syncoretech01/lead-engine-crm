"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock } from "lucide-react";

import { completeFollowUpReminderAction } from "@/app/actions";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableFilterChips } from "@/components/data-table/data-table-filter-chips";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { FollowUpContactRow } from "@/lib/phase1/follow-ups-read-model";
import { gradeTone, priorityTone } from "@/lib/crm-contact-presentation";

const COLUMN_LABELS: Record<string, string> = {
  contact: "Contact",
  company: "Account",
  followUp: "Follow-up",
  due: "Due",
  channel: "Channel",
  open: "Open",
  priority: "Priority",
  grade: "Grade",
  phone: "Phone",
  owner: "Owner",
  complete: "Action"
};

const CHANNEL_OPTIONS = [
  { value: "Call", label: "Call" },
  { value: "Email", label: "Email" },
  { value: "SMS", label: "SMS" },
  { value: "LinkedIn", label: "LinkedIn" },
  { value: "Meeting", label: "Meeting" }
];

/**
 * The Follow-ups directory: one row per contact that has an open SDR-scheduled
 * follow-up, soonest-due first. Every date string is precomputed server-side, so
 * this table renders plain text and never calls Date.now().
 */
export function FollowUpsTable({
  rows,
  isSdr,
  initialQuery,
  initialSort,
  initialPage
}: {
  rows: FollowUpContactRow[];
  isSdr: boolean;
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
}) {
  const columns = React.useMemo<ColumnDef<FollowUpContactRow, unknown>[]>(() => {
    const defs: ColumnDef<FollowUpContactRow, unknown>[] = [
      {
        id: "contact",
        accessorFn: (row) => `${row.contactName} ${row.email} ${row.contactTitle}`,
        header: "Contact",
        enableHiding: false,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="flex flex-col">
              <Link href={`/crm/contacts/${contact.contactId}`} className="font-medium text-foreground">
                {contact.contactName}
              </Link>
              {contact.contactTitle ? (
                <span className="text-xs text-muted-foreground">{contact.contactTitle}</span>
              ) : null}
              {contact.email ? <span className="text-xs text-muted-foreground">{contact.email}</span> : null}
            </div>
          );
        }
      },
      {
        id: "company",
        accessorFn: (row) => row.companyName,
        header: "Account",
        cell: ({ row }) => (
          <Link
            href={`/crm/accounts/${row.original.companyId}`}
            className="text-muted-foreground hover:text-foreground"
          >
            {row.original.companyName}
          </Link>
        )
      },
      {
        id: "followUp",
        accessorFn: (row) => row.nextTitle,
        header: "Follow-up",
        cell: ({ row }) => (
          <span className="text-foreground">{row.original.nextTitle}</span>
        )
      },
      {
        id: "due",
        accessorFn: (row) => row.nextDueAt,
        header: "Due",
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="flex flex-col gap-1">
              <span className="whitespace-nowrap text-muted-foreground">{contact.nextDueDateLabel}</span>
              <StatusBadge
                label={contact.nextDueLabel}
                tone={contact.nextStatus === "Overdue" ? "danger" : "info"}
              />
            </div>
          );
        }
      },
      {
        id: "channel",
        accessorFn: (row) => row.nextChannel,
        header: "Channel",
        filterFn: "equals",
        cell: ({ row }) => <StatusBadge label={row.original.nextChannel} tone="default" />
      },
      {
        id: "open",
        accessorFn: (row) => row.openFollowUps,
        header: "Open",
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {contact.openFollowUps}
              {contact.overdueFollowUps > 0 ? (
                <span className="ml-1 text-[var(--ui-destructive)]">({contact.overdueFollowUps} overdue)</span>
              ) : null}
            </span>
          );
        }
      },
      {
        id: "priority",
        accessorFn: (row) => row.priority,
        header: "Priority",
        cell: ({ row }) => <StatusBadge label={row.original.priority} tone={priorityTone(row.original.priority)} />
      },
      {
        id: "grade",
        accessorFn: (row) => row.grade,
        header: "Grade",
        cell: ({ row }) => <StatusBadge label={row.original.grade} tone={gradeTone(row.original.grade)} />
      },
      {
        id: "phone",
        accessorFn: (row) => row.phone,
        header: "Phone",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">{row.original.phone || "—"}</span>
        )
      }
    ];

    if (!isSdr) {
      defs.push({
        id: "owner",
        accessorFn: (row) => row.ownerName,
        header: "Owner",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.ownerName}</span>
      });
    }

    defs.push({
      id: "complete",
      header: "Action",
      enableSorting: false,
      cell: ({ row }) => (
        <form action={completeFollowUpReminderAction}>
          <input name="id" type="hidden" value={row.original.nextFollowUpId} />
          <SubmitButton
            className={buttonVariants({ variant: "outline", size: "sm" })}
            pendingLabel="Completing…"
          >
            Complete
          </SubmitButton>
        </form>
      )
    });

    return defs;
  }, [isSdr]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.contactId}
      columnLabels={COLUMN_LABELS}
      searchPlaceholder="Search contacts, accounts, follow-ups…"
      phoneSearchAccessor={(row) => row.phone}
      initialQuery={initialQuery}
      initialSort={initialSort}
      initialPage={initialPage}
      renderToolbar={(table) => (
        <DataTableFilterChips table={table} columnId="channel" options={CHANNEL_OPTIONS} showCounts />
      )}
      emptyState={
        <EmptyState
          icon={CalendarClock}
          title="No follow-ups scheduled"
          description={
            isSdr
              ? "Contacts appear here once you schedule a follow-up from a touch or call wrap-up."
              : "Contacts appear here once an SDR schedules a follow-up from a touch or call wrap-up."
          }
        />
      }
    />
  );
}

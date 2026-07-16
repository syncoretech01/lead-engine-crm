"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { ContactsBulkBar } from "@/components/crm/contacts-bulk-bar";
import type { CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";
import type { SdrRosterEntry } from "@/lib/phase1/sdr-roster-read-model";
import {
  contactDisplayName,
  contactNextAction,
  gradeTone,
  priorityTone,
  slaTone,
  type PeekAssignment
} from "@/lib/crm-contact-presentation";

type ContactsTableProps = {
  rows: CrmContactListRow[];
  isSdr: boolean;
  canManage: boolean;
  roster: SdrRosterEntry[];
  callerLabel?: string;
  callBlockReason?: string;
  /** SDR-assignment fields per contact id (SLA, last touch), where assigned. */
  assignments?: Record<string, PeekAssignment>;
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
};

// One comprehensive Contacts directory: the DataTable's functions (search, sort,
// column visibility, pagination, selection + bulk actions) with every field from
// the former All Contacts + My Contacts tables. Clicking a row opens the cockpit
// contact page.
const COLUMN_LABELS: Record<string, string> = {
  name: "Contact",
  company: "Account",
  priority: "Priority",
  channel: "Channel",
  phone: "Phone",
  status: "Status",
  sla: "SLA",
  owner: "Owner",
  score: "Score",
  lastTouch: "Last touch",
  lastActivity: "Last activity"
};

export function ContactsTable({
  rows,
  isSdr,
  canManage,
  roster,
  assignments,
  initialQuery,
  initialSort,
  initialPage
}: ContactsTableProps) {
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<CrmContactListRow, unknown>[]>(() => {
    return [
      {
        id: "name",
        accessorFn: (row) => `${contactDisplayName(row)} ${row.email} ${row.title}`,
        header: "Contact",
        enableHiding: false,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{contactDisplayName(contact)}</span>
              {contact.title ? <span className="text-xs text-muted-foreground">{contact.title}</span> : null}
              {contact.email ? <span className="text-xs text-muted-foreground">{contact.email}</span> : null}
            </div>
          );
        }
      },
      {
        id: "company",
        accessorFn: (row) => `${row.companyName} ${row.domain}`,
        header: "Account",
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <Link
              href={`/crm/accounts/${contact.companyId}`}
              className="flex flex-col"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="font-medium text-foreground">{contact.companyName}</span>
              {contact.domain ? <span className="text-xs text-muted-foreground">{contact.domain}</span> : null}
            </Link>
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
        id: "channel",
        accessorFn: (row) => row.grade,
        header: "Channel",
        enableSorting: false,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge label={contact.grade} tone={gradeTone(contact.grade)} />
              {contact.email ? <StatusBadge label="Email" tone="success" /> : null}
              {contact.phone ? <StatusBadge label="Phone" tone="info" /> : null}
            </div>
          );
        }
      },
      {
        id: "phone",
        accessorFn: (row) => row.phone,
        header: "Phone",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.phone ? (
            <span className="tabular-nums text-muted-foreground">{row.original.phone}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
      },
      {
        id: "status",
        accessorFn: (row) => (isSdr ? contactNextAction(row).label : row.status),
        header: isSdr ? "Next action" : "Status",
        cell: ({ row }) => {
          const contact = row.original;
          if (isSdr) {
            const action = contactNextAction(contact);
            return <StatusBadge label={action.label} tone={action.tone} />;
          }
          return <StatusBadge label={contact.status} />;
        }
      },
      {
        id: "sla",
        accessorFn: (row) => assignments?.[row.id]?.slaStatus ?? "",
        header: "SLA",
        cell: ({ row }) => {
          const sla = assignments?.[row.id]?.slaStatus;
          return sla ? (
            <StatusBadge label={sla} tone={slaTone(sla)} />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        }
      },
      {
        id: "owner",
        accessorFn: (row) => row.owner,
        header: "Owner",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.owner}</span>
      },
      {
        id: "score",
        accessorFn: (row) => row.score,
        header: "Score",
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.score}</span>
      },
      {
        id: "lastTouch",
        accessorFn: (row) => assignments?.[row.id]?.lastTouchLabel ?? "",
        header: "Last touch",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{assignments?.[row.id]?.lastTouchLabel || "—"}</span>
        )
      },
      {
        id: "lastActivity",
        accessorFn: (row) => row.lastActivityAt ?? "",
        header: "Last activity",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.lastActivity}</span>
      }
    ];
  }, [isSdr, assignments]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      columnLabels={COLUMN_LABELS}
      searchPlaceholder="Search contacts, accounts, emails, phones…"
      phoneSearchAccessor={(row) => row.phone}
      initialQuery={initialQuery}
      initialSort={initialSort}
      initialPage={initialPage}
      enableSelection
      onRowClick={(row) => router.push(`/crm/contacts/${row.id}`)}
      renderBulkBar={({ selected, clear }) => (
        <ContactsBulkBar selected={selected} clear={clear} canManage={canManage} roster={roster} />
      )}
      emptyState={
        <EmptyState
          icon={Users}
          title="No contacts match"
          description="Try a different search, or clear the filter to see everyone in scope."
        />
      }
    />
  );
}

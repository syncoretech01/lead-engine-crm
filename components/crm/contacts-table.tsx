"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";
import {
  contactDisplayName,
  contactNextAction,
  gradeTone
} from "@/lib/crm-contact-presentation";

type ContactsTableProps = {
  rows: CrmContactListRow[];
  isSdr: boolean;
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
};

const COLUMN_LABELS: Record<string, string> = {
  name: "Contact",
  company: "Account",
  channel: "Channel",
  score: "Score",
  status: "Status",
  owner: "Owner",
  lastActivity: "Last activity"
};

export function ContactsTable({ rows, isSdr, initialQuery, initialSort, initialPage }: ContactsTableProps) {
  const columns = React.useMemo<ColumnDef<CrmContactListRow, unknown>[]>(() => {
    const defs: ColumnDef<CrmContactListRow, unknown>[] = [
      {
        id: "name",
        accessorFn: (row) => `${contactDisplayName(row)} ${row.email} ${row.title}`,
        header: "Contact",
        enableHiding: false,
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <Link href={`/crm/contacts/${contact.id}`} className="flex flex-col">
              <span className="font-medium text-foreground">{contactDisplayName(contact)}</span>
              <span className="text-xs text-muted-foreground">{contact.title}</span>
              <span className="text-xs text-muted-foreground">{contact.email}</span>
            </Link>
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
            <Link href={`/crm/accounts/${contact.companyId}`} className="flex flex-col">
              <span className="font-medium text-foreground">{contact.companyName}</span>
              <span className="text-xs text-muted-foreground">{contact.domain}</span>
            </Link>
          );
        }
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
        id: "score",
        accessorFn: (row) => row.score,
        header: "Score",
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.score}</span>
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
      }
    ];

    if (!isSdr) {
      defs.push({
        id: "owner",
        accessorFn: (row) => row.owner,
        header: "Owner",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.owner}</span>
      });
    }

    defs.push({
      id: "lastActivity",
      accessorFn: (row) => row.lastActivityAt ?? "",
      header: "Last activity",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.lastActivity}</span>
    });

    return defs;
  }, [isSdr]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      columnLabels={COLUMN_LABELS}
      searchPlaceholder="Search contacts, accounts, emails…"
      initialQuery={initialQuery}
      initialSort={initialSort}
      initialPage={initialPage}
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

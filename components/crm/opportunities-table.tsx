"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleDollarSign } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { statusTone } from "@/components/status-pill";

// Serializable row; custom forecast fields are flattened to {name,value} pairs
// server-side, and money/date are pre-formatted.
export type OpportunityRow = {
  id: string;
  name: string;
  source: string;
  lastActivity: string;
  companyId: string;
  companyName: string;
  contactName: string;
  stage: string;
  amount: number;
  amountLabel: string;
  closeLabel: string;
  closeAt: string;
  owner: string;
  fields: { name: string; value: string }[];
};

export function OpportunitiesTable({
  rows,
  isSdr,
  initialQuery,
  initialSort,
  initialPage
}: {
  rows: OpportunityRow[];
  isSdr: boolean;
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
}) {
  const columns = React.useMemo<ColumnDef<OpportunityRow, unknown>[]>(() => {
    const defs: ColumnDef<OpportunityRow, unknown>[] = [
      {
        id: "opportunity",
        accessorFn: (row) => `${row.name} ${row.source}`,
        header: "Opportunity",
        enableHiding: false,
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{o.name}</span>
              <span className="text-xs text-muted-foreground">{o.source}</span>
              <span className="text-xs text-muted-foreground">{o.lastActivity}</span>
            </div>
          );
        }
      },
      {
        id: "account",
        accessorFn: (row) => `${row.companyName} ${row.contactName}`,
        header: "Account",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <Link href={`/crm/accounts/${o.companyId}`} className="flex flex-col">
              <span className="font-medium text-foreground">{o.companyName}</span>
              <span className="text-xs text-muted-foreground">{o.contactName}</span>
            </Link>
          );
        }
      },
      {
        id: "stage",
        accessorFn: (row) => row.stage,
        header: "Stage",
        cell: ({ row }) => <StatusBadge label={row.original.stage} tone={statusTone(row.original.stage)} />
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount,
        header: "Amount",
        cell: ({ row }) => <span className="tabular-nums text-foreground">{row.original.amountLabel}</span>
      },
      {
        id: "close",
        accessorFn: (row) => row.closeAt,
        header: "Close",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.closeLabel}</span>
      }
    ];

    if (!isSdr) {
      defs.push(
        {
          id: "owner",
          accessorFn: (row) => row.owner,
          header: "Owner",
          cell: ({ row }) => <span className="text-muted-foreground">{row.original.owner}</span>
        },
        {
          id: "fields",
          header: "Fields",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-2">
              {row.original.fields.map((field) => (
                <StatusBadge key={field.name} label={`${field.name}: ${field.value}`} tone="default" />
              ))}
            </div>
          )
        }
      );
    }

    return defs;
  }, [isSdr]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      searchPlaceholder="Search opportunities, accounts…"
      initialQuery={initialQuery}
      initialSort={initialSort}
      initialPage={initialPage}
      emptyState={
        <EmptyState
          icon={CircleDollarSign}
          title="No opportunities match"
          description="Try a different search, or clear the filter."
        />
      }
    />
  );
}

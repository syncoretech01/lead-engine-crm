"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2 } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { FastCrmAccountView } from "@/lib/phase1/crm-overview-read-model";
import { formatCurrency, formatNumber } from "@/lib/utils";

export function AccountsTable({
  rows,
  isSdr,
  initialQuery,
  initialSort,
  initialPage
}: {
  rows: FastCrmAccountView[];
  isSdr: boolean;
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
}) {
  const columns = React.useMemo<ColumnDef<FastCrmAccountView, unknown>[]>(() => {
    const defs: ColumnDef<FastCrmAccountView, unknown>[] = [
      {
        id: "account",
        accessorFn: (row) => `${row.name} ${row.domain} ${row.industry} ${row.location}`,
        header: "Account",
        enableHiding: false,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <Link href={`/crm/accounts/${a.id}`} className="flex flex-col">
              <span className="font-medium text-foreground">{a.name}</span>
              <span className="text-xs text-muted-foreground">{a.domain}</span>
              <span className="text-xs text-muted-foreground">{a.location || a.industry}</span>
            </Link>
          );
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

    defs.push(
      {
        id: "stage",
        accessorFn: (row) => row.stage,
        header: "Stage",
        cell: ({ row }) => <StatusBadge label={row.original.stage} />
      },
      {
        id: "contacts",
        accessorFn: (row) => row.contacts,
        header: "Contacts",
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatNumber(row.original.contacts)}</span>
      },
      {
        id: "openWork",
        accessorFn: (row) => row.openTasks,
        header: "Open work",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{formatNumber(row.original.openTasks)} tasks</span>
            <span className="text-xs text-muted-foreground">{row.original.lastActivity}</span>
          </div>
        )
      }
    );

    if (!isSdr) {
      defs.push({
        id: "pipeline",
        accessorFn: (row) => row.amount,
        header: "Pipeline",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">{formatCurrency(row.original.amount)}</span>
        )
      });
    }

    defs.push({
      id: "source",
      accessorFn: (row) => row.source,
      header: "Source",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.source}</span>
    });

    return defs;
  }, [isSdr]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      searchPlaceholder="Search accounts, domains, industries…"
      initialQuery={initialQuery}
      initialSort={initialSort}
      initialPage={initialPage}
      emptyState={
        <EmptyState
          icon={Building2}
          title="No accounts match"
          description="Try a different search, or clear the filter."
        />
      }
    />
  );
}

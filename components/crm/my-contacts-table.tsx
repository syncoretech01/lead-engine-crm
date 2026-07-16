"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { UserCheck } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SoftphoneButton } from "@/components/softphone-button";
import { RecordPeek } from "@/components/crm/record-peek";
import { ContactPeekContent } from "@/components/crm/contact-peek-content";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";

// Serializable row: relative-time labels are precomputed server-side to avoid
// client Date.now() drift.
export type MyContactRow = {
  contactId: string;
  contactName: string;
  title: string;
  email: string;
  phone: string;
  grade: string;
  gradeTone: BadgeTone;
  priority: string;
  priorityTone: BadgeTone;
  status: string;
  slaStatus: string;
  slaTone: BadgeTone;
  companyId: string;
  companyName: string;
  companyDomain: string;
  assignedRelative: string;
  assignedDate: string;
  assignedAt: string;
  lastTouchLabel: string;
  lastTouchAt: string;
  ownerName: string;
  notes: string;
};

export function MyContactsTable({
  rows,
  isSdr,
  callerLabel,
  callBlockReason,
  initialQuery,
  initialSort,
  initialPage
}: {
  rows: MyContactRow[];
  isSdr: boolean;
  callerLabel?: string;
  callBlockReason?: string;
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
}) {
  const [peekQueue, setPeekQueue] = React.useState<{
    rows: MyContactRow[];
    index: number;
    returnTo: string;
  } | null>(null);
  const peekContact = peekQueue?.rows[peekQueue.index] ?? null;
  const movePeek = React.useCallback((offset: number) => {
    setPeekQueue((current) => {
      if (!current) return current;
      const nextIndex = current.index + offset;
      if (nextIndex < 0 || nextIndex >= current.rows.length) return current;
      return { ...current, index: nextIndex };
    });
  }, []);
  const columns = React.useMemo<ColumnDef<MyContactRow, unknown>[]>(() => {
    const defs: ColumnDef<MyContactRow, unknown>[] = [
      {
        id: "contact",
        accessorFn: (row) => `${row.contactName} ${row.email} ${row.title}`,
        header: "Contact",
        enableHiding: false,
        cell: ({ row }) => {
          const c = row.original;
          // Row click opens the peek; the name is part of that affordance.
          return (
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{c.contactName}</span>
              {c.title ? <span className="text-xs text-muted-foreground">{c.title}</span> : null}
              {c.email ? <span className="text-xs text-muted-foreground">{c.email}</span> : null}
            </div>
          );
        }
      },
      {
        id: "company",
        accessorFn: (row) => `${row.companyName} ${row.companyDomain}`,
        header: "Account",
        cell: ({ row }) => {
          const c = row.original;
          return c.companyId ? (
            <Link
              href={`/crm/accounts/${c.companyId}`}
              className="flex flex-col"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="font-medium text-foreground">{c.companyName}</span>
              {c.companyDomain ? (
                <span className="text-xs text-muted-foreground">{c.companyDomain}</span>
              ) : null}
            </Link>
          ) : (
            <span className="text-foreground">{c.companyName}</span>
          );
        }
      },
      {
        id: "priority",
        accessorFn: (row) => row.priority,
        header: "Priority",
        cell: ({ row }) => <StatusBadge label={row.original.priority} tone={row.original.priorityTone} />
      },
      {
        id: "channel",
        accessorFn: (row) => row.grade,
        header: "Channel",
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge label={c.grade} tone={c.gradeTone} />
              {c.email ? <StatusBadge label="Email" tone="success" /> : null}
              {c.phone ? <StatusBadge label="Phone" tone="info" /> : null}
            </div>
          );
        }
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => <StatusBadge label={row.original.status} />
      },
      {
        id: "sla",
        accessorFn: (row) => row.slaStatus,
        header: "SLA",
        cell: ({ row }) => <StatusBadge label={row.original.slaStatus} tone={row.original.slaTone} />
      },
      {
        id: "assigned",
        accessorFn: (row) => row.assignedAt,
        header: "Assigned",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-foreground">{row.original.assignedRelative}</span>
            <span className="text-xs text-muted-foreground">{row.original.assignedDate}</span>
          </div>
        )
      },
      {
        id: "lastTouch",
        accessorFn: (row) => row.lastTouchAt,
        header: "Last touch",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.lastTouchLabel}</span>
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
      id: "call",
      header: () => <span className="sr-only">Call</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const c = row.original;
        // Calling is its own affordance — don't let it open the row peek.
        return (
          <div className="text-right" onClick={(event) => event.stopPropagation()}>
            <SoftphoneButton
              contactId={c.contactId}
              contactName={c.contactName}
              phone={c.phone}
              callerLabel={callerLabel}
              blockReason={callBlockReason}
              iconOnly
            />
          </div>
        );
      }
    });

    return defs;
  }, [isSdr, callerLabel, callBlockReason]);

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.contactId}
        searchPlaceholder="Search assigned contacts or phones…"
        phoneSearchAccessor={(row) => row.phone}
        initialQuery={initialQuery}
        initialSort={initialSort}
        initialPage={initialPage}
        onRowClick={(row, context) => {
          const index = context.index >= 0 ? context.index : context.rows.findIndex((item) => item.contactId === row.contactId);
          setPeekQueue({
            rows: context.rows,
            index: Math.max(index, 0),
            returnTo: currentMyContactsHref()
          });
        }}
        emptyState={
          <EmptyState
            icon={UserCheck}
            title="No assigned contacts match"
            description="Try a different search, or clear the filter."
          />
        }
      />
      <RecordPeek
        open={peekContact !== null}
        onOpenChange={(open) => {
          if (!open) setPeekQueue(null);
        }}
        title={peekContact ? peekContact.contactName : "Contact"}
        description="Contact quick view"
      >
        {peekContact ? (
          <ContactPeekContent
            contact={{
              id: peekContact.contactId,
              name: peekContact.contactName,
              title: peekContact.title,
              email: peekContact.email,
              phone: peekContact.phone,
              companyId: peekContact.companyId,
              companyName: peekContact.companyName,
              status: peekContact.status,
              grade: peekContact.grade,
              gradeTone: peekContact.gradeTone,
              priority: peekContact.priority,
              priorityTone: peekContact.priorityTone,
              owner: peekContact.ownerName,
              notes: peekContact.notes,
              assignment: {
                slaStatus: peekContact.slaStatus,
                slaTone: peekContact.slaTone,
                assignedRelative: peekContact.assignedRelative,
                lastTouchLabel: peekContact.lastTouchLabel
              }
            }}
            callerLabel={callerLabel}
            callBlockReason={callBlockReason}
            detailHref={detailHrefForMyContact(peekContact.contactId, peekQueue?.returnTo)}
            queueNavigation={
              peekQueue
                ? {
                    onPrevious: peekQueue.index > 0 ? () => movePeek(-1) : undefined,
                    onNext: peekQueue.index < peekQueue.rows.length - 1 ? () => movePeek(1) : undefined,
                    positionLabel: `${peekQueue.index + 1} of ${peekQueue.rows.length}`
                  }
                : undefined
            }
          />
        ) : null}
      </RecordPeek>
    </>
  );
}

function currentMyContactsHref() {
  if (typeof window === "undefined") {
    return "/crm/my-contacts";
  }

  return `${window.location.pathname}${window.location.search}`;
}

function detailHrefForMyContact(contactId: string, returnTo?: string) {
  const params = new URLSearchParams();
  params.set("source", "my-contacts");
  params.set("returnTo", returnTo || "/crm/my-contacts");

  try {
    const url = new URL(returnTo || "/crm/my-contacts", "http://syncore.local");
    for (const key of ["q", "sort", "page", "sdr"]) {
      const value = url.searchParams.get(key);
      if (value) {
        params.set(key, value);
      }
    }
  } catch {
    // The return URL is only for convenience; fall back to the base list.
  }

  return `/crm/my-contacts/${contactId}?${params.toString()}`;
}

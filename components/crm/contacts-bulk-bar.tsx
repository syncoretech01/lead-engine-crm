"use client";

import * as React from "react";
import { Check, Download, Loader2, UserCog, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { exportRowsToCsv } from "@/components/data-table/export-csv";
import { bulkReassignContactsAction, bulkUpdateContactStatusAction } from "@/app/actions";
import type { CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";
import type { SdrRosterEntry } from "@/lib/phase1/sdr-roster-read-model";

// Curated subset of LeadStatus values that make sense as a bulk transition.
const BULK_STATUSES = [
  "Working",
  "Contacted",
  "Interested",
  "Meeting Booked",
  "Qualified",
  "Nurture",
  "Disqualified"
] as const;

const CSV_COLUMNS = [
  { header: "Name", value: (row: CrmContactListRow) => row.name },
  { header: "Title", value: (row: CrmContactListRow) => row.title },
  { header: "Email", value: (row: CrmContactListRow) => row.email },
  { header: "Phone", value: (row: CrmContactListRow) => row.phone },
  { header: "Account", value: (row: CrmContactListRow) => row.companyName },
  { header: "Domain", value: (row: CrmContactListRow) => row.domain },
  { header: "Grade", value: (row: CrmContactListRow) => row.grade },
  { header: "Status", value: (row: CrmContactListRow) => row.status },
  { header: "Owner", value: (row: CrmContactListRow) => row.owner }
];

export function ContactsBulkBar({
  selected,
  clear,
  canManage,
  roster
}: {
  selected: CrmContactListRow[];
  clear: () => void;
  canManage: boolean;
  roster: SdrRosterEntry[];
}) {
  const [isPending, startTransition] = React.useTransition();
  const contactIds = React.useMemo(() => selected.map((row) => row.id), [selected]);

  const runAssign = (nextSdrId: string) => {
    startTransition(async () => {
      const result = await bulkReassignContactsAction({ contactIds, nextSdrId });
      if (result.ok) {
        toast.success(result.message ?? "Contacts reassigned");
        clear();
      } else {
        toast.error(result.error);
      }
    });
  };

  const runStatus = (status: (typeof BULK_STATUSES)[number]) => {
    startTransition(async () => {
      const result = await bulkUpdateContactStatusAction({ contactIds, status });
      if (result.ok) {
        toast.success(result.message ?? "Status updated");
        clear();
      } else {
        toast.error(result.error);
      }
    });
  };

  const exportCsv = () => {
    exportRowsToCsv(selected, CSV_COLUMNS, `contacts-${selected.length}.csv`);
    toast.success(`Exported ${selected.length} contacts`);
  };

  return (
    <div className="flex items-center gap-1.5">
      {canManage ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <UserCog />}
                Assign SDR
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="max-h-72 overflow-auto">
              <DropdownMenuLabel>Assign {contactIds.length} to…</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {roster.length === 0 ? (
                <DropdownMenuItem disabled>No SDRs available</DropdownMenuItem>
              ) : (
                roster.map((sdr) => (
                  <DropdownMenuItem key={sdr.id} onSelect={() => runAssign(sdr.id)}>
                    {sdr.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <Check />}
                Set status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuLabel>Set status to…</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {BULK_STATUSES.map((status) => (
                <DropdownMenuItem key={status} onSelect={() => runStatus(status)}>
                  {status}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      <Button variant="ghost" size="sm" onClick={exportCsv}>
        <Download />
        Export CSV
      </Button>

      <Button variant="ghost" size="icon-sm" onClick={clear} aria-label="Clear selection">
        <X />
      </Button>
    </div>
  );
}

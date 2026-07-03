import Link from "next/link";
import { AlertTriangle, Building2, ClipboardList, Flame, Mail, Phone, UserCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { readAssignedContactsModel } from "@/lib/phase1/assigned-contacts-read-model";
import { assignedContactsSnapshot, sdrUsers } from "@/lib/phase1/sdr";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { cn, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

// The subset of the SDR-queue / file-store assignment row this table renders.
// Both read models (prisma SdrQueueAssignmentReadRow and the file-store
// assignmentViews row) are structural supersets of this shape.
type AssignedRow = {
  contactId: string;
  contactName: string;
  title: string;
  email: string;
  phone: string;
  grade: string;
  priority: string;
  status: string;
  slaStatus: string;
  companyId: string;
  companyName: string;
  companyDomain: string;
  assignedAt: string;
  lastTouchAt?: string;
  touchCount: number;
  ownerName: string;
};

export default async function MyContactsPage({
  searchParams
}: {
  searchParams: Promise<{ sdr?: string }>;
}) {
  const { sdr } = await searchParams;
  const sessionContext = await getWorkspaceSessionContext("manage_sdr");
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  const isSdr = session.role === "SDR";
  const sdrFilter = isSdr ? undefined : sdr || undefined;

  let rows: AssignedRow[];
  let roster: Array<{ id: string; name: string }> = [];

  const fast = await readAssignedContactsModel(session, workspaceId, { sdrId: sdrFilter });
  if (fast) {
    rows = fast.rows;
    roster = fast.roster;
  } else {
    const ctx = await getWorkspaceContext("manage_sdr");
    session = ctx.session;
    workspaceId = ctx.workspaceId;
    const ownerId = ctx.session.role === "SDR" ? ctx.session.user.id : sdrFilter;
    rows = assignedContactsSnapshot(ctx.state, workspaceId, ownerId);
    roster = ctx.session.role === "SDR"
      ? []
      : sdrUsers(ctx.state, workspaceId).map((user) => ({ id: user.id, name: user.name }));
  }

  const overdue = rows.filter((row) => row.slaStatus === "Overdue").length;
  const p1 = rows.filter((row) => row.priority === "P1").length;
  const activeSdrName = sdrFilter ? roster.find((user) => user.id === sdrFilter)?.name : undefined;

  return (
    <>
      <PageHeader
        kicker="CRM Execution"
        title={isSdr ? "My assigned contacts" : "Assigned contacts"}
        copy={
          isSdr
            ? "Every contact currently assigned to you — newest assignment first. Open a contact to log touches, call, and track SLA."
            : "Every assigned contact across the SDR team, newest first. Filter by SDR to review one rep's book."
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/sdr/queue">
              <ClipboardList aria-hidden="true" />
              {isSdr ? "My queue" : "SDR queue"}
            </Link>
          </Button>
        }
      />

      <section aria-label="Assigned contact metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={UserCheck}
          tone="info"
          label={isSdr ? "Assigned to me" : activeSdrName ? `Assigned to ${activeSdrName}` : "Assigned (team)"}
          value={formatNumber(rows.length)}
          note="Contacts in this view"
        />
        <StatCard
          icon={AlertTriangle}
          tone={overdue > 0 ? "danger" : "success"}
          label="Overdue SLA"
          value={formatNumber(overdue)}
          note="First touch or follow-up past due"
        />
        <StatCard
          icon={Flame}
          tone={p1 > 0 ? "warning" : "default"}
          label="P1 priority"
          value={formatNumber(p1)}
          note="Highest-priority assignments"
        />
      </section>

      <Panel
        title="Assigned contacts"
        subtitle="Sorted by assignment date — newest on top."
        action={
          !isSdr && roster.length > 0 ? (
            <form method="get" className="flex items-center gap-2">
              <label className="sr-only" htmlFor="sdr-filter">
                Filter by SDR
              </label>
              <select
                id="sdr-filter"
                name="sdr"
                defaultValue={sdrFilter ?? ""}
                className={cn(fieldClass, "h-8 w-44")}
              >
                <option value="">All SDRs</option>
                {roster.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Filter
              </button>
            </form>
          ) : (
            <StatusBadge label={`${formatNumber(rows.length)} contacts`} tone="info" />
          )
        }
        flush
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead>Last touch</TableHead>
              {!isSdr ? <TableHead>Owner</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.contactId || `${row.contactName}-${row.assignedAt}`}>
                <TableCell>
                  <Link href={`/crm/contacts/${row.contactId}`} className="flex flex-col">
                    <span className="font-medium text-foreground">{row.contactName}</span>
                    {row.title ? <span className="text-xs text-muted-foreground">{row.title}</span> : null}
                    {row.email ? <span className="text-xs text-muted-foreground">{row.email}</span> : null}
                  </Link>
                </TableCell>
                <TableCell>
                  {row.companyId ? (
                    <Link href={`/crm/accounts/${row.companyId}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{row.companyName}</span>
                      {row.companyDomain ? (
                        <span className="text-xs text-muted-foreground">{row.companyDomain}</span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="text-foreground">{row.companyName}</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge label={row.priority} tone={priorityTone(row.priority)} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge label={row.grade} tone={gradeTone(row.grade)} />
                    {row.email ? <StatusBadge label="Email" tone="success" /> : null}
                    {row.phone ? <StatusBadge label="Phone" tone="info" /> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge label={row.status} />
                </TableCell>
                <TableCell>
                  <StatusBadge label={row.slaStatus} tone={slaTone(row.slaStatus)} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-foreground">{relativeSince(row.assignedAt)}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(row.assignedAt)}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.lastTouchAt ? relativeSince(row.lastTouchAt) : "No touches"}
                  {row.touchCount > 0 ? ` · ${row.touchCount}` : ""}
                </TableCell>
                {!isSdr ? <TableCell className="text-muted-foreground">{row.ownerName}</TableCell> : null}
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isSdr ? 8 : 9} className="text-muted-foreground">
                  {isSdr
                    ? "No contacts are assigned to you yet."
                    : sdrFilter
                      ? "No contacts assigned to this SDR."
                      : "No SDR assignments in this workspace yet."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Panel>
    </>
  );
}

function gradeTone(grade: string): BadgeTone {
  if (grade === "A" || grade === "B") return "success";
  if (grade === "C" || grade === "D") return "warning";
  return "default";
}

function priorityTone(priority: string): BadgeTone {
  if (priority === "P1") return "danger";
  if (priority === "P2") return "warning";
  return "info";
}

function slaTone(sla: string): BadgeTone {
  if (sla === "Overdue") return "danger";
  if (sla === "Due soon") return "warning";
  if (sla === "On track") return "success";
  return "default";
}

function relativeSince(iso?: string): string {
  if (!iso) return "—";
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "—";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

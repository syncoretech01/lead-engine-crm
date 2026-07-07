import Link from "next/link";
import { AlertTriangle, Building2, ClipboardList, Flame, Mail, Phone, UserCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { MyContactsTable, type MyContactRow } from "@/components/crm/my-contacts-table";
import { TileGrid, TileItem } from "@/components/tile-grid";
import { canCustomizeTiles, readUserTileLayout } from "@/lib/phase1/tile-layouts";
import { readAssignedContactsModel } from "@/lib/phase1/assigned-contacts-read-model";
import { assignedContactsSnapshot, sdrUsers } from "@/lib/phase1/sdr";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import {
  resolveUserTelephonyIdentity,
  telephonyIdentityBlockReason
} from "@/lib/phase1/telephony-identities";
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
  searchParams: Promise<{ sdr?: string; q?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const sdr = sp.sdr;
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

  // Caller line for the dialer: the current user's own RingCentral number.
  const callerIdentity = resolveUserTelephonyIdentity(session.user);
  const callerLabel = callerIdentity
    ? `${callerIdentity.displayName} · ${callerIdentity.phoneNumber}`
    : undefined;
  const callBlockReason = callerIdentity ? undefined : telephonyIdentityBlockReason(session.user);

  const canCustomize = canCustomizeTiles(session);
  const savedLayout = await readUserTileLayout(session.user.id, "crm-my-contacts");

  const tableRows: MyContactRow[] = rows.map((row) => ({
    contactId: row.contactId,
    contactName: row.contactName,
    title: row.title,
    email: row.email,
    phone: row.phone,
    grade: row.grade,
    gradeTone: gradeTone(row.grade),
    priority: row.priority,
    priorityTone: priorityTone(row.priority),
    status: row.status,
    slaStatus: row.slaStatus,
    slaTone: slaTone(row.slaStatus),
    companyId: row.companyId,
    companyName: row.companyName,
    companyDomain: row.companyDomain,
    assignedRelative: relativeSince(row.assignedAt),
    assignedDate: formatDate(row.assignedAt),
    assignedAt: row.assignedAt,
    lastTouchLabel: `${row.lastTouchAt ? relativeSince(row.lastTouchAt) : "No touches"}${row.touchCount > 0 ? ` · ${row.touchCount}` : ""}`,
    lastTouchAt: row.lastTouchAt ?? "",
    ownerName: row.ownerName
  }));

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

      <TileGrid pageKey="crm-my-contacts" canCustomize={canCustomize} saved={savedLayout}>
        <TileItem id="metric-assigned" x={0} y={0} w={4} h={2} minW={2}>
          <StatCard
            fill
            icon={UserCheck}
            tone="info"
            label={isSdr ? "Assigned to me" : activeSdrName ? `Assigned to ${activeSdrName}` : "Assigned (team)"}
            value={formatNumber(rows.length)}
            note="Contacts in this view"
          />
        </TileItem>
        <TileItem id="metric-overdue" x={4} y={0} w={4} h={2} minW={2}>
          <StatCard
            fill
            icon={AlertTriangle}
            tone={overdue > 0 ? "danger" : "success"}
            label="Overdue SLA"
            value={formatNumber(overdue)}
            note="First touch or follow-up past due"
          />
        </TileItem>
        <TileItem id="metric-p1" x={8} y={0} w={4} h={2} minW={2}>
          <StatCard
            fill
            icon={Flame}
            tone={p1 > 0 ? "warning" : "default"}
            label="P1 priority"
            value={formatNumber(p1)}
            note="Highest-priority assignments"
          />
        </TileItem>
      </TileGrid>

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
        <MyContactsTable
          rows={tableRows}
          isSdr={isSdr}
          callerLabel={callerLabel}
          callBlockReason={callBlockReason}
          initialQuery={sp.q}
          initialSort={sp.sort}
          initialPage={sp.page ? Math.max(0, Number(sp.page) - 1) : 0}
        />
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

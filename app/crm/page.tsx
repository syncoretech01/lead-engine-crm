import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Mail,
  Megaphone,
  Phone,
  Target,
  Users
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MeterBar } from "@/components/ui/meter-bar";
import { Panel } from "@/components/ui/panel";
import { StatCard, ToneIcon } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import {
  readFastCrmOverviewModel,
  type FastCrmAccountView,
  type FastCrmCampaignSummary,
  type FastCrmContactSummary,
  type FastCrmOpportunityView
} from "@/lib/phase1/crm-overview-read-model";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { accountViewsForWorkspace, contactViewsForWorkspace, opportunityViews, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { sdrQueueSnapshot } from "@/lib/phase1/sdr";
import { readFastSdrQueueModel, type SdrQueueReadModel } from "@/lib/phase1/sdr-queue-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { TileGrid, TileItem } from "@/components/tile-grid";
import { canCustomizeTiles, readUserTileLayout } from "@/lib/phase1/tile-layouts";
import type { OpportunityStage } from "@/lib/phase1/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CrmDashboardPage() {
  const sessionContext = await getWorkspaceSessionContext("manage_crm");
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let accounts: FastCrmAccountView[] = [];
  let contacts: FastCrmContactSummary[] = [];
  let opportunities: FastCrmOpportunityView[] = [];
  let activeCampaigns: FastCrmCampaignSummary[] = [];
  let queueSnapshot: DashboardQueueSnapshot | undefined;
  let taskDueToday = 0;
  let taskOverdue = 0;
  const canManageSdr = session.permissions.includes("manage_sdr");
  const canManageOutreach = session.permissions.includes("manage_outreach");
  const fastModel = await readFastCrmOverviewModel(session, workspaceId);

  if (fastModel) {
    accounts = fastModel.accounts;
    contacts = fastModel.contacts;
    opportunities = fastModel.opportunities;
    activeCampaigns = fastModel.activeCampaigns;
    taskDueToday = fastModel.dueToday;
    taskOverdue = fastModel.overdue;
    if (canManageSdr) {
      queueSnapshot = (await readFastSdrQueueModel(session, workspaceId))?.snapshot;
    }
  } else {
    const context = await getWorkspaceContext("manage_crm");
    const state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
    const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
    const [allAccounts, allContacts] = await Promise.all([
      accountViewsForWorkspace(readState, workspaceId),
      contactViewsForWorkspace(readState, workspaceId)
    ]);
    const ownedScope = restrictsToOwnedRecords(session) ? ownedCrmRecordScope(readState, session) : null;
    accounts = ownedScope ? allAccounts.filter((account) => ownedScope.companyIds.has(account.id)) : allAccounts;
    contacts = ownedScope ? allContacts.filter((contact) => ownedScope.contactIds.has(contact.id)) : allContacts;
    opportunities = ownedScope
      ? opportunityViews(readState, workspaceId).filter((opportunity) => opportunity.ownerUserId === session.user.id)
      : opportunityViews(readState, workspaceId);
    const ownerFilter = session.role === "SDR" ? session.user.id : undefined;
    queueSnapshot = canManageSdr ? sdrQueueSnapshot(readState, workspaceId, ownerFilter) : undefined;
    taskDueToday = openTasksDueToday(readState.tasks, workspaceId);
    taskOverdue = readState.tasks.filter((task) => task.workspaceId === workspaceId && task.status === "Overdue").length;
    activeCampaigns = readState.outreachCampaigns.filter(
      (campaign) => campaign.workspaceId === workspaceId && campaign.status === "Active"
    );
  }
  const openOpportunities = opportunities.filter((opportunity) => !isClosedStage(opportunity.stage));
  const activeAssignments = queueSnapshot?.metrics.assigned ?? 0;
  const dueToday = queueSnapshot?.metrics.dueToday ?? taskDueToday;
  const overdue = queueSnapshot?.metrics.overdue ?? taskOverdue;
  const openPipeline = openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
  const weightedForecast = openOpportunities.reduce(
    (total, opportunity) => total + Math.round(opportunity.amount * (opportunity.probability / 100)),
    0
  );
  const priorityAssignments = [...(queueSnapshot?.assignments ?? [])]
    .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority))
    .slice(0, 8);
  const accountWatchlist = [...accounts]
    .sort((a, b) => b.openTasks - a.openTasks || b.score - a.score)
    .slice(0, 6);
  const pipelineWatchlist = [...openOpportunities]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const canCustomize = canCustomizeTiles(session);
  const savedLayout = await readUserTileLayout(session.user.id, "crm-dashboard");

  const metrics = [
    {
      label: session.role === "SDR" ? "My active leads" : "Assigned leads",
      value: formatNumber(activeAssignments),
      note: `${formatNumber(queueSnapshot?.metrics.p1 ?? 0)} P1 leads in queue`,
      icon: ClipboardList,
      tone: activeAssignments ? "info" as const : "success" as const
    },
    {
      label: "Due today",
      value: formatNumber(dueToday),
      note: overdue ? `${formatNumber(overdue)} overdue items need attention` : "No overdue work",
      icon: CalendarClock,
      tone: overdue ? "warning" as const : "success" as const
    },
    {
      label: "Open pipeline",
      value: formatCurrency(openPipeline),
      note: `${formatCurrency(weightedForecast)} weighted forecast`,
      icon: CircleDollarSign,
      tone: "success" as const
    },
    {
      label: "CRM accounts",
      value: formatNumber(accounts.length),
      note: `${formatNumber(contacts.length)} contacts linked to accounts`,
      icon: Building2,
      tone: "info" as const
    }
  ];

  const lanes = [
    {
      label: "Priority work",
      value: activeAssignments,
      note: `${formatNumber(dueToday)} due today`,
      icon: ClipboardList,
      tone: overdue ? "warning" as const : "info" as const
    },
    {
      label: "Open deals",
      value: openOpportunities.length,
      note: formatCurrency(openPipeline),
      icon: CircleDollarSign,
      tone: "success" as const
    },
    {
      label: "Accounts",
      value: accounts.length,
      note: `${formatNumber(accountWatchlist.length)} on watchlist`,
      icon: Building2,
      tone: "info" as const
    },
    {
      label: "Campaigns",
      value: activeCampaigns.length,
      note: "Active outreach lanes",
      icon: Megaphone,
      tone: activeCampaigns.length ? "info" as const : "success" as const
    }
  ];

  const workspaceCards = [
    {
      title: "Work my queue",
      copy: "First touches, follow-ups, overdue work, and next actions for active SDR assignments.",
      href: "/sdr/queue",
      count: activeAssignments,
      label: "active",
      icon: ClipboardList,
      visible: canManageSdr
    },
    {
      title: "Review accounts",
      copy: "Golden company records with owner, stage, source, contacts, tasks, and account detail.",
      href: "/crm/accounts",
      count: accounts.length,
      label: "accounts",
      icon: Building2,
      visible: true
    },
    {
      title: "Open contacts",
      copy: "Contact records with verification, enrichment, activity, consent, and account context.",
      href: "/crm/contacts",
      count: contacts.length,
      label: "contacts",
      icon: Users,
      visible: true
    },
    {
      title: "Manage pipeline",
      copy: "Opportunity stages, amounts, forecast, owners, and source-attributed revenue.",
      href: "/crm/opportunities",
      count: openOpportunities.length,
      label: "open",
      icon: CircleDollarSign,
      visible: true
    },
    {
      title: "Run campaigns",
      copy: "Campaigns, sequences, deliverability, and outreach events for CRM contacts.",
      href: "/outreach/campaigns",
      count: activeCampaigns.length,
      label: "active",
      icon: Megaphone,
      visible: canManageOutreach
    }
  ];

  const infoCards = [
    {
      icon: Target,
      title: "No backend controls",
      copy: "Provider settings, compliance admin, reports, and automation stay in the Admin view."
    },
    {
      icon: Users,
      title: "SDR focused",
      copy: "SDRs land on assigned work, contact context, due dates, and outreach lanes."
    },
    {
      icon: BarChart3,
      title: "Manager ready",
      copy: "Managers can jump from this workspace into queue health, reassignment, and pipeline views."
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title="CRM workspace"
        copy="A focused workspace for SDRs and managers: work assigned leads, inspect accounts and contacts, manage opportunities, and keep outreach tied to CRM activity."
        actions={
          <>
            {canManageSdr ? (
              <Button asChild variant="outline">
                <Link href="/sdr/queue">
                  <ClipboardList aria-hidden="true" />
                  Open queue
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/crm/opportunities">
                <CircleDollarSign aria-hidden="true" />
                Pipeline
              </Link>
            </Button>
          </>
        }
      />

      <TileGrid pageKey="crm-dashboard" canCustomize={canCustomize} saved={savedLayout}>
        {metrics.map((metric, index) => (
          <TileItem key={`metric-${index}`} id={`metric-${index}`} x={index * 3} y={0} w={3} h={2} minW={2}>
            <StatCard
              fill
              icon={metric.icon}
              label={metric.label}
              value={metric.value}
              note={metric.note}
              tone={metric.tone}
            />
          </TileItem>
        ))}
        {lanes.map((lane, index) => (
          <TileItem key={`lane-${index}`} id={`lane-${index}`} x={index * 3} y={2} w={3} h={2} minW={2}>
            <div className="bg-card flex h-full items-center gap-3 rounded-xl border p-4 shadow-sm">
              <ToneIcon icon={lane.icon} tone={lane.tone} />
              <div className="min-w-0">
                <div className="text-lg font-semibold text-foreground">{formatNumber(lane.value)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {lane.label} · {lane.note}
                </div>
              </div>
            </div>
          </TileItem>
        ))}
        {workspaceCards
          .filter((card) => card.visible)
          .map((card, index) => {
            const Icon = card.icon;
            return (
              <TileItem
                key={card.title}
                id={`shortcut-${index}`}
                x={(index % 3) * 4}
                y={4 + Math.floor(index / 3) * 3}
                w={4}
                h={3}
                minW={3}
              >
                <Link
                  href={card.href}
                  className="group bg-card flex h-full flex-col gap-4 rounded-xl border p-5 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">{card.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{card.copy}</p>
                    </div>
                    <ToneIcon icon={Icon} tone="info" />
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <StatusBadge label={`${formatNumber(card.count)} ${card.label}`} tone={card.count ? "info" : "default"} />
                    <ArrowRight
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              </TileItem>
            );
          })}

        <TileItem id="priority-work" x={0} y={10} w={6} h={9} minW={4} minH={5}>
        <Panel
          title={session.role === "SDR" ? "My priority work" : "Priority SDR work"}
          subtitle="Highest-priority assigned leads, recommended channel, and next due date."
          action={
            <Button asChild variant="ghost" size="icon" aria-label="Open SDR queue">
              <Link href="/sdr/queue">
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
          flush
          fill
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {priorityAssignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>
                    <Link href={`/crm/contacts/${assignment.contactId}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{assignment.contactName}</span>
                      <span className="text-xs text-muted-foreground">{assignment.title}</span>
                      <span className="text-xs text-muted-foreground">{assignment.companyName}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{assignment.ownerName}</TableCell>
                  <TableCell>
                    <StatusBadge label={assignment.priority} tone={assignment.priority === "P1" ? "success" : "info"} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{assignment.reminderTitle ?? "First touch"}</span>
                      <span className="text-xs text-muted-foreground">
                        {assignment.dueAt ? formatDate(assignment.dueAt) : assignment.dueLabel}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {priorityAssignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No active SDR assignments are waiting right now.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
        </TileItem>
        <TileItem id="pipeline-snapshot" x={6} y={10} w={6} h={9} minW={4} minH={5}>
        <Panel
          title="Pipeline snapshot"
          subtitle="Open opportunities sorted by value, with stage and latest activity context."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/crm/opportunities">Open pipeline</Link>
            </Button>
          }
          fill
        >
          <div className="flex flex-col gap-4">
            {pipelineWatchlist.map((opportunity) => (
              <div key={opportunity.id} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{opportunity.name}</span>
                  <StatusBadge label={formatCurrency(opportunity.amount)} tone="info" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{opportunity.companyName}</span>
                  <StatusBadge label={opportunity.stage} />
                </div>
                <MeterBar value={opportunity.probability} />
                <p className="text-xs text-muted-foreground">{opportunity.lastActivity}</p>
              </div>
            ))}
            {pipelineWatchlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open opportunities right now.</p>
            ) : null}
          </div>
        </Panel>
        </TileItem>

        <TileItem id="account-watchlist" x={0} y={19} w={6} h={9} minW={4} minH={5}>
        <Panel
          title="Account watchlist"
          subtitle="Accounts with active tasks or high scores that managers and SDRs should keep close."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/crm/accounts">Open accounts</Link>
            </Button>
          }
          flush
          fill
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Tasks</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountWatchlist.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <Link href={`/crm/accounts/${account.id}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{account.name}</span>
                      <span className="text-xs text-muted-foreground">{account.domain}</span>
                      <span className="text-xs text-muted-foreground">{account.source}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{account.owner}</TableCell>
                  <TableCell>
                    <StatusBadge label={account.stage} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{account.openTasks}</TableCell>
                  <TableCell className="text-muted-foreground">{account.score}</TableCell>
                </TableRow>
              ))}
              {accountWatchlist.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No accounts on the watchlist yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
        </TileItem>
        <TileItem id="outreach-lanes" x={6} y={19} w={6} h={9} minW={4} minH={5}>
        <Panel
          title="Outreach lanes"
          subtitle="CRM execution by available channel and active campaign state."
          action={<ToneIcon icon={Mail} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5 border-b pb-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">Email-ready contacts</span>
                <StatusBadge
                  label={formatNumber(contacts.filter((contact) => contact.grade === "A" || contact.grade === "B").length)}
                  tone="success"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                A/B grade contacts can move into controlled outbound sequences.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 border-b pb-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">Call-ready contacts</span>
                <StatusBadge label={formatNumber(contacts.filter((contact) => Boolean(contact.phone)).length)} tone="info" />
              </div>
              <p className="text-xs text-muted-foreground">
                Phone-present contacts remain available for manual calling and RingCentral workflows later.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">Active campaigns</span>
                <StatusBadge label={formatNumber(activeCampaigns.length)} tone={activeCampaigns.length ? "info" : "default"} />
              </div>
              <div className="flex flex-wrap gap-2">
                {activeCampaigns.slice(0, 5).map((campaign) => (
                  <StatusBadge key={campaign.id} label={campaign.name} tone="default" />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {canManageOutreach ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/outreach/campaigns">
                    <Megaphone aria-hidden="true" />
                    Campaigns
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline" size="sm">
                <Link href="/outreach/events">
                  <Phone aria-hidden="true" />
                  Events
                </Link>
              </Button>
            </div>
          </div>
        </Panel>
        </TileItem>

        {infoCards.map((info, index) => {
          const Icon = info.icon;
          return (
            <TileItem key={info.title} id={`info-${index}`} x={index * 4} y={28} w={4} h={3} minW={3} minH={2}>
              <Card className="h-full gap-3 p-5">
                <ToneIcon icon={Icon} tone="info" />
                <h2 className="text-sm font-semibold text-foreground">{info.title}</h2>
                <p className="text-xs text-muted-foreground">{info.copy}</p>
              </Card>
            </TileItem>
          );
        })}
      </TileGrid>
    </>
  );
}

type DashboardQueueSnapshot = ReturnType<typeof sdrQueueSnapshot> | SdrQueueReadModel["snapshot"];

function isClosedStage(stage: OpportunityStage) {
  return stage === "Closed won" || stage === "Closed lost";
}

function openTasksDueToday(tasks: { workspaceId: string; status: string; dueAt?: string }[], workspaceId: string) {
  return tasks.filter((task) => task.workspaceId === workspaceId && task.status !== "Completed" && task.dueAt && isToday(task.dueAt)).length;
}

function isToday(value: string) {
  const input = new Date(value);
  const now = new Date();
  return input.getFullYear() === now.getFullYear() && input.getMonth() === now.getMonth() && input.getDate() === now.getDate();
}

function priorityWeight(priority: string) {
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  if (priority === "P3") return 3;
  if (priority === "P4") return 4;
  return 5;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

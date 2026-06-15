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
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { accountViewsForWorkspace, contactViewsForWorkspace, opportunityViews } from "@/lib/phase1/queries";
import { sdrQueueSnapshot } from "@/lib/phase1/sdr";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { Opportunity } from "@/lib/phase1/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

const metricIcons = [ClipboardList, CalendarClock, CircleDollarSign, Building2];

export const dynamic = "force-dynamic";

export default async function CrmDashboardPage() {
  const { state, session, workspaceId } = await getWorkspaceContext("manage_crm");
  const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
  const [accounts, contacts] = await Promise.all([
    accountViewsForWorkspace(readState, workspaceId),
    contactViewsForWorkspace(readState, workspaceId)
  ]);
  const opportunities = opportunityViews(readState, workspaceId);
  const openOpportunities = opportunities.filter((opportunity) => !isClosedStage(opportunity.stage));
  const ownerFilter = session.role === "SDR" ? session.user.id : undefined;
  const canManageSdr = session.permissions.includes("manage_sdr");
  const canManageOutreach = session.permissions.includes("manage_outreach");
  const queueSnapshot = canManageSdr ? sdrQueueSnapshot(readState, workspaceId, ownerFilter) : undefined;
  const activeAssignments = queueSnapshot?.metrics.assigned ?? 0;
  const dueToday = queueSnapshot?.metrics.dueToday ?? openTasksDueToday(readState.tasks, workspaceId);
  const overdue = queueSnapshot?.metrics.overdue ?? readState.tasks.filter((task) => task.workspaceId === workspaceId && task.status === "Overdue").length;
  const openPipeline = openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
  const weightedForecast = openOpportunities.reduce(
    (total, opportunity) => total + Math.round(opportunity.amount * (opportunity.probability / 100)),
    0
  );
  const activeCampaigns = readState.outreachCampaigns.filter(
    (campaign) => campaign.workspaceId === workspaceId && campaign.status === "Active"
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

  const metrics = [
    {
      label: session.role === "SDR" ? "My active leads" : "Assigned leads",
      value: activeAssignments,
      note: `${formatNumber(queueSnapshot?.metrics.p1 ?? 0)} P1 leads in queue`,
      tone: activeAssignments ? "info" as const : "success" as const
    },
    {
      label: "Due today",
      value: dueToday,
      note: overdue ? `${formatNumber(overdue)} overdue items need attention` : "No overdue work",
      tone: overdue ? "warning" as const : "success" as const
    },
    {
      label: "Open pipeline",
      value: openPipeline,
      currency: true,
      note: `${formatCurrency(weightedForecast)} weighted forecast`,
      tone: "success" as const
    },
    {
      label: "CRM accounts",
      value: accounts.length,
      note: `${formatNumber(contacts.length)} contacts linked to accounts`,
      tone: "info" as const
    }
  ];

  const workspaceCards = [
    {
      title: "Work my queue",
      copy: "First touches, follow-ups, SLA risk, and next actions for active SDR assignments.",
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

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title="CRM workspace"
        copy="A focused workspace for SDRs and managers: work assigned leads, inspect accounts and contacts, manage opportunities, and keep outreach tied to CRM activity."
        actions={
          <>
            {canManageSdr ? (
              <Link href="/sdr/queue" className="button secondary">
                <ClipboardList size={17} aria-hidden="true" />
                Open queue
              </Link>
            ) : null}
            <Link href="/crm/opportunities" className="button primary">
              <CircleDollarSign size={17} aria-hidden="true" />
              Pipeline
            </Link>
          </>
        }
      />

      <section className="grid metrics" aria-label="CRM metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? BarChart3;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="grid five" aria-label="CRM workspace shortcuts">
        {workspaceCards.filter((card) => card.visible).map((card) => {
          const Icon = card.icon;
          return (
            <Link href={card.href} className="item-card workflow-card" key={card.title}>
              <div className="item-card-header">
                <div>
                  <h2 className="card-title">{card.title}</h2>
                  <p className="section-subtitle">{card.copy}</p>
                </div>
                <Icon size={20} aria-hidden="true" />
              </div>
              <div className="row-meta">
                <StatusPill label={`${formatNumber(card.count)} ${card.label}`} tone={card.count ? "info" : "default"} />
                <ArrowRight size={17} aria-hidden="true" />
              </div>
            </Link>
          );
        })}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">{session.role === "SDR" ? "My priority work" : "Priority SDR work"}</h2>
              <p className="section-subtitle">Highest-priority assigned leads, SLA status, recommended channel, and next due date.</p>
            </div>
            <Link href="/sdr/queue" className="icon-button" aria-label="Open SDR queue">
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Owner</th>
                  <th>Priority</th>
                  <th>SLA</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {priorityAssignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <Link href={`/crm/contacts/${assignment.contactId}`} className="entity">
                        <strong>{assignment.contactName}</strong>
                        <span>{assignment.title}</span>
                        <span>{assignment.companyName}</span>
                      </Link>
                    </td>
                    <td>{assignment.ownerName}</td>
                    <td>
                      <StatusPill label={assignment.priority} tone={assignment.priority === "P1" ? "success" : "info"} />
                    </td>
                    <td>
                      <StatusPill label={assignment.slaStatus} tone={statusTone(assignment.slaStatus)} />
                    </td>
                    <td>
                      <div className="entity">
                        <strong>{assignment.reminderTitle ?? "First touch"}</strong>
                        <span>{assignment.dueAt ? formatDate(assignment.dueAt) : assignment.dueLabel}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {priorityAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No active SDR assignments are waiting right now.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Pipeline snapshot</h2>
              <p className="section-subtitle">Open opportunities sorted by value, with stage and latest activity context.</p>
            </div>
            <Link href="/crm/opportunities" className="button secondary">
              Open pipeline
            </Link>
          </div>
          <div className="panel-body stage-list">
            {pipelineWatchlist.map((opportunity) => (
              <div className="list-row" key={opportunity.id}>
                <div className="row-meta">
                  <strong>{opportunity.name}</strong>
                  <StatusPill label={formatCurrency(opportunity.amount)} tone="info" />
                </div>
                <div className="row-meta">
                  <span>{opportunity.companyName}</span>
                  <StatusPill label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                </div>
                <ProgressBar value={opportunity.probability} />
                <p className="section-subtitle">{opportunity.lastActivity}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Account watchlist</h2>
              <p className="section-subtitle">Accounts with active tasks or high scores that managers and SDRs should keep close.</p>
            </div>
            <Link href="/crm/accounts" className="button secondary">
              Open accounts
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Owner</th>
                  <th>Stage</th>
                  <th>Tasks</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {accountWatchlist.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <Link href={`/crm/accounts/${account.id}`} className="entity">
                        <strong>{account.name}</strong>
                        <span>{account.domain}</span>
                        <span>{account.source}</span>
                      </Link>
                    </td>
                    <td>{account.owner}</td>
                    <td>
                      <StatusPill label={account.stage} tone={statusTone(account.stage)} />
                    </td>
                    <td>{account.openTasks}</td>
                    <td>{account.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Outreach lanes</h2>
              <p className="section-subtitle">CRM execution by available channel and active campaign state.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            <div className="list-row">
              <div className="row-meta">
                <strong>Email-ready contacts</strong>
                <StatusPill label={`${formatNumber(contacts.filter((contact) => contact.grade === "A" || contact.grade === "B").length)}`} tone="success" />
              </div>
              <p className="section-subtitle">A/B grade contacts can move into controlled outbound sequences.</p>
            </div>
            <div className="list-row">
              <div className="row-meta">
                <strong>Call-ready contacts</strong>
                <StatusPill label={`${formatNumber(contacts.filter((contact) => Boolean(contact.phone)).length)}`} tone="info" />
              </div>
              <p className="section-subtitle">Phone-present contacts remain available for manual calling and RingCentral workflows later.</p>
            </div>
            <div className="list-row">
              <div className="row-meta">
                <strong>Active campaigns</strong>
                <StatusPill label={`${formatNumber(activeCampaigns.length)}`} tone={activeCampaigns.length ? "info" : "default"} />
              </div>
              <div className="chip-row">
                {activeCampaigns.slice(0, 5).map((campaign) => (
                  <span className="pill" key={campaign.id}>
                    {campaign.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="item-card-actions">
              {canManageOutreach ? (
                <Link href="/outreach/campaigns" className="button secondary">
                  <Megaphone size={16} aria-hidden="true" />
                  Campaigns
                </Link>
              ) : null}
              <Link href="/outreach/events" className="button secondary">
                <Phone size={16} aria-hidden="true" />
                Events
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid three">
        <div className="item-card">
          <Target size={22} aria-hidden="true" />
          <h2 className="card-title">No backend controls</h2>
          <p className="section-subtitle">Provider settings, compliance admin, reports, and automation stay in the Developer view.</p>
        </div>
        <div className="item-card">
          <Users size={22} aria-hidden="true" />
          <h2 className="card-title">SDR focused</h2>
          <p className="section-subtitle">SDRs land on assigned work, contact context, due dates, and outreach lanes.</p>
        </div>
        <div className="item-card">
          <BarChart3 size={22} aria-hidden="true" />
          <h2 className="card-title">Manager ready</h2>
          <p className="section-subtitle">Managers can jump from this workspace into queue health, reassignment, and pipeline views.</p>
        </div>
      </section>
    </>
  );
}

function isClosedStage(stage: Opportunity["stage"]) {
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

import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Clock,
  GitBranch,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Users
} from "lucide-react";
import {
  applyReassignmentRulesAction,
  createReassignmentRuleAction,
  deleteReassignmentRuleAction,
  reassignSdrAssignmentAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import { statusTone } from "@/components/status-pill";
import {
  assignmentMethods,
  managerDashboardSnapshot,
  reassignmentTriggers,
  sdrUsers
} from "@/lib/phase1/sdr";
import { readFastSdrManagerModel } from "@/lib/phase1/sdr-manager-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { AppState } from "@/lib/phase1/types";
import { formatNumber, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SdrManagerPage() {
  const sessionContext = await getWorkspaceSessionContext("manage_sdr_team");
  const fastModel = await readFastSdrManagerModel(sessionContext.session, sessionContext.workspaceId);
  let state = fastModel?.state;
  let workspaceId = sessionContext.workspaceId;
  let snapshot = fastModel?.snapshot;
  let users = fastModel?.users;
  let teams = fastModel?.teams;

  if (!fastModel) {
    const context = await getWorkspaceContext("manage_sdr_team");
    state = context.state;
    workspaceId = context.workspaceId;
    snapshot = managerDashboardSnapshot(state, workspaceId);
    users = sdrUsers(state, workspaceId);
    teams = state.sdrTeams.filter((team) => team.workspaceId === workspaceId);
  }

  if (!state || !snapshot || !users || !teams) {
    throw new Error("Unable to load SDR manager dashboard.");
  }

  const activeTeams = teams.filter((team) => team.active);
  const hasManualAssignments = snapshot.assignments.length > 0;
  const canManualReassign = hasManualAssignments && users.length > 0;
  const maxActiveLoad = Math.max(...snapshot.workloads.map((workload) => workload.active), 1);
  const riskCount = snapshot.workloads.filter((workload) => workload.overdue > 0 || workload.p1 > 2).length;
  const rulePreview = snapshot.rules.slice(0, 4);

  const metrics = [
    {
      label: "Active assigned",
      value: formatNumber(snapshot.metrics.activeAssigned),
      note: "Open SDR assignments",
      icon: Users,
      tone: "info" as const
    },
    {
      label: "SLA adherence",
      value: formatPercent(snapshot.metrics.slaAdherence),
      note: `${formatPercent(snapshot.metrics.contactedRate)} touched rate`,
      icon: ShieldCheck,
      tone: snapshot.metrics.slaAdherence >= 80 ? "success" as const : "warning" as const
    },
    {
      label: "Untouched P1",
      value: formatNumber(snapshot.metrics.untouchedP1),
      note: "High-priority leads without touch",
      icon: AlertTriangle,
      tone: snapshot.metrics.untouchedP1 ? "warning" as const : "success" as const
    },
    {
      label: "Overdue",
      value: formatNumber(snapshot.metrics.overdue),
      note: "Assignments past active SLA",
      icon: Clock,
      tone: snapshot.metrics.overdue ? "danger" as const : "success" as const
    }
  ];

  const lanes = [
    {
      label: "Active teams",
      value: activeTeams.length,
      note: `${formatNumber(users.length)} reps covered`,
      icon: GitBranch,
      tone: "info" as const
    },
    {
      label: "Risk watch",
      value: riskCount,
      note: "Heavy P1 or overdue load",
      icon: AlertTriangle,
      tone: riskCount ? "warning" as const : "success" as const
    },
    {
      label: "Recommendations",
      value: snapshot.recommendations.length,
      note: "Ready for review",
      icon: RefreshCw,
      tone: snapshot.recommendations.length ? "warning" as const : "success" as const
    },
    {
      label: "Rules live",
      value: snapshot.rules.length,
      note: "Rebalancing guardrails",
      icon: ShieldCheck,
      tone: "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="CRM management"
        title="SDR manager dashboard"
        copy="A manager-only workspace for team load, SLA risk, routing coverage, and controlled reassignment. SDRs keep the execution queue; managers get the controls."
        actions={
          <>
            <form action={applyReassignmentRulesAction}>
              <Button type="submit" variant="outline">
                <RefreshCw aria-hidden="true" />
                Apply recommendations
              </Button>
            </form>
            <Button asChild>
              <Link href="/sdr/queue">
                <ListChecks aria-hidden="true" />
                SDR queue
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="SDR manager metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard
            key={metric.label}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
            note={metric.note}
            tone={metric.tone}
          />
        ))}
      </section>

      <section aria-label="SDR manager lanes" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {lanes.map((lane) => (
          <div key={lane.label} className="bg-card flex items-center gap-3 rounded-xl border p-4 shadow-sm">
            <ToneIcon icon={lane.icon} tone={lane.tone} />
            <div className="min-w-0">
              <div className="text-lg font-semibold text-foreground">{formatNumber(lane.value)}</div>
              <div className="truncate text-xs text-muted-foreground">
                {lane.label} · {lane.note}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel
          title="Team workload"
          subtitle="Active load, P1 pressure, meetings, and SLA adherence by rep."
          action={<ToneIcon icon={BarChart3} tone="info" />}
          className="xl:col-span-7"
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SDR</TableHead>
                <TableHead>Load</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Meetings</TableHead>
                <TableHead>SLA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.workloads.map((workload) => (
                <TableRow key={workload.userId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{workload.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {teamForUser(teams, workload.userId)?.name ?? "No team"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-foreground">
                        {workload.active}/{workload.assigned} active
                      </span>
                      <MeterBar value={Math.round((workload.active / maxActiveLoad) * 100)} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={`${workload.p1} P1`} tone={workload.p1 ? "warning" : "success"} />
                      <StatusBadge label={`${workload.overdue} overdue`} tone={workload.overdue ? "danger" : "success"} />
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatNumber(workload.meetings)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-foreground">{formatPercent(workload.slaAdherence)}</span>
                      <MeterBar value={workload.slaAdherence} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {snapshot.workloads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No SDR workload data is available yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Routing coverage"
          subtitle="Territory and industry pods used by the assignment engine."
          action={<ToneIcon icon={GitBranch} tone="info" />}
          className="xl:col-span-5"
        >
          <div className="flex flex-col gap-4">
            {teams.map((team) => (
              <div key={team.id} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{team.name}</span>
                  <StatusBadge label={team.active ? "Active" : "Paused"} tone={team.active ? "success" : "warning"} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {team.memberUserIds.map((userId) => (
                    <StatusBadge
                      key={userId}
                      label={state.users.find((user) => user.id === userId)?.name ?? userId}
                      tone="default"
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Manager: {state.users.find((user) => user.id === team.managerUserId)?.name ?? "Unassigned"}. Territories:{" "}
                  {team.territories.join(", ")}. Industries: {team.industries.join(", ")}.
                </p>
              </div>
            ))}
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No routing teams have been configured yet.</p>
            ) : null}
          </div>
        </Panel>
      </section>

      <section>
        <Panel
          title="Reassignment recommendations"
          subtitle="Overdue SLA and P1 load-balance recommendations generated from current assignments."
          action={
            <StatusBadge
              label={`${snapshot.recommendations.length} recommended`}
              tone={snapshot.recommendations.length ? "warning" : "success"}
            />
          }
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Recommended</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.recommendations.map((recommendation) => (
                <TableRow key={recommendation.assignmentId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{recommendation.contactName}</span>
                      <span className="text-xs text-muted-foreground">{recommendation.companyName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{recommendation.currentOwner}</TableCell>
                  <TableCell className="text-muted-foreground">{recommendation.recommendedOwner}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{recommendation.reason}</span>
                      <span className="text-xs text-muted-foreground">
                        {recommendation.method} - {recommendation.slaStatus}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <form action={reassignSdrAssignmentAction} className="flex items-center gap-2">
                      <input name="assignmentId" type="hidden" value={recommendation.assignmentId} />
                      <input name="nextSdrId" type="hidden" value={recommendation.recommendedSdrId} />
                      <input name="assignmentMethod" type="hidden" value={recommendation.method} />
                      <input name="reason" type="hidden" value={recommendation.reason} />
                      <Button type="submit" size="sm">
                        Reassign
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {snapshot.recommendations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No reassignment recommendations right now.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel
          title="Manual reassignment"
          subtitle="Move any active assignment to another SDR with a manager reason."
          action={<ToneIcon icon={Users} tone="info" />}
          className="xl:col-span-7"
        >
          <form action={reassignSdrAssignmentAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="assignmentId" className="text-xs font-medium text-muted-foreground">
                Assignment
              </label>
              <select
                id="assignmentId"
                name="assignmentId"
                required
                defaultValue=""
                disabled={!hasManualAssignments}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  {hasManualAssignments ? "Select an active assignment" : "No active assignments yet"}
                </option>
                {snapshot.assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.contactName} - {assignment.companyName} - currently {assignment.ownerName}
                  </option>
                ))}
              </select>
              {!hasManualAssignments ? (
                <span className="text-xs text-muted-foreground">
                  Create assignments from Lead Engine first: go to Build a Lead List, finish quality checks, then use Finalize & assign.
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nextSdrId" className="text-xs font-medium text-muted-foreground">
                New SDR
              </label>
              <select
                id="nextSdrId"
                name="nextSdrId"
                required
                disabled={!users.length}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {users.length ? (
                  users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))
                ) : (
                  <option value="">No SDR users available</option>
                )}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="assignmentMethod" className="text-xs font-medium text-muted-foreground">
                Method
              </label>
              <select
                id="assignmentMethod"
                name="assignmentMethod"
                defaultValue="Capacity-based"
                disabled={!canManualReassign}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {assignmentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reason" className="text-xs font-medium text-muted-foreground">
                Reason
              </label>
              <input
                id="reason"
                name="reason"
                placeholder="Capacity rebalance"
                disabled={!canManualReassign}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={!canManualReassign}>
                Reassign lead
              </Button>
            </div>
          </form>
        </Panel>

        <Panel
          title="Reassignment rules"
          subtitle="Rules define when manager recommendations should move work."
          action={<StatusBadge label={`${snapshot.rules.length} rules`} tone="info" />}
          className="xl:col-span-5"
        >
          <div className="flex flex-col gap-5">
            <form action={createReassignmentRuleAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="name" className="text-xs font-medium text-muted-foreground">
                  Rule name
                </label>
                <input
                  id="name"
                  name="name"
                  placeholder="Overdue rescue"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="trigger" className="text-xs font-medium text-muted-foreground">
                  Trigger
                </label>
                <select
                  id="trigger"
                  name="trigger"
                  defaultValue="SLA overdue"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  {reassignmentTriggers.map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {trigger}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rule-method" className="text-xs font-medium text-muted-foreground">
                  Method
                </label>
                <select
                  id="rule-method"
                  name="assignmentMethod"
                  defaultValue="Capacity-based"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  {assignmentMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="thresholdHours" className="text-xs font-medium text-muted-foreground">
                  Threshold hours
                </label>
                <input
                  id="thresholdHours"
                  name="thresholdHours"
                  type="number"
                  min="1"
                  defaultValue="4"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="targetTeamId" className="text-xs font-medium text-muted-foreground">
                  Target team
                </label>
                <select
                  id="targetTeamId"
                  name="targetTeamId"
                  defaultValue=""
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Any available team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button type="submit">Create rule</Button>
              </div>
            </form>

            <div className="flex flex-col gap-4 border-t pt-5">
              {rulePreview.map((rule) => (
                <div key={rule.id} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{rule.name}</span>
                    <StatusBadge label={rule.trigger} tone={statusTone(rule.trigger)} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rule.assignmentMethod}, threshold {rule.thresholdHours}h
                  </p>
                  <form action={deleteReassignmentRuleAction}>
                    <input name="id" type="hidden" value={rule.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>
              ))}
              {snapshot.rules.length > rulePreview.length ? (
                <p className="text-xs text-muted-foreground">
                  {snapshot.rules.length - rulePreview.length} more rules are configured.
                </p>
              ) : null}
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}

function teamForUser(teams: AppState["sdrTeams"], userId: string) {
  return teams.find((team) => team.memberUserIds.includes(userId));
}

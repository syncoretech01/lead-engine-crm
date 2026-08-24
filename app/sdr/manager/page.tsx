import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Clock,
  GitBranch,
  ListChecks,
  PhoneCall,
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
import { fieldClass, fieldLabelClass } from "@/components/ui/field";
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
import {
  countLiveSdrSessions,
  liveSdrSessionsFromState,
  readFastLiveSdrSessions
} from "@/lib/phase1/sdr-live-sessions-read-model";
import { LiveSessionsPanel } from "@/components/sdr/live-sessions-panel";
import {
  latestSdrDailyReports,
  readFastSdrDailyReports,
  sdrDailyReportsFromState
} from "@/lib/phase1/sdr-daily-report-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { AppState } from "@/lib/phase1/types";
import { formatNumber, formatPercent } from "@/lib/utils";
import { TileGrid, TileItem } from "@/components/tile-grid";
import { canCustomizeTiles, readUserTileLayout } from "@/lib/phase1/tile-layouts";

export const dynamic = "force-dynamic";

export default async function SdrManagerPage() {
  const sessionContext = await getWorkspaceSessionContext("manage_sdr_team");
  const [fastModel, fastDailyReports, fastLiveSessions] = await Promise.all([
    readFastSdrManagerModel(sessionContext.session, sessionContext.workspaceId),
    readFastSdrDailyReports(sessionContext.session, sessionContext.workspaceId),
    readFastLiveSdrSessions(sessionContext.workspaceId)
  ]);
  let state = fastModel?.state;
  let workspaceId = sessionContext.workspaceId;
  let snapshot = fastModel?.snapshot;
  let users = fastModel?.users;
  let teams = fastModel?.teams;
  let dailyReports = fastDailyReports;

  if (!fastModel) {
    const context = await getWorkspaceContext("manage_sdr_team");
    state = context.state;
    workspaceId = context.workspaceId;
    snapshot = managerDashboardSnapshot(state, workspaceId);
    users = sdrUsers(state, workspaceId);
    teams = state.sdrTeams.filter((team) => team.workspaceId === workspaceId);
    dailyReports = sdrDailyReportsFromState(state, workspaceId);
  }

  if (!state || !snapshot || !users || !teams || !dailyReports) {
    throw new Error("Unable to load SDR manager dashboard.");
  }

  const liveSessions = fastLiveSessions ?? liveSdrSessionsFromState(state, workspaceId);
  const liveSessionCount = countLiveSdrSessions(liveSessions.rows, Date.parse(liveSessions.generatedAt));

  const activeTeams = teams.filter((team) => team.active);
  const hasManualAssignments = snapshot.assignments.length > 0;
  const canManualReassign = hasManualAssignments && users.length > 0;
  const maxActiveLoad = Math.max(...snapshot.workloads.map((workload) => workload.active), 1);
  const riskCount = snapshot.workloads.filter((workload) => workload.overdue > 0 || workload.p1 > 2).length;
  const rulePreview = snapshot.rules.slice(0, 4);
  const sdrMembers = state.workspaceMembers.filter((member) => member.workspaceId === workspaceId && member.role === "SDR");
  const latestReports = new Map(
    latestSdrDailyReports(dailyReports, sdrMembers.map((member) => member.userId)).map((report) => [report.sdrUserId, report])
  );
  const endOfDayRows = sdrMembers.map((member) => ({
    userId: member.userId,
    name: state.users.find((user) => user.id === member.userId)?.name ?? "Unknown SDR",
    report: latestReports.get(member.userId)
  }));
  const latestReportDate = dailyReports[0]?.reportDate;

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

  // Widths are explicit because five lanes share the twelve-column row.
  const lanes = [
    {
      label: "Live now",
      value: liveSessionCount,
      note: liveSessionCount ? "Calling sessions open" : "No session open",
      icon: PhoneCall,
      tone: liveSessionCount ? "success" as const : "info" as const,
      w: 4
    },
    {
      label: "Active teams",
      value: activeTeams.length,
      note: `${formatNumber(users.length)} reps covered`,
      icon: GitBranch,
      tone: "info" as const,
      w: 2
    },
    {
      label: "Risk watch",
      value: riskCount,
      note: "Heavy P1 or overdue load",
      icon: AlertTriangle,
      tone: riskCount ? "warning" as const : "success" as const,
      w: 2
    },
    {
      label: "Recommendations",
      value: snapshot.recommendations.length,
      note: "Ready for review",
      icon: RefreshCw,
      tone: snapshot.recommendations.length ? "warning" as const : "success" as const,
      w: 2
    },
    {
      label: "Rules live",
      value: snapshot.rules.length,
      note: "Rebalancing guardrails",
      icon: ShieldCheck,
      tone: "success" as const,
      w: 2
    }
  ];
  const laneOffsets = lanes.reduce<number[]>((acc, lane, index) => {
    acc.push(index === 0 ? 0 : acc[index - 1] + lanes[index - 1].w);
    return acc;
  }, []);

  const canCustomize = canCustomizeTiles(sessionContext.session);
  const savedLayout = await readUserTileLayout(sessionContext.session.user.id, "sdr-manager");

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

      <TileGrid pageKey="sdr-manager" canCustomize={canCustomize} saved={savedLayout}>
        {metrics.map((metric, index) => (
          <TileItem key={`metric-${index}`} id={`metric-${index}`} x={index * 3} y={0} w={3} h={2} minW={2}>
            <StatCard
              icon={metric.icon}
              label={metric.label}
              value={metric.value}
              note={metric.note}
              tone={metric.tone}
              fill
            />
          </TileItem>
        ))}
        {lanes.map((lane, index) => (
          <TileItem key={`lane-${index}`} id={`lane-${index}`} x={laneOffsets[index]} y={2} w={lane.w} h={2} minW={2}>
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

        <TileItem id="live-sessions" x={0} y={4} w={12} h={7} minW={6} minH={4}>
          <LiveSessionsPanel initial={liveSessions} />
        </TileItem>

        <TileItem id="end-of-day-reports" x={0} y={11} w={12} h={9} minW={7} minH={5}>
        <Panel
          title="End-of-day SDR reports"
          subtitle="Saved automatically after the daily window closes at 4:00 AM Pakistan Standard Time (Asia/Karachi)."
          action={<StatusBadge label={latestReportDate ? `Through ${formatReportDate(latestReportDate)}` : "Awaiting first cutoff"} tone={latestReportDate ? "success" : "warning"} />}
          flush
          fill
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SDR</TableHead>
                <TableHead>Calls</TableHead>
                <TableHead>Talk time</TableHead>
                <TableHead>Email and SMS</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Follow-ups</TableHead>
                <TableHead>Other activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endOfDayRows.map(({ userId, name, report }) => (
                <TableRow key={userId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{name}</span>
                      <span className="text-xs text-muted-foreground">
                        {report ? formatReportDate(report.reportDate) : "No completed report yet"}
                      </span>
                    </div>
                  </TableCell>
                  {report ? (
                    <>
                      <TableCell>
                        <ReportMetric value={`${report.metrics.callsTotal}/${report.metrics.dailyCallTarget}`} note={`${report.metrics.callsConnected} connected · ${report.metrics.callsVoicemail} VM · ${report.metrics.callsUnanswered} unanswered · ${report.metrics.callsFailed} failed`} />
                      </TableCell>
                      <TableCell>
                        <ReportMetric value={formatDuration(report.metrics.totalTalkTimeSeconds)} note={`${report.metrics.callingSessions} sessions · ${formatDuration(report.metrics.activeCallingSeconds)} active`} />
                      </TableCell>
                      <TableCell>
                        <ReportMetric
                          value={`${report.metrics.emailsSent} emails sent · ${report.metrics.smsSent} SMS sent`}
                          note={`${report.metrics.emailReplies} email replies · ${report.metrics.smsReplies} SMS replies`}
                        />
                      </TableCell>
                      <TableCell>
                        <ReportMetric value={`${report.metrics.opportunitiesCreated} opportunities`} note={`${report.metrics.meetingsBooked} meetings · ${formatCurrency(report.metrics.opportunityValue)}`} />
                      </TableCell>
                      <TableCell>
                        <ReportMetric value={`${report.metrics.followUpsCreated} created`} note={`${report.metrics.followUpsCompleted} completed`} />
                      </TableCell>
                      <TableCell>
                        <ReportMetric
                          value={`${report.metrics.leadsTouched} touched · ${report.metrics.contactsSuppressed} suppressed`}
                          note={`${report.metrics.assignmentsReceived} assigned · P1 ${report.metrics.firstPassCompleted} / P2 ${report.metrics.secondPassCompleted} · ${report.metrics.tasksCompleted} tasks · ${report.metrics.notesAdded} notes`}
                        />
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={6} className="text-muted-foreground">The worker will save this SDR&apos;s first report at the next 4:00 AM PKT cutoff.</TableCell>
                  )}
                </TableRow>
              ))}
              {endOfDayRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No SDR members are available for daily reporting.</TableCell></TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
        </TileItem>

        <TileItem id="team-workload" x={0} y={20} w={7} h={8} minW={4} minH={4}>
        <Panel
          title="Team workload"
          subtitle="Active load, P1 pressure, meetings, and SLA adherence by rep."
          action={<ToneIcon icon={BarChart3} tone="info" />}
          flush
          fill
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
        </TileItem>

        <TileItem id="routing-coverage" x={7} y={20} w={5} h={8} minW={3} minH={4}>
        <Panel
          title="Routing coverage"
          subtitle="Territory and industry pods used by the assignment engine."
          action={<ToneIcon icon={GitBranch} tone="info" />}
          fill
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
        </TileItem>

        <TileItem id="reassignment-recommendations" x={0} y={28} w={12} h={7} minW={6} minH={3}>
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
          fill
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
                        {recommendation.method}
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
        </TileItem>

        <TileItem id="manual-reassignment" x={0} y={35} w={7} h={9} minW={4} minH={4}>
        <Panel
          title="Manual reassignment"
          subtitle="Move any active assignment to another SDR with a manager reason."
          action={<ToneIcon icon={Users} tone="info" />}
          fill
        >
          <form action={reassignSdrAssignmentAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="assignmentId" className={fieldLabelClass}>
                Assignment
              </label>
              <select
                id="assignmentId"
                name="assignmentId"
                required
                defaultValue=""
                disabled={!hasManualAssignments}
                className={fieldClass}
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
              <label htmlFor="nextSdrId" className={fieldLabelClass}>
                New SDR
              </label>
              <select
                id="nextSdrId"
                name="nextSdrId"
                required
                disabled={!users.length}
                className={fieldClass}
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
              <label htmlFor="assignmentMethod" className={fieldLabelClass}>
                Method
              </label>
              <select
                id="assignmentMethod"
                name="assignmentMethod"
                defaultValue="Capacity-based"
                disabled={!canManualReassign}
                className={fieldClass}
              >
                {assignmentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reason" className={fieldLabelClass}>
                Reason
              </label>
              <input
                id="reason"
                name="reason"
                placeholder="Capacity rebalance"
                disabled={!canManualReassign}
                className={fieldClass}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={!canManualReassign}>
                Reassign lead
              </Button>
            </div>
          </form>
        </Panel>
        </TileItem>

        <TileItem id="reassignment-rules" x={7} y={35} w={5} h={9} minW={3} minH={4}>
        <Panel
          title="Reassignment rules"
          subtitle="Rules define when manager recommendations should move work."
          action={<StatusBadge label={`${snapshot.rules.length} rules`} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-5">
            <form action={createReassignmentRuleAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="name" className={fieldLabelClass}>
                  Rule name
                </label>
                <input
                  id="name"
                  name="name"
                  placeholder="Overdue rescue"
                  className={fieldClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="trigger" className={fieldLabelClass}>
                  Trigger
                </label>
                <select
                  id="trigger"
                  name="trigger"
                  defaultValue="SLA overdue"
                  className={fieldClass}
                >
                  {reassignmentTriggers.map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {trigger}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rule-method" className={fieldLabelClass}>
                  Method
                </label>
                <select
                  id="rule-method"
                  name="assignmentMethod"
                  defaultValue="Capacity-based"
                  className={fieldClass}
                >
                  {assignmentMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="thresholdHours" className={fieldLabelClass}>
                  Threshold hours
                </label>
                <input
                  id="thresholdHours"
                  name="thresholdHours"
                  type="number"
                  min="1"
                  defaultValue="4"
                  className={fieldClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="targetTeamId" className={fieldLabelClass}>
                  Target team
                </label>
                <select
                  id="targetTeamId"
                  name="targetTeamId"
                  defaultValue=""
                  className={fieldClass}
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
        </TileItem>
      </TileGrid>
    </>
  );
}

function teamForUser(teams: AppState["sdrTeams"], userId: string) {
  return teams.find((team) => team.memberUserIds.includes(userId));
}

function ReportMetric({ value, note }: { value: string; note: string }) {
  return <div className="flex min-w-[132px] flex-col"><span className="font-medium text-foreground">{value}</span><span className="text-xs text-muted-foreground">{note}</span></div>;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatReportDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

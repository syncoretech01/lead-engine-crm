import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Calendar,
  Clock,
  ListChecks,
  Mail,
  Phone,
  RefreshCw,
  Send,
  Users
} from "lucide-react";
import {
  completeFollowUpReminderAction,
  logFirstTouchAction,
  runSdrAssignmentAction
} from "@/app/actions";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { outreachChannels, sdrLeadStatuses, sdrQueueSnapshot } from "@/lib/phase1/sdr";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const touchStatuses = sdrLeadStatuses.filter((status) =>
  ["Contacted", "Replied", "Interested", "Meeting Booked", "Qualified", "Nurture", "Disqualified", "Invalid"].includes(status)
);
const metricIcons = [ListChecks, BadgeCheck, Calendar, Clock];

export default async function SdrQueuePage() {
  const { state, session, workspaceId } = await getWorkspaceContext("manage_sdr");
  const ownerFilter = session.role === "SDR" ? session.user.id : undefined;
  const snapshot = sdrQueueSnapshot(state, workspaceId, ownerFilter);
  const activeAssignments = snapshot.assignments.filter((assignment) => activeStatus(assignment.status));
  const priorityQueue = [...activeAssignments]
    .sort((a, b) => queueWeight(a) - queueWeight(b))
    .slice(0, 10);
  const openReminders = snapshot.reminders
    .filter((reminder) => reminder.status !== "Completed")
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .slice(0, 10);
  const emailReady = activeAssignments.filter((assignment) => assignment.grade === "A" || assignment.grade === "B");
  const callReady = activeAssignments.filter((assignment) => assignment.phone);
  const meetingFollowUps = activeAssignments.filter((assignment) => assignment.status === "Meeting Booked");
  const pageTitle = session.role === "SDR" ? "My SDR queue" : "SDR queue";

  const metrics = [
    {
      label: "Assigned leads",
      value: snapshot.metrics.assigned,
      note: "Active SDR assignments",
      tone: "info" as const
    },
    {
      label: "P1 leads",
      value: snapshot.metrics.p1,
      note: "Highest-priority queue items",
      tone: snapshot.metrics.p1 ? "success" as const : "info" as const
    },
    {
      label: "Due today",
      value: snapshot.metrics.dueToday,
      note: "First touches and follow-ups",
      tone: snapshot.metrics.dueToday ? "warning" as const : "success" as const
    },
    {
      label: "Overdue",
      value: snapshot.metrics.overdue,
      note: "SLA or reminder misses",
      tone: snapshot.metrics.overdue ? "danger" as const : "success" as const
    }
  ];

  const focusCards = [
    snapshot.queueViews.find((view) => view.name === "My P1 Leads"),
    snapshot.queueViews.find((view) => view.name === "Due Today"),
    snapshot.queueViews.find((view) => view.name === "Overdue"),
    snapshot.queueViews.find((view) => view.name === "Recently Replied")
  ].filter((view): view is NonNullable<typeof view> => Boolean(view));

  return (
    <>
      <PageHeader
        kicker="CRM execution"
        title={pageTitle}
        copy="A focused work queue for first touches, follow-ups, overdue leads, and quick outcome logging. Managers can run routing and review team health from here."
        actions={
          <>
            <form action={runSdrAssignmentAction}>
              <button className="button secondary" type="submit">
                <RefreshCw size={17} aria-hidden="true" />
                Run assignment
              </button>
            </form>
            <Link href={session.role === "SDR" ? "/crm" : "/sdr/manager"} className="button primary">
              <Users size={17} aria-hidden="true" />
              {session.role === "SDR" ? "CRM workspace" : "Manager dashboard"}
            </Link>
          </>
        }
      />

      <section className="grid metrics" aria-label="SDR queue metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? ListChecks;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="grid four">
        {focusCards.map((view) => (
          <article className="item-card workflow-card" key={view.name}>
            <div className="item-card-header">
              <div>
                <h2 className="card-title">{view.name}</h2>
                <p className="section-subtitle">{view.purpose}</p>
              </div>
              <div className="score-ring">{view.count}</div>
            </div>
          </article>
        ))}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Priority work</h2>
              <p className="section-subtitle">Sorted by overdue status, P1 priority, due date, and available channel.</p>
            </div>
            <StatusPill label={`${priorityQueue.length} visible`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>SLA</th>
                  <th>Next due</th>
                  <th>Channel</th>
                </tr>
              </thead>
              <tbody>
                {priorityQueue.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <Link href={`/crm/contacts/${assignment.contactId}`} className="entity">
                        <strong>{assignment.contactName}</strong>
                        <span>{assignment.title}</span>
                        <span>{assignment.companyName}</span>
                      </Link>
                      <div className="chip-row">
                        <StatusPill label={assignment.priority} tone={assignment.priority === "P1" ? "success" : "info"} />
                        <span className={`grade ${assignment.grade.toLowerCase()}`}>{assignment.grade}</span>
                      </div>
                    </td>
                    <td>
                      <div className="entity">
                        <strong>{assignment.ownerName}</strong>
                        <span>{assignment.teamName}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={assignment.status} tone={statusTone(assignment.status)} />
                    </td>
                    <td>
                      <StatusPill label={assignment.slaStatus} tone={slaTone(assignment.slaStatus)} />
                    </td>
                    <td>
                      <div className="entity">
                        <strong>{assignment.dueAt ? formatDate(assignment.dueAt) : "No active SLA"}</strong>
                        <span>{assignment.reminderTitle ?? assignment.dueLabel}</span>
                      </div>
                    </td>
                    <td>
                      <div className="chip-row">
                        {assignment.grade === "A" || assignment.grade === "B" ? (
                          <span className="pill success">
                            <Mail size={13} aria-hidden="true" />
                            Email
                          </span>
                        ) : null}
                        {assignment.phone ? (
                          <span className="pill info">
                            <Phone size={13} aria-hidden="true" />
                            Call
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {priorityQueue.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No active SDR assignments need work right now.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Log touch</h2>
              <p className="section-subtitle">Record an outcome, set the next follow-up, and update the assignment timeline.</p>
            </div>
            <Send size={20} aria-hidden="true" />
          </div>
          <form action={logFirstTouchAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="assignmentId">Lead</label>
              <select id="assignmentId" name="assignmentId" required>
                {activeAssignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.contactName} - {assignment.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="channel">Channel</label>
              <select id="channel" name="channel" defaultValue="Email">
                {outreachChannels.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="outcome">Outcome</label>
              <select id="outcome" name="outcome" defaultValue="Contacted">
                {touchStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="followUpDueAt">Follow-up due</label>
              <input id="followUpDueAt" name="followUpDueAt" type="datetime-local" />
            </div>
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" placeholder="Call outcome, objection, next step, or reply summary" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                <Send size={17} aria-hidden="true" />
                Save touch
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Follow-up reminders</h2>
              <p className="section-subtitle">Open reminders sorted by due date.</p>
            </div>
            <Clock size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {openReminders.map((reminder) => (
              <div className="list-row" key={reminder.id}>
                <div className="row-meta">
                  <strong>{reminder.title}</strong>
                  <StatusPill label={reminder.status} tone={statusTone(reminder.status)} />
                </div>
                <p className="section-subtitle">
                  {reminder.companyName} - {reminder.channel} - {formatDate(reminder.dueAt)} ({reminder.dueLabel})
                </p>
                <div className="item-card-actions">
                  <Link href={`/crm/contacts/${reminder.contactId}`} className="button secondary">
                    <ArrowRight size={16} aria-hidden="true" />
                    Contact
                  </Link>
                  <form action={completeFollowUpReminderAction}>
                    <input name="id" type="hidden" value={reminder.id} />
                    <button className="button primary" type="submit">
                      Complete
                    </button>
                  </form>
                </div>
              </div>
            ))}
            {openReminders.length === 0 ? (
              <div className="empty-state">
                <Clock size={24} aria-hidden="true" />
                <span>No open follow-up reminders.</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Channel readiness</h2>
              <p className="section-subtitle">Recommended work lanes based on verification and available contact data.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            <ReadinessRow label="Email-ready" count={emailReady.length} total={activeAssignments.length} tone="success" />
            <ReadinessRow label="Call-ready" count={callReady.length} total={activeAssignments.length} tone="info" />
            <ReadinessRow label="Meeting follow-up" count={meetingFollowUps.length} total={activeAssignments.length} tone="warning" />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Assignment directory</h2>
            <p className="section-subtitle">All active and historical assignments for this queue scope.</p>
          </div>
          <StatusPill label={`${formatNumber(snapshot.assignments.length)} assignments`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Owner</th>
                <th>Status</th>
                <th>SLA</th>
                <th>Method</th>
                <th>Touches</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.assignments.map((assignment) => (
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
                    <StatusPill label={assignment.status} tone={statusTone(assignment.status)} />
                  </td>
                  <td>
                    <StatusPill label={assignment.slaStatus} tone={slaTone(assignment.slaStatus)} />
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{assignment.assignmentMethod}</strong>
                      <span>{assignment.assignmentReason}</span>
                    </div>
                  </td>
                  <td>{assignment.touchCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type AssignmentView = ReturnType<typeof sdrQueueSnapshot>["assignments"][number];

function activeStatus(status: string) {
  return !["Won", "Lost", "Disqualified", "Invalid", "Unsubscribed", "Suppressed"].includes(status);
}

function queueWeight(assignment: AssignmentView) {
  const overdueWeight = assignment.slaStatus === "Overdue" ? 0 : assignment.slaStatus === "Due soon" ? 1 : 2;
  const priority = assignment.priority === "P1" ? 0 : assignment.priority === "P2" ? 1 : assignment.priority === "P3" ? 2 : 3;
  const due = assignment.dueAt ? Date.parse(assignment.dueAt) / 1_000_000_000_000 : 9;

  return overdueWeight * 10 + priority + due;
}

function ReadinessRow({
  label,
  count,
  total,
  tone
}: {
  label: string;
  count: number;
  total: number;
  tone: "success" | "info" | "warning";
}) {
  const percent = total ? Math.round((count / total) * 100) : 0;

  return (
    <div className="stage-row">
      <div className="stage-meta">
        <strong>{label}</strong>
        <StatusPill label={`${formatNumber(count)} leads`} tone={tone} />
      </div>
      <ProgressBar value={percent} />
      <span className="section-subtitle">{percent}% of active assignments</span>
    </div>
  );
}

function slaTone(status: string) {
  if (status === "Overdue") return "danger";
  if (status === "Due soon") return "warning";
  if (status === "On track") return "success";
  return "default";
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

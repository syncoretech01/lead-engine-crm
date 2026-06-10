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
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { outreachChannels, sdrLeadStatuses, sdrQueueSnapshot } from "@/lib/phase1/sdr";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const touchStatuses = sdrLeadStatuses.filter((status) =>
  ["Contacted", "Replied", "Interested", "Meeting Booked", "Qualified", "Nurture", "Disqualified", "Invalid"].includes(status)
);

export default async function SdrQueuePage() {
  const { state, session, workspaceId } = await getWorkspaceContext("manage_sdr");
  const ownerFilter = session.role === "SDR" ? session.user.id : undefined;
  const snapshot = sdrQueueSnapshot(state, workspaceId, ownerFilter);

  return (
    <>
      <PageHeader
        kicker="Phase 5"
        title="SDR queue"
        copy="Assignment queues, SLA timers, follow-up reminders, and first-touch workflows for SDR execution."
        actions={
          <>
            <form action={runSdrAssignmentAction}>
              <button className="button secondary" type="submit">
                <RefreshCw size={17} aria-hidden="true" />
                Run assignment
              </button>
            </form>
            <Link href="/sdr/manager" className="button primary">
              <Users size={17} aria-hidden="true" />
              Manager dashboard
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Assigned leads</span>
            <ListChecks size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.assigned)}</div>
          <span className="metric-note">Active SDR assignments.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">P1 leads</span>
            <BadgeCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.p1)}</div>
          <span className="metric-note">Highest priority queue items.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Due today</span>
            <Calendar size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.dueToday)}</div>
          <span className="metric-note">First touches and follow-ups.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Overdue</span>
            <Clock size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.overdue)}</div>
          <span className="metric-note">SLA or reminder misses.</span>
        </article>
      </section>

      <section className="grid three">
        {snapshot.queueViews.map((view) => (
          <article className="item-card" key={view.name}>
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

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Assigned lead queue</h2>
            <p className="section-subtitle">Priority, SLA timer, first-touch due date, follow-up due date, and touch logging.</p>
          </div>
          <StatusPill label={`${snapshot.assignments.length} assignments`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Owner</th>
                <th>Status</th>
                <th>SLA</th>
                <th>Due</th>
                <th>Method</th>
                <th>Log touch</th>
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
                    <div className="entity">
                      <StatusPill label={assignment.slaStatus} tone={slaTone(assignment.slaStatus)} />
                      <span>{assignment.dueLabel}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{assignment.dueAt ? formatDate(assignment.dueAt) : "No active SLA"}</strong>
                      <span>{assignment.reminderTitle ?? "No open reminder"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{assignment.assignmentMethod}</strong>
                      <span>{assignment.assignmentReason}</span>
                    </div>
                  </td>
                  <td>
                    <form action={logFirstTouchAction} className="inline-form wide-inline">
                      <input name="assignmentId" type="hidden" value={assignment.id} />
                      <select name="channel" defaultValue={assignment.phone ? "Call" : "Email"} aria-label="Channel">
                        {outreachChannels.map((channel) => (
                          <option key={channel} value={channel}>
                            {channel}
                          </option>
                        ))}
                      </select>
                      <select name="outcome" defaultValue="Contacted" aria-label="Outcome">
                        {touchStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <input name="followUpDueAt" type="datetime-local" aria-label="Follow-up due" />
                      <input name="notes" placeholder="Touch notes" aria-label="Touch notes" />
                      <button className="icon-button" type="submit" aria-label="Log touch">
                        <Send size={16} aria-hidden="true" />
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {snapshot.assignments.length === 0 ? (
                <tr>
                  <td colSpan={7}>No SDR assignments yet. Run assignment to route CRM-ready leads.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Follow-up reminders</h2>
              <p className="section-subtitle">Open reminders generated by assignments and completed first touches.</p>
            </div>
            <Clock size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {snapshot.reminders
              .filter((reminder) => reminder.status !== "Completed")
              .slice(0, 12)
              .map((reminder) => (
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
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Channel lanes</h2>
              <p className="section-subtitle">Recommended first action based on verification and available contact data.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            <div className="list-row">
              <div className="row-meta">
                <strong>Email-ready</strong>
                <span>{snapshot.assignments.filter((assignment) => assignment.grade === "A" || assignment.grade === "B").length}</span>
              </div>
              <p className="section-subtitle">A/B grade leads can start with email and continue by phone if no reply.</p>
            </div>
            <div className="list-row">
              <div className="row-meta">
                <strong>Call-first</strong>
                <span>{snapshot.assignments.filter((assignment) => assignment.phone && assignment.grade !== "A" && assignment.grade !== "B").length}</span>
              </div>
              <p className="section-subtitle">Phone-ready leads with weaker email confidence stay visible for manual calling.</p>
            </div>
            <div className="list-row">
              <div className="row-meta">
                <strong>Meeting follow-up</strong>
                <span>{snapshot.assignments.filter((assignment) => assignment.status === "Meeting Booked").length}</span>
              </div>
              <p className="section-subtitle">Meeting outcomes receive tighter next-step reminders.</p>
            </div>
          </div>
        </div>
      </section>
    </>
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

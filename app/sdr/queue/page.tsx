import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
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
  runSdrAssignmentAction,
  sendAssignedBulkEmailAction
} from "@/app/actions";
import { directEmailBlockReason } from "@/lib/phase1/direct-email-send";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { outreachChannels, sdrLeadStatuses, sdrQueueSnapshot, sdrUsers } from "@/lib/phase1/sdr";
import { resolveUserSenderIdentity } from "@/lib/phase1/sender-identities";
import { resolveUserTelephonyIdentity } from "@/lib/phase1/telephony-identities";
import {
  readFastSdrQueueModel,
  type SdrQueueAssignmentReadRow,
  type SdrQueueReadModel
} from "@/lib/phase1/sdr-queue-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

const touchStatuses = sdrLeadStatuses.filter((status) =>
  ["Contacted", "Replied", "Interested", "Meeting Booked", "Qualified", "Nurture", "Disqualified", "Invalid"].includes(status)
);

export default async function SdrQueuePage() {
  const sessionContext = await getWorkspaceSessionContext("manage_sdr");
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let snapshot: QueueSnapshot;
  let bulkOwnerUsers: Array<{ id: string; name: string; email: string; createdAt: string }> = [];
  let fallbackState: Awaited<ReturnType<typeof getWorkspaceContext>>["state"] | undefined;
  const fastModel = await readFastSdrQueueModel(session, workspaceId);

  if (fastModel) {
    snapshot = fastModel.snapshot;
    bulkOwnerUsers = fastModel.bulkOwnerUsers;
  } else {
    const context = await getWorkspaceContext("manage_sdr");
    fallbackState = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    snapshot = sdrQueueSnapshot(fallbackState, workspaceId, session.role === "SDR" ? session.user.id : undefined);
    bulkOwnerUsers = sdrUsers(fallbackState, workspaceId);
  }

  const canRunAssignment = session.permissions.includes("manage_sdr_team");
  const isSdr = session.role === "SDR";
  const activeAssignments = snapshot.assignments.filter((assignment) => activeStatus(assignment.status));
  const priorityQueue = [...activeAssignments]
    .sort((a, b) => queueWeight(a) - queueWeight(b))
    .slice(0, 10);
  const openReminders = snapshot.reminders
    .filter((reminder) => reminder.status !== "Completed")
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .slice(0, 10);
  const callReady = activeAssignments.filter((assignment) => assignment.phone);
  const meetingFollowUps = activeAssignments.filter((assignment) => assignment.status === "Meeting Booked");
  const bulkEligibleAssignments = fastModel ? activeAssignments.filter(isFastEmailEligible) : activeAssignments.filter((assignment) => {
    const contact = fallbackState?.contacts.find((item) => item.id === assignment.contactId && item.workspaceId === workspaceId);
    return Boolean(contact && !directEmailBlockReason(contact));
  });
  const emailReady = bulkEligibleAssignments;
  const pageTitle = isSdr ? "My work queue" : "SDR queue";
  const recentlyReplied = snapshot.queueViews.find((view) => view.name === "Recently Replied")?.count ?? 0;
  const bulkRequestId = `sdr-bulk-${session.user.id}-${randomUUID()}`;
  const canSelectBulkOwner = !isSdr;
  const currentSenderIdentity = resolveUserSenderIdentity(session.user);
  const currentTelephonyIdentity = resolveUserTelephonyIdentity(session.user);
  const bulkSenderNote = canSelectBulkOwner
    ? "All SDRs sends from each assigned SDR's approved sender. A single owner sends from that owner's approved sender."
    : `From: ${currentSenderIdentity?.mailbox ?? "No approved sending email configured for this user."}`;
  const telephonyNote = currentTelephonyIdentity
    ? `RingCentral: ${currentTelephonyIdentity.phoneNumber}`
    : "No RingCentral number configured";
  const canSubmitBulkEmail = Boolean(bulkEligibleAssignments.length) && (canSelectBulkOwner || Boolean(currentSenderIdentity));

  const metrics = [
    {
      label: isSdr ? "My active leads" : "Assigned leads",
      value: formatNumber(snapshot.metrics.assigned),
      note: "Active SDR assignments",
      icon: ListChecks,
      tone: "info" as const
    },
    {
      label: "Due today",
      value: formatNumber(snapshot.metrics.dueToday),
      note: "First touches and follow-ups",
      icon: CalendarClock,
      tone: snapshot.metrics.dueToday ? "warning" as const : "success" as const
    },
    {
      label: "Overdue",
      value: formatNumber(snapshot.metrics.overdue),
      note: "SLA or reminder misses",
      icon: Clock,
      tone: snapshot.metrics.overdue ? "danger" as const : "success" as const
    },
    {
      label: "Email-sendable",
      value: formatNumber(emailReady.length),
      note: "Assigned contacts allowed for SES send",
      icon: Mail,
      tone: emailReady.length ? "success" as const : "warning" as const
    }
  ];

  const lanes = [
    {
      label: "P1 leads",
      value: snapshot.metrics.p1,
      note: "Highest-priority queue items",
      icon: BadgeCheck,
      tone: snapshot.metrics.p1 ? "success" as const : "info" as const
    },
    {
      label: "Call-ready",
      value: callReady.length,
      note: callReady.length ? telephonyNote : "Phone numbers available",
      icon: Phone,
      tone: callReady.length && !currentTelephonyIdentity ? "warning" as const : "info" as const
    },
    {
      label: "Meeting follow-up",
      value: meetingFollowUps.length,
      note: "Booked meetings to advance",
      icon: CalendarClock,
      tone: meetingFollowUps.length ? "warning" as const : "success" as const
    },
    {
      label: "Recent replies",
      value: recentlyReplied,
      note: "Replies needing attention",
      icon: Mail,
      tone: recentlyReplied ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="CRM execution"
        title={pageTitle}
        copy={
          isSdr
            ? "Work assigned contacts, send outreach, log outcomes, and keep follow-ups moving from one focused place."
            : "A focused work queue for first touches, follow-ups, overdue leads, and quick outcome logging. Managers can run routing and review team health from here."
        }
        actions={
          <>
            {canRunAssignment ? (
              <form action={runSdrAssignmentAction}>
                <button className="button secondary" type="submit">
                  <RefreshCw size={17} aria-hidden="true" />
                  Run assignment
                </button>
              </form>
            ) : null}
            <Link href={isSdr ? "/crm/contacts" : "/sdr/manager"} className="button primary">
              <Users size={17} aria-hidden="true" />
              {isSdr ? "My contacts" : "Manager dashboard"}
            </Link>
          </>
        }
      />

      <section className="stat-grid" aria-label="SDR queue metrics">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="SDR work lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
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
                  {!isSdr ? <th>Owner</th> : null}
                  <th>Status</th>
                  <th>SLA</th>
                  <th>Next due</th>
                  <th>Channel</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {priorityQueue.map((assignment) => {
                  const contactName = assignmentDisplayName(assignment);
                  const nextAction = recommendedAction(assignment);

                  return (
                    <tr key={assignment.id}>
                      <td>
                        <Link href={`/crm/contacts/${assignment.contactId}`} className="entity">
                          <strong>{contactName}</strong>
                          <span>{assignment.email || assignment.title || "No email on record"}</span>
                          <span>{assignment.companyName}</span>
                        </Link>
                        <div className="chip-row">
                          <StatusPill label={assignment.priority} tone={assignment.priority === "P1" ? "success" : "info"} />
                          <span className={`grade ${assignment.grade.toLowerCase()}`}>{assignment.grade}</span>
                        </div>
                      </td>
                      {!isSdr ? (
                        <td>
                          <div className="entity">
                            <strong>{assignment.ownerName}</strong>
                            <span>{assignment.teamName}</span>
                          </div>
                        </td>
                      ) : null}
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
                          {assignmentEmailEligible(assignment) ? (
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
                          {!assignmentEmailEligible(assignment) && !assignment.phone ? <span className="pill">Review</span> : null}
                        </div>
                      </td>
                      <td>
                        <Link href={`/crm/contacts/${assignment.contactId}`} className="button secondary">
                          {nextAction}
                          <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {priorityQueue.length === 0 ? (
                  <tr>
                    <td colSpan={isSdr ? 6 : 7}>No active SDR assignments need work right now.</td>
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
            {isSdr ? <div className="surface-note">{telephonyNote}</div> : null}
            <div className="field">
              <label htmlFor="assignmentId">Lead</label>
              <select id="assignmentId" name="assignmentId" required>
                {activeAssignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignmentDisplayName(assignment)} - {assignment.companyName}
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
              <h2 className="section-title">Bulk email assigned contacts</h2>
              <p className="section-subtitle">Send one SES-backed email to eligible active assignments in this queue scope.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <form action={sendAssignedBulkEmailAction} className="panel-body form-grid">
            <input name="requestId" type="hidden" value={bulkRequestId} />
            <div className="surface-note">{bulkSenderNote}</div>
            {canSelectBulkOwner ? (
              <div className="field">
                <label htmlFor="bulk-owner">Owner</label>
                <select id="bulk-owner" name="ownerUserId" defaultValue="all">
                  <option value="all">All SDRs</option>
                  {bulkOwnerUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="bulk-audience">Audience</label>
              <select id="bulk-audience" name="audience" defaultValue="all_assigned">
                <option value="all_assigned">All eligible assigned</option>
                <option value="p1">P1 assigned</option>
                <option value="due_or_overdue">Due or overdue</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="bulk-limit">Max sends</label>
              <input
                id="bulk-limit"
                name="limit"
                type="number"
                min="1"
                max="50"
                defaultValue={Math.min(Math.max(bulkEligibleAssignments.length, 1), 25)}
              />
            </div>
            <div className="field">
              <label htmlFor="bulk-subject">Subject</label>
              <input id="bulk-subject" name="subject" defaultValue="Quick question about {{company}}" required />
            </div>
            <div className="field">
              <label htmlFor="bulk-body">Body</label>
              <textarea
                id="bulk-body"
                name="bodySnapshot"
                placeholder="Hi {{first_name}}, quick question about {{company}}."
                required
              />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit" disabled={!canSubmitBulkEmail}>
                <Mail size={16} aria-hidden="true" />
                Send bulk email
              </button>
            </div>
          </form>
          <div className="panel-body">
            <div className="chip-row">
              <StatusPill label={`${bulkEligibleAssignments.length} eligible`} tone={bulkEligibleAssignments.length ? "success" : "warning"} />
              <span className="pill">SES-sendable assigned contacts</span>
              <span className="pill">{formatNumber(callReady.length)} call-ready</span>
            </div>
          </div>
        </div>
      </section>

      {!isSdr ? (
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
                        <strong>{assignmentDisplayName(assignment)}</strong>
                        <span>{assignment.email || assignment.title || "No email on record"}</span>
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
      ) : null}
    </>
  );
}

type QueueSnapshot = ReturnType<typeof sdrQueueSnapshot> | SdrQueueReadModel["snapshot"];
type AssignmentView = QueueSnapshot["assignments"][number];

function assignmentDisplayName(assignment: AssignmentView) {
  const contactName = meaningfulName(assignment.contactName);

  if (contactName) {
    return contactName;
  }

  const emailName = displayNameFromEmail(assignment.email);

  if (emailName) {
    return emailName;
  }

  return meaningfulName(assignment.companyName) || "Contact";
}

function assignmentEmailEligible(assignment: AssignmentView) {
  if ("emailEligible" in assignment) {
    return assignment.emailEligible;
  }

  return Boolean(assignment.email && assignment.grade !== "D" && assignment.grade !== "S" && assignment.priority !== "S");
}

function recommendedAction(assignment: AssignmentView) {
  if (assignment.slaStatus === "Overdue" || assignment.slaStatus === "Due soon") {
    return "Follow up";
  }

  if (assignment.status === "Replied" || assignment.status === "Interested") {
    return "Reply";
  }

  if (assignment.status === "Meeting Booked") {
    return "Prep meeting";
  }

  if (assignmentEmailEligible(assignment)) {
    return "Send email";
  }

  if (assignment.phone) {
    return "Call";
  }

  return "Review";
}

function isFastEmailEligible(assignment: AssignmentView): assignment is SdrQueueAssignmentReadRow {
  return "emailEligible" in assignment && assignment.emailEligible;
}

function activeStatus(status: string) {
  return !["Won", "Lost", "Disqualified", "Invalid", "Unsubscribed", "Suppressed"].includes(status);
}

function queueWeight(assignment: AssignmentView) {
  const overdueWeight = assignment.slaStatus === "Overdue" ? 0 : assignment.slaStatus === "Due soon" ? 1 : 2;
  const priority = assignment.priority === "P1" ? 0 : assignment.priority === "P2" ? 1 : assignment.priority === "P3" ? 2 : 3;
  const due = assignment.dueAt ? Date.parse(assignment.dueAt) / 1_000_000_000_000 : 9;

  return overdueWeight * 10 + priority + due;
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

function meaningfulName(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.toLowerCase();

  if (
    normalized === "unknown contact" ||
    normalized === "unknown account" ||
    normalized === "no primary contact" ||
    normalized === "no contact"
  ) {
    return "";
  }

  return trimmed;
}

function displayNameFromEmail(email?: string) {
  const localPart = email?.split("@")[0]?.trim();

  if (!localPart) {
    return "";
  }

  const words = localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);

  if (!words.length) {
    return "";
  }

  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

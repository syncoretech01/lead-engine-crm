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
import { SubmitButton } from "@/components/submit-button";
import { statusTone } from "@/components/status-pill";
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
import { Button, buttonVariants } from "@/components/ui/button";
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
                <Button type="submit" variant="outline">
                  <RefreshCw aria-hidden="true" />
                  Run assignment
                </Button>
              </form>
            ) : null}
            <Button asChild>
              <Link href={isSdr ? "/crm/contacts" : "/sdr/manager"}>
                <Users aria-hidden="true" />
                {isSdr ? "My contacts" : "Manager dashboard"}
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Queue metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <section aria-label="Queue lanes" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Priority work"
          subtitle="Sorted by overdue status, P1 priority, due date, and available channel."
          action={<StatusBadge label={`${priorityQueue.length} visible`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
                <TableHead>Status</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {priorityQueue.map((assignment) => {
                const contactName = assignmentDisplayName(assignment);
                const nextAction = recommendedAction(assignment);

                return (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <Link href={`/crm/contacts/${assignment.contactId}`} className="flex flex-col">
                        <span className="font-medium text-foreground">{contactName}</span>
                        <span className="text-xs text-muted-foreground">
                          {assignment.email || assignment.title || "No email on record"}
                        </span>
                        <span className="text-xs text-muted-foreground">{assignment.companyName}</span>
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge label={assignment.priority} tone={assignment.priority === "P1" ? "success" : "info"} />
                        <StatusBadge label={assignment.grade} />
                      </div>
                    </TableCell>
                    {!isSdr ? (
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{assignment.ownerName}</span>
                          <span className="text-xs text-muted-foreground">{assignment.teamName}</span>
                        </div>
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <StatusBadge label={assignment.status} tone={statusTone(assignment.status)} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={assignment.slaStatus} tone={slaTone(assignment.slaStatus)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {assignment.dueAt ? formatDate(assignment.dueAt) : "No active SLA"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {assignment.reminderTitle ?? assignment.dueLabel}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {assignmentEmailEligible(assignment) ? <StatusBadge label="Email" tone="success" /> : null}
                        {assignment.phone ? <StatusBadge label="Call" tone="info" /> : null}
                        {!assignmentEmailEligible(assignment) && !assignment.phone ? <StatusBadge label="Review" /> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/crm/contacts/${assignment.contactId}`}>
                          {nextAction}
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {priorityQueue.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSdr ? 6 : 7} className="text-muted-foreground">
                    No active SDR assignments need work right now.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Log touch"
          subtitle="Record an outcome, set the next follow-up, and update the assignment timeline."
          action={<ToneIcon icon={Send} tone="info" />}
        >
          <form action={logFirstTouchAction} className="flex flex-col gap-4">
            {isSdr ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{telephonyNote}</div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="assignmentId" className="text-xs font-medium text-muted-foreground">Lead</label>
              <select id="assignmentId" name="assignmentId" required>
                {activeAssignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignmentDisplayName(assignment)} - {assignment.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="channel" className="text-xs font-medium text-muted-foreground">Channel</label>
              <select id="channel" name="channel" defaultValue="Email">
                {outreachChannels.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="outcome" className="text-xs font-medium text-muted-foreground">Outcome</label>
              <select id="outcome" name="outcome" defaultValue="Contacted">
                {touchStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="followUpDueAt" className="text-xs font-medium text-muted-foreground">Follow-up due</label>
              <input id="followUpDueAt" name="followUpDueAt" type="datetime-local" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="notes" className="text-xs font-medium text-muted-foreground">Notes</label>
              <textarea id="notes" name="notes" placeholder="Call outcome, objection, next step, or reply summary" />
            </div>
            <div>
              <SubmitButton className={buttonVariants()} pendingLabel="Saving…">
                <Send aria-hidden="true" />
                Save touch
              </SubmitButton>
            </div>
          </form>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Follow-up reminders"
          subtitle="Open reminders sorted by due date."
          action={<ToneIcon icon={Clock} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            {openReminders.map((reminder) => (
              <div key={reminder.id} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{reminder.title}</span>
                  <StatusBadge label={reminder.status} tone={statusTone(reminder.status)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {reminder.companyName} - {reminder.channel} - {formatDate(reminder.dueAt)} ({reminder.dueLabel})
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/crm/contacts/${reminder.contactId}`}>
                      <ArrowRight aria-hidden="true" />
                      Contact
                    </Link>
                  </Button>
                  <form action={completeFollowUpReminderAction}>
                    <input name="id" type="hidden" value={reminder.id} />
                    <SubmitButton className={buttonVariants({ size: "sm" })} pendingLabel="Completing…">
                      Complete
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
            {openReminders.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <Clock className="size-6" aria-hidden="true" />
                <span>No open follow-up reminders.</span>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Bulk email assigned contacts"
          subtitle="Send one SES-backed email to eligible active assignments in this queue scope."
          action={<ToneIcon icon={Mail} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            <form action={sendAssignedBulkEmailAction} className="flex flex-col gap-4">
              <input name="requestId" type="hidden" value={bulkRequestId} />
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{bulkSenderNote}</div>
              {canSelectBulkOwner ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bulk-owner" className="text-xs font-medium text-muted-foreground">Owner</label>
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
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-audience" className="text-xs font-medium text-muted-foreground">Audience</label>
                <select id="bulk-audience" name="audience" defaultValue="all_assigned">
                  <option value="all_assigned">All eligible assigned</option>
                  <option value="p1">P1 assigned</option>
                  <option value="due_or_overdue">Due or overdue</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-limit" className="text-xs font-medium text-muted-foreground">Max sends</label>
                <input
                  id="bulk-limit"
                  name="limit"
                  type="number"
                  min="1"
                  max="50"
                  defaultValue={Math.min(Math.max(bulkEligibleAssignments.length, 1), 25)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-subject" className="text-xs font-medium text-muted-foreground">Subject</label>
                <input id="bulk-subject" name="subject" defaultValue="Quick question about {{company}}" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-body" className="text-xs font-medium text-muted-foreground">Body</label>
                <textarea
                  id="bulk-body"
                  name="bodySnapshot"
                  placeholder="Hi {{first_name}}, quick question about {{company}}."
                  required
                />
              </div>
              <div>
                <SubmitButton className={buttonVariants()} pendingLabel="Sending…" disabled={!canSubmitBulkEmail}>
                  <Mail aria-hidden="true" />
                  Send bulk email
                </SubmitButton>
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-4">
              <StatusBadge
                label={`${bulkEligibleAssignments.length} eligible`}
                tone={bulkEligibleAssignments.length ? "success" : "warning"}
              />
              <StatusBadge label="SES-sendable assigned contacts" />
              <StatusBadge label={`${formatNumber(callReady.length)} call-ready`} />
            </div>
          </div>
        </Panel>
      </section>

      {!isSdr ? (
        <section aria-label="Assignment directory">
          <Panel
            title="Assignment directory"
            subtitle="All active and historical assignments for this queue scope."
            action={<StatusBadge label={`${formatNumber(snapshot.assignments.length)} assignments`} tone="info" />}
            flush
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Touches</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <Link href={`/crm/contacts/${assignment.contactId}`} className="flex flex-col">
                        <span className="font-medium text-foreground">{assignmentDisplayName(assignment)}</span>
                        <span className="text-xs text-muted-foreground">
                          {assignment.email || assignment.title || "No email on record"}
                        </span>
                        <span className="text-xs text-muted-foreground">{assignment.companyName}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{assignment.ownerName}</TableCell>
                    <TableCell>
                      <StatusBadge label={assignment.status} tone={statusTone(assignment.status)} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={assignment.slaStatus} tone={slaTone(assignment.slaStatus)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{assignment.assignmentMethod}</span>
                        <span className="text-xs text-muted-foreground">{assignment.assignmentReason}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{assignment.touchCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
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

function slaTone(status: string): "default" | "info" | "success" | "warning" | "danger" {
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

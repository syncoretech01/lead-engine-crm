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
import { userNameForId } from "@/lib/phase1/crm";
import { outreachChannels, sdrLeadStatuses, sdrQueueSnapshot, sdrUsers } from "@/lib/phase1/sdr";
import { resolveUserSenderIdentity } from "@/lib/phase1/sender-identities";
import { resolveUserTelephonyIdentity, telephonyIdentityBlockReason } from "@/lib/phase1/telephony-identities";
import { timelineActivityDisplayForViewer } from "@/lib/phase1/activity-timeline-redaction";
import { SoftphoneButton } from "@/components/softphone-button";
import {
  readFastSdrQueueModel,
  type SdrQueueActivityReadRow,
  type SdrQueueAssignmentReadRow,
  type SdrQueueReadModel
} from "@/lib/phase1/sdr-queue-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { AppState } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { fieldClass, fieldLabelClass, fieldTextareaClass } from "@/components/ui/field";
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
import { TileGrid, TileItem } from "@/components/tile-grid";
import { canCustomizeTiles, readUserTileLayout } from "@/lib/phase1/tile-layouts";
import { MyDay, type MyDayGroup, type MyDayLead } from "@/components/crm/cockpit/my-day";
import { isSdrScheduledFollowUp } from "@/lib/phase1/sdr-calendar";
import { myDayActivityPresentation, myDayActivityTimeLabel } from "@/lib/my-day-activity";

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
  const scheduledFollowUps = snapshot.reminders
    .filter((reminder) => reminder.status !== "Completed" && isSdrScheduledFollowUp(reminder))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .slice(0, 10);
  const callReady = activeAssignments.filter((assignment) => assignment.phone);
  const meetingFollowUps = activeAssignments.filter((assignment) => assignment.status === "Meeting Booked");
  const recentActivityRows = snapshot.recentActivity ?? (
    fallbackState
      ? recentActivityRowsFromState(
          fallbackState,
          workspaceId,
          isSdr ? session.user.id : undefined,
          snapshot.assignments,
          snapshot.reminders
        )
      : []
  );

  // SDRs get the redesigned "My Day" landing (SDR Cockpit §1); managers/admins keep
  // the routing + bulk-email + assignment-directory tooling below.
  if (isSdr) {
    return (
      <MyDay
        {...buildMyDayProps({
          assignments: activeAssignments,
          reminders: scheduledFollowUps,
          activities: recentActivityRows,
          dailyCallPlan: snapshot.dailyCallPlan,
          sdrName: session.user.name
        })}
      />
    );
  }
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
  const recentActivityItems = recentActivityRows.flatMap((activity) => {
    const display = timelineActivityDisplayForViewer({
      activity,
      actorName: activity.actorName,
      viewerRole: session.role,
      viewerName: session.user.name
    });

    if (display.hidden) {
      return [];
    }

    return [
      {
        ...activity,
        title: display.title,
        body: display.body,
        actorName: display.actor ?? activity.actorName
      }
    ];
  }).slice(0, 10);

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
      note: "Follow-up or reminder misses",
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

  const canCustomize = canCustomizeTiles(session);
  const savedLayout = await readUserTileLayout(session.user.id, "sdr-queue");

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
              <Link href={isSdr ? "/crm/my-contacts" : "/sdr/manager"}>
                <Users aria-hidden="true" />
                {isSdr ? "My contacts" : "Manager dashboard"}
              </Link>
            </Button>
          </>
        }
      />

      <TileGrid pageKey="sdr-queue" canCustomize={canCustomize} saved={savedLayout}>
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

        <TileItem id="priority-work" x={0} y={4} w={7} h={8} minW={4} minH={4}>
        <Panel
          title="Priority work"
          subtitle="Sorted by overdue status, P1 priority, due date, and available channel."
          action={<StatusBadge label={`${priorityQueue.length} visible`} tone="info" />}
          flush
          fill
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
                <TableHead>Status</TableHead>
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
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {assignment.dueAt ? formatDate(assignment.dueAt) : "No due date"}
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
                      <div className="flex items-center justify-end gap-2">
                        {assignment.phone ? (
                          <SoftphoneButton
                            contactId={assignment.contactId}
                            contactName={meaningfulName(assignment.contactName)}
                            phone={assignment.phone}
                            callerLabel={
                              currentTelephonyIdentity
                                ? `${currentTelephonyIdentity.displayName} · ${currentTelephonyIdentity.phoneNumber}`
                                : undefined
                            }
                            blockReason={
                              currentTelephonyIdentity ? undefined : telephonyIdentityBlockReason(session.user)
                            }
                            iconOnly
                          />
                        ) : null}
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/crm/contacts/${assignment.contactId}`}>
                            {nextAction}
                            <ArrowRight aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
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
        </TileItem>

        <TileItem id="log-touch" x={7} y={4} w={5} h={8} minW={3} minH={4}>
        <Panel
          title="Log touch"
          subtitle="Record an outcome, set the next follow-up, and update the assignment timeline."
          action={<ToneIcon icon={Send} tone="info" />}
          fill
        >
          <form action={logFirstTouchAction} className="flex flex-col gap-4">
            {isSdr ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{telephonyNote}</div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="assignmentId" className={fieldLabelClass}>Lead</label>
              <select id="assignmentId" name="assignmentId" required className={fieldClass}>
                {activeAssignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignmentDisplayName(assignment)} - {assignment.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="channel" className={fieldLabelClass}>Channel</label>
              <select id="channel" name="channel" defaultValue="Email" className={fieldClass}>
                {outreachChannels.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="outcome" className={fieldLabelClass}>Outcome</label>
              <select id="outcome" name="outcome" defaultValue="Contacted" className={fieldClass}>
                {touchStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="followUpDueAt" className={fieldLabelClass}>Follow-up due</label>
              <input id="followUpDueAt" name="followUpDueAt" type="datetime-local" className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="notes" className={fieldLabelClass}>Notes</label>
              <textarea id="notes" name="notes" placeholder="Call outcome, objection, next step, or reply summary" className={fieldTextareaClass} />
            </div>
            <div>
              <SubmitButton className={buttonVariants()} pendingLabel="Saving…">
                <Send aria-hidden="true" />
                Save touch
              </SubmitButton>
            </div>
          </form>
        </Panel>
        </TileItem>

        <TileItem id="follow-up-reminders" x={0} y={12} w={7} h={7} minW={4} minH={3}>
        <Panel
          title="Follow-up reminders"
          subtitle="Open reminders sorted by due date."
          action={<ToneIcon icon={Clock} tone="info" />}
          fill
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
        </TileItem>

        <TileItem id="bulk-email" x={7} y={12} w={5} h={7} minW={3} minH={4}>
        <Panel
          title="Bulk email assigned contacts"
          subtitle="Send one SES-backed email to eligible active assignments in this queue scope."
          action={<ToneIcon icon={Mail} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-4">
            <form action={sendAssignedBulkEmailAction} className="flex flex-col gap-4">
              <input name="requestId" type="hidden" value={bulkRequestId} />
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{bulkSenderNote}</div>
              {canSelectBulkOwner ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bulk-owner" className={fieldLabelClass}>Owner</label>
                  <select id="bulk-owner" name="ownerUserId" defaultValue="all" className={fieldClass}>
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
                <label htmlFor="bulk-audience" className={fieldLabelClass}>Audience</label>
                <select id="bulk-audience" name="audience" defaultValue="all_assigned" className={fieldClass}>
                  <option value="all_assigned">All eligible assigned</option>
                  <option value="p1">P1 assigned</option>
                  <option value="due_or_overdue">Due or overdue</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-limit" className={fieldLabelClass}>Max sends</label>
                <input
                  id="bulk-limit"
                  name="limit"
                  type="number"
                  min="1"
                  max="50"
                  defaultValue={Math.min(Math.max(bulkEligibleAssignments.length, 1), 25)}
                  className={fieldClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-subject" className={fieldLabelClass}>Subject</label>
                <input id="bulk-subject" name="subject" defaultValue="Quick question about {{company}}" required className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-body" className={fieldLabelClass}>Body</label>
                <textarea
                  id="bulk-body"
                  name="bodySnapshot"
                  placeholder="Hi {{first_name}}, quick question about {{company}}."
                  required
                  className={fieldTextareaClass}
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
        </TileItem>

        <TileItem id="recent-activity" x={0} y={19} w={12} h={5} minW={6} minH={3}>
        <Panel
          title="Recent activity"
          subtitle={isSdr ? "Latest visible updates across your assigned contacts." : "Latest queue updates across the team."}
          action={<StatusBadge label={`${recentActivityItems.length} events`} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-3">
            {recentActivityItems.map((activity) => {
              const href = activityHref(activity);
              const activityContext = [meaningfulName(activity.contactName), meaningfulName(activity.companyName)]
                .filter(Boolean)
                .join(" - ");

              return (
                <div key={activity.id} className="flex flex-col gap-1.5 border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {href ? (
                        <Link href={href} className="font-medium text-foreground hover:underline">
                          {activity.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{activity.title}</span>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground break-words">
                        {activityContext || "Queue activity"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      <StatusBadge label={activity.type} />
                      <StatusBadge label={formatDate(activity.occurredAt)} />
                    </div>
                  </div>
                  {activity.body ? (
                    <p className="text-sm text-muted-foreground break-words">{activity.body}</p>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{activity.actorName}</span>
                </div>
              );
            })}
            {recentActivityItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <Clock className="size-6" aria-hidden="true" />
                <span>No recent activity in this queue.</span>
              </div>
            ) : null}
          </div>
        </Panel>
        </TileItem>

        {!isSdr ? (
        <TileItem id="assignment-directory" x={0} y={24} w={12} h={7} minW={6} minH={3}>
          <Panel
            title="Assignment directory"
            subtitle="All active and historical assignments for this queue scope."
            action={<StatusBadge label={`${formatNumber(snapshot.assignments.length)} assignments`} tone="info" />}
            flush
            fill
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
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
        </TileItem>
      ) : null}
      </TileGrid>
    </>
  );
}

type QueueSnapshot = (ReturnType<typeof sdrQueueSnapshot> | SdrQueueReadModel["snapshot"]) & {
  recentActivity?: SdrQueueActivityReadRow[];
};
type AssignmentView = QueueSnapshot["assignments"][number];
type ReminderView = QueueSnapshot["reminders"][number];

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

// Shapes the SDR "My Day" landing from the same queue snapshot the manager view
// uses: each active lead lands in its first-matching work group (deep-linking to
// the Focus workspace with the matching queue view), plus follow-ups, replies,
// and today's progress.
function buildMyDayProps({
  assignments,
  reminders,
  activities,
  dailyCallPlan,
  sdrName
}: {
  assignments: AssignmentView[];
  reminders: ReminderView[];
  activities: SdrQueueActivityReadRow[];
  dailyCallPlan: QueueSnapshot["dailyCallPlan"];
  sdrName: string;
}) {
  const groupDefs: Array<{
    id: string;
    label: string;
    tone: MyDayGroup["tone"];
    view: string;
    match: (a: AssignmentView) => boolean;
  }> = [
    { id: "overdue", label: "Overdue", tone: "red", view: "overdue", match: (a) => a.slaStatus === "Overdue" },
    { id: "p1", label: "P1 leads", tone: "blue", view: "p1", match: (a) => a.priority === "P1" },
    { id: "due", label: "Due today", tone: "amber", view: "due", match: (a) => a.slaStatus === "Due soon" },
    {
      id: "replied",
      label: "Recently replied",
      tone: "teal",
      view: "replied",
      match: (a) => a.status === "Replied" || a.status === "Interested"
    },
    { id: "meeting", label: "Meeting follow-up", tone: "teal", view: "meeting", match: (a) => a.status === "Meeting Booked" },
    { id: "nurture", label: "Nurture", tone: "gray", view: "nurture", match: (a) => a.status === "Nurture" },
    { id: "other", label: "Working", tone: "gray", view: "all", match: () => true }
  ];

  const buckets = new Map<string, MyDayLead[]>(groupDefs.map((def) => [def.id, []]));
  for (const a of assignments) {
    const def = groupDefs.find((item) => item.match(a)) ?? groupDefs[groupDefs.length - 1];
    const dueTone: MyDayLead["dueTone"] =
      a.slaStatus === "Overdue" ? "red" : a.slaStatus === "Due soon" ? "amber" : "muted";
    buckets.get(def.id)!.push({
      contactId: a.contactId,
      name: assignmentDisplayName(a),
      title: a.title,
      company: a.companyName,
      dueLabel: a.dueLabel,
      dueTone,
      priority: a.priority,
      status: a.status,
      hasPhone: Boolean(a.phone),
      blocked: a.status === "Suppressed" ? "Suppressed" : a.status === "Unsubscribed" ? "DNC" : undefined,
      view: def.view
    });
  }

  const groups: MyDayGroup[] = groupDefs
    .map((def) => ({ id: def.id, label: def.label, tone: def.tone, leads: buckets.get(def.id)! }))
    .filter((group) => group.leads.length > 0);

  const followUps = reminders.slice(0, 6).map((reminder) => ({
    id: reminder.id,
    title: reminder.title,
    company: reminder.companyName,
    dueLabel: reminder.dueLabel,
    contactId: reminder.contactId,
    isMeeting: /meeting/i.test(reminder.title) || reminder.channel === "Meeting"
  }));

  const recentActivity = activities.slice(0, 6).map((activity) => {
    const contactName = meaningfulName(activity.contactName);
    const companyName = meaningfulName(activity.companyName);
    const presentation = myDayActivityPresentation(activity);

    return {
      id: activity.id,
      kind: presentation.kind,
      verb: presentation.verb,
      contactName: contactName || companyName || "Contact",
      companyName: contactName ? companyName || "Unknown account" : "Account activity",
      timeLabel: myDayActivityTimeLabel(activity.occurredAt),
      href: activityHref(activity)
    };
  });

  const replies = assignments
    .filter((a) => a.status === "Replied" || a.status === "Interested")
    .slice(0, 6)
    .map((a) => ({ contactId: a.contactId, name: assignmentDisplayName(a), company: a.companyName, status: a.status }));

  return {
    todayLabel: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }),
    sdrName,
    metrics: {
      callsToday: dailyCallPlan.completedToday,
      callTarget: dailyCallPlan.target,
      remainingToday: dailyCallPlan.remainingToday,
      cyclePass: dailyCallPlan.pass,
      batchRemaining: dailyCallPlan.batchRemaining
    },
    groups,
    recentActivity,
    followUps,
    replies,
    startHref: "/sdr/focus?start=1",
    queueCount: assignments.length
  };
}

function activityHref(activity: SdrQueueActivityReadRow) {
  if (activity.contactId) {
    return `/crm/contacts/${activity.contactId}`;
  }

  if (activity.companyId) {
    return `/crm/accounts/${activity.companyId}`;
  }

  return undefined;
}

function recentActivityRowsFromState(
  state: AppState,
  workspaceId: string,
  ownerUserId: string | undefined,
  assignments: AssignmentView[],
  reminders: ReminderView[]
): SdrQueueActivityReadRow[] {
  const scopedContactIds = new Set<string>();
  const scopedCompanyIds = new Set<string>();

  for (const assignment of assignments) {
    if (assignment.contactId) scopedContactIds.add(assignment.contactId);
    if (assignment.companyId) scopedCompanyIds.add(assignment.companyId);
  }

  for (const reminder of reminders) {
    if (reminder.contactId) scopedContactIds.add(reminder.contactId);
    if (reminder.companyId) scopedCompanyIds.add(reminder.companyId);
  }

  return state.activities
    .filter((activity) => activity.workspaceId === workspaceId)
    .filter((activity) => {
      if (!ownerUserId) {
        return true;
      }

      if (activity.actorUserId !== ownerUserId) {
        return false;
      }

      return Boolean(
        (activity.contactId && scopedContactIds.has(activity.contactId)) ||
          (activity.companyId && scopedCompanyIds.has(activity.companyId))
      );
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 16)
    .map((activity) => {
      const contact = state.contacts.find(
        (item) => item.id === activity.contactId && item.workspaceId === workspaceId
      );
      const companyId = activity.companyId ?? contact?.companyId;
      const company = state.companies.find((item) => item.id === companyId && item.workspaceId === workspaceId);

      return {
        id: activity.id,
        workspaceId: activity.workspaceId,
        companyId,
        contactId: activity.contactId,
        type: activity.type,
        title: activity.title,
        body: activity.body,
        actorName: userNameForId(state, activity.actorUserId),
        contactName: displayContactLabel(contact?.name, contact?.email),
        companyName: company?.name ?? "Unknown account",
        occurredAt: activity.createdAt
      } satisfies SdrQueueActivityReadRow;
    });
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

function displayContactLabel(name?: string, email?: string) {
  return meaningfulName(name) || displayNameFromEmail(email) || "Contact";
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

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Mail,
  MessageSquare,
  Mic,
  Phone,
  Send
} from "lucide-react";
import {
  recordEmailEventAction,
  recordSmsEventAction,
  recordTrackedCallAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { statusTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
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
import { fieldClass, fieldLabelClass, fieldTextareaClass } from "@/components/ui/field";
import {
  callDispositions,
  emailEventTypes,
  outreachDashboardSnapshot,
  smsEventStatuses,
  trackedCallStatuses
} from "@/lib/phase1/outreach";
import {
  outreachEventReadRowsForWorkspace,
  stateWithOutreachEventReadRows
} from "@/lib/phase1/outreach-read-path";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { ownedCrmRecordScope } from "@/lib/phase1/queries";
import { recordingConsentStatuses } from "@/lib/phase1/compliance";
import { readFastOutreachDashboardModel } from "@/lib/phase1/outreach-dashboard-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  channel: "Email" | "SMS" | "Call";
  contactName: string;
  companyName: string;
  campaignName?: string;
  status: string;
  detail: string;
  timestamp?: string;
};

export default async function OutreachEventsPage() {
  const sessionContext = await getWorkspaceSessionContext("send_direct_outreach");
  const fastModel = await readFastOutreachDashboardModel(sessionContext.session, sessionContext.workspaceId, {
    scopedToOwnedRecords: true
  });
  let state = fastModel?.state;
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let snapshot = fastModel?.snapshot;
  let contacts = state?.contacts.filter((contact) => contact.workspaceId === workspaceId);
  let campaigns = state?.outreachCampaigns.filter((campaign) => campaign.workspaceId === workspaceId);
  let sequences = fastModel?.sequences;
  let steps = fastModel?.steps;

  if (!fastModel) {
    const context = await getWorkspaceContext("send_direct_outreach");
    state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    const outreachRows = await outreachEventReadRowsForWorkspace(state, workspaceId);
    const readState = stateWithOutreachEventReadRows(state, workspaceId, outreachRows);
    const ownedScope = restrictsToOwnedRecords(session) ? ownedCrmRecordScope(readState, session) : null;
    const scopedState = ownedScope
      ? {
          ...readState,
          emailEvents: readState.emailEvents.filter((event) => (event.contactId ? ownedScope.contactIds.has(event.contactId) : false)),
          smsEvents: readState.smsEvents.filter((event) => (event.contactId ? ownedScope.contactIds.has(event.contactId) : false)),
          trackedCalls: readState.trackedCalls.filter((call) => (call.contactId ? ownedScope.contactIds.has(call.contactId) : false)),
          webhookEvents: []
        }
      : readState;
    snapshot = outreachDashboardSnapshot(scopedState, workspaceId);
    contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
    campaigns = state.outreachCampaigns.filter((campaign) => campaign.workspaceId === workspaceId);
    sequences = state.campaignSequences.filter((sequence) => sequence.workspaceId === workspaceId);
    steps = state.sequenceSteps.filter((step) => step.workspaceId === workspaceId);
  }

  if (!state || !snapshot || !contacts || !campaigns || !sequences || !steps) {
    throw new Error("Unable to load outreach events.");
  }

  const canManageOutreach = session.permissions.includes("manage_outreach");
  const isSdr = session.role === "SDR";

  const emailReplies = snapshot.emailEvents.filter((event) => event.eventType === "Replied");
  const smsReplies = snapshot.smsEvents.filter((event) => event.status === "Replied");
  const bouncedEmails = snapshot.emailEvents.filter((event) => event.eventType === "Bounced");
  const unsubscribedEmails = snapshot.emailEvents.filter((event) => event.eventType === "Unsubscribed");
  const spamComplaints = snapshot.emailEvents.filter((event) => event.eventType === "Spam complaint");
  const smsOptOuts = snapshot.smsEvents.filter((event) => event.optOutFlag);
  const hardStops = [...bouncedEmails, ...unsubscribedEmails, ...spamComplaints, ...smsOptOuts];
  const callWins = snapshot.calls.filter((call) => call.disposition === "Interested" || call.disposition === "Meeting booked");
  const callsWithRecordings = snapshot.calls.filter((call) => call.recordingUrl);
  const responseCount = emailReplies.length + smsReplies.length + callWins.length;
  const eventRows = eventStream(snapshot).slice(0, 40);
  const responseRows = eventRows
    .filter((event) => isResponseStatus(event.status))
    .slice(0, 10);

  const metrics = isSdr
    ? [
        {
          label: "My responses",
          value: formatNumber(responseCount),
          note: `${formatNumber(emailReplies.length)} email, ${formatNumber(smsReplies.length)} SMS, ${formatNumber(callWins.length)} call wins`,
          icon: Mail,
          tone: responseCount ? "success" as const : "info" as const
        },
        {
          label: "Stops",
          value: formatNumber(hardStops.length),
          note: "People who should not receive more outreach",
          icon: AlertTriangle,
          tone: hardStops.length ? "danger" as const : "success" as const
        },
        {
          label: "SMS activity",
          value: formatNumber(snapshot.smsEvents.length),
          note: "Delivery, replies, and failures",
          icon: MessageSquare,
          tone: "info" as const
        },
        {
          label: "Calls logged",
          value: formatNumber(snapshot.calls.length),
          note: `${formatNumber(callsWithRecordings.length)} with recordings`,
          icon: Phone,
          tone: callsWithRecordings.length ? "success" as const : "info" as const
        }
      ]
    : [
        {
          label: "Responses",
          value: formatNumber(responseCount),
          note: `${formatNumber(emailReplies.length)} email, ${formatNumber(smsReplies.length)} SMS, ${formatNumber(callWins.length)} calls`,
          icon: Mail,
          tone: responseCount ? "success" as const : "info" as const
        },
        {
          label: "Hard stops",
          value: formatNumber(hardStops.length),
          note: "Bounces, unsubscribes, complaints, and SMS opt-outs",
          icon: AlertTriangle,
          tone: hardStops.length ? "danger" as const : "success" as const
        },
        {
          label: "SMS events",
          value: formatNumber(snapshot.smsEvents.length),
          note: "RingCentral Local delivery and replies",
          icon: MessageSquare,
          tone: "info" as const
        },
        {
          label: "Recorded calls",
          value: formatNumber(snapshot.calls.length),
          note: `${formatNumber(callsWithRecordings.length)} with recordings`,
          icon: Phone,
          tone: callsWithRecordings.length ? "success" as const : "info" as const
        }
      ];

  const lanes = isSdr
    ? [
        {
          label: "Email replies",
          value: emailReplies.length,
          note: "People to follow up with",
          icon: Mail,
          tone: emailReplies.length ? "success" as const : "info" as const
        },
        {
          label: "SMS replies",
          value: smsReplies.length,
          note: "Inbound text responses",
          icon: MessageSquare,
          tone: smsReplies.length ? "success" as const : "info" as const
        },
        {
          label: "Call wins",
          value: callWins.length,
          note: "Interested or meeting booked",
          icon: Phone,
          tone: callWins.length ? "success" as const : "info" as const
        },
        {
          label: "Do-not-contact",
          value: hardStops.length,
          note: "Suppressed from future outreach",
          icon: AlertTriangle,
          tone: hardStops.length ? "warning" as const : "success" as const
        }
      ]
    : [
        {
          label: "Email replies",
          value: emailReplies.length,
          note: "Replies to route back to SDRs",
          icon: Mail,
          tone: emailReplies.length ? "success" as const : "info" as const
        },
        {
          label: "SMS replies",
          value: smsReplies.length,
          note: "Inbound SMS responses",
          icon: MessageSquare,
          tone: smsReplies.length ? "success" as const : "info" as const
        },
        {
          label: "Call wins",
          value: callWins.length,
          note: "Interested or meeting booked",
          icon: Phone,
          tone: callWins.length ? "success" as const : "info" as const
        },
        {
          label: "Suppression risk",
          value: hardStops.length,
          note: "Hard stops and opt-outs",
          icon: AlertTriangle,
          tone: hardStops.length ? "warning" as const : "success" as const
        }
      ];

  return (
    <>
      <PageHeader
        kicker="CRM outreach"
        title={isSdr ? "My outreach activity" : "Outreach event tracking"}
        copy={
          isSdr
            ? "Track replies, stops, SMS activity, and call outcomes for your assigned contacts."
            : "A CRM-facing activity monitor for replies, bounces, opt-outs, SMS delivery, call recordings, and webhook processing. Provider configuration stays in the developer view."
        }
        actions={
          <>
            {isSdr ? (
              <Button asChild variant="outline">
                <Link href="/crm/contacts">
                  <ArrowRight aria-hidden="true" />
                  Contacts
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/outreach/campaigns">
                  <ArrowRight aria-hidden="true" />
                  Campaigns
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/sdr/queue">
                <Send aria-hidden="true" />
                {isSdr ? "My queue" : "SDR queue"}
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Outreach event metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <section aria-label="Outreach event lanes" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={isSdr ? "My response stream" : "Response stream"}
          subtitle={
            isSdr
              ? "Recent replies and positive call outcomes from assigned contacts."
              : "Recent replies and positive call outcomes that need SDR follow-up."
          }
          action={<StatusBadge label={`${responseRows.length} visible`} tone={responseRows.length ? "success" : "info"} />}
        >
          <div className="flex flex-col gap-4">
            {responseRows.map((event) => (
              <div className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0" key={event.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <strong className="font-medium text-foreground">{event.contactName}</strong>
                    <span className="text-xs text-muted-foreground">{event.companyName}</span>
                  </div>
                  <StatusBadge label={event.status} tone={statusTone(event.status)} />
                </div>
                <p className="text-xs text-muted-foreground">{event.detail}</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge label={event.channel} tone="default" />
                  {event.campaignName ? <StatusBadge label={event.campaignName} tone="default" /> : null}
                  <StatusBadge label={formatDate(event.timestamp)} tone="default" />
                </div>
              </div>
            ))}
            {responseRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No response events are waiting right now.</p>
            ) : null}
          </div>
        </Panel>

        <Panel
          title={isSdr ? "Do-not-contact stops" : "Deliverability stops"}
          subtitle={
            isSdr ? "Contacts that should not receive more outreach." : "Events that suppress or block future outreach."
          }
          action={<StatusBadge label={`${hardStops.length} stops`} tone={hardStops.length ? "danger" : "success"} />}
        >
          <div className="flex flex-col gap-4">
            {bouncedEmails.slice(0, 4).map((event) => (
              <div className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0" key={event.id}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="font-medium text-foreground">{event.contactName}</strong>
                  <StatusBadge label={event.bounceType ? `${event.bounceType} bounce` : "Bounced"} tone="danger" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {event.recipientEmail} {event.smtpCode ? `- SMTP ${event.smtpCode}` : ""}
                </p>
              </div>
            ))}
            {unsubscribedEmails.slice(0, 3).map((event) => (
              <div className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0" key={event.id}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="font-medium text-foreground">{event.contactName}</strong>
                  <StatusBadge label="Unsubscribed" tone="danger" />
                </div>
                <p className="text-xs text-muted-foreground">{event.recipientEmail}</p>
              </div>
            ))}
            {smsOptOuts.slice(0, 3).map((event) => (
              <div className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0" key={event.id}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="font-medium text-foreground">{event.contactName}</strong>
                  <StatusBadge label="SMS opt-out" tone="danger" />
                </div>
                <p className="text-xs text-muted-foreground">{event.toNumber}</p>
              </div>
            ))}
            {hardStops.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hard-stop events recorded.</p>
            ) : null}
          </div>
        </Panel>
      </section>

      <section>
        <Panel
          title="Event stream"
          subtitle={
            isSdr
              ? "Your assigned email, SMS, and call activity sorted by newest event."
              : "Combined email, SMS, and voice activity sorted by newest event timestamp."
          }
          action={<StatusBadge label={`${eventRows.length} latest`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                {!isSdr ? <TableHead>Campaign</TableHead> : null}
                <TableHead>Detail</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eventRows.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <strong className="font-medium text-foreground">{event.contactName}</strong>
                      <span className="text-xs text-muted-foreground">{event.companyName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{event.channel}</TableCell>
                  <TableCell>
                    <StatusBadge label={event.status} tone={statusTone(event.status)} />
                  </TableCell>
                  {!isSdr ? <TableCell className="text-muted-foreground">{event.campaignName ?? "No campaign"}</TableCell> : null}
                  <TableCell className="text-muted-foreground">{event.detail}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(event.timestamp)}</TableCell>
                </TableRow>
              ))}
              {eventRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSdr ? 5 : 6} className="text-muted-foreground">
                    No outreach events have been recorded yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="SMS events"
          subtitle={
            isSdr ? "Text delivery, replies, failures, and opt-outs." : "RingCentral Local delivery, replies, failures, and STOP handling."
          }
          action={<ToneIcon icon={MessageSquare} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Body</TableHead>
                <TableHead>Opt-out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.smsEvents.slice(0, 15).map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <strong className="font-medium text-foreground">{event.contactName}</strong>
                      <span className="text-xs text-muted-foreground">{event.toNumber}</span>
                      <span className="text-xs text-muted-foreground">{event.companyName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge label={event.status} tone={statusTone(event.status)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{event.direction}</TableCell>
                  <TableCell className="text-muted-foreground">{event.body}</TableCell>
                  <TableCell className="text-muted-foreground">{event.optOutFlag ? "Yes" : "No"}</TableCell>
                </TableRow>
              ))}
              {snapshot.smsEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No SMS events have been recorded yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Call recordings"
          subtitle={
            isSdr ? "Logged calls with outcome, summary, recording, and next step." : "Voice events with recording metadata, consent, summary, and next step."
          }
          action={<ToneIcon icon={Phone} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            {snapshot.calls.slice(0, 12).map((call) => (
              <div className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0" key={call.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <strong className="font-medium text-foreground">{call.contactName}</strong>
                    <span className="text-xs text-muted-foreground">{call.companyName}</span>
                  </div>
                  <StatusBadge label={call.disposition} tone={statusTone(call.disposition)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {call.callStatus}, {minutes(call.durationSeconds)} - {call.sdrName}
                </p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge label={call.recordingUrl ? "Recording attached" : "No recording"} tone="default" />
                  <StatusBadge label={`Consent ${call.recordingConsent}`} tone="default" />
                  {call.recordingStoragePath ? <StatusBadge label={call.recordingStoragePath} tone="default" /> : null}
                </div>
                {call.callSummary ? <p className="text-xs text-muted-foreground">{call.callSummary}</p> : null}
                {call.nextStep ? <p className="text-xs text-muted-foreground">Next: {call.nextStep}</p> : null}
              </div>
            ))}
            {snapshot.calls.length === 0 ? (
              <p className="text-xs text-muted-foreground">No calls have been tracked yet.</p>
            ) : null}
          </div>
        </Panel>
      </section>

      {canManageOutreach ? (
      <section>
        <Panel
          title="Webhook receipts"
          subtitle="Signed provider events with idempotency status and processed record links."
          action={
            <StatusBadge
              label={`${formatNumber(snapshot.metrics.webhooksProcessed)} processed / ${formatNumber(snapshot.metrics.webhookDuplicates)} duplicates`}
              tone="success"
            />
          }
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Idempotency key</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.webhookEvents.slice(0, 20).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-muted-foreground">{event.provider}</TableCell>
                  <TableCell className="text-muted-foreground">{event.target}</TableCell>
                  <TableCell className="text-muted-foreground">{event.eventType}</TableCell>
                  <TableCell>
                    <StatusBadge label={event.status} tone={statusTone(event.status)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{event.idempotencyKey}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(event.receivedAt)}</TableCell>
                </TableRow>
              ))}
              {snapshot.webhookEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No webhook receipts have been recorded yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
      </section>
      ) : null}

      {canManageOutreach ? (
      <section className="grid grid-cols-1 gap-4" id="manual-event-capture">
        <Panel
          title="Record email event"
          subtitle="Hard bounces, unsubscribes, and complaints immediately suppress contacts."
          action={<ToneIcon icon={Mail} tone="info" />}
        >
          <form action={recordEmailEventAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emailContactId" className={fieldLabelClass}>Contact</label>
              <select id="emailContactId" name="contactId" required className={fieldClass}>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emailCampaignId" className={fieldLabelClass}>Campaign</label>
              <select id="emailCampaignId" name="campaignId" defaultValue="" className={fieldClass}>
                <option value="">No campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emailSequenceId" className={fieldLabelClass}>Sequence</label>
              <select id="emailSequenceId" name="sequenceId" defaultValue="" className={fieldClass}>
                <option value="">No sequence</option>
                {sequences.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>
                    {sequence.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emailStepId" className={fieldLabelClass}>Step</label>
              <select id="emailStepId" name="sequenceStepId" defaultValue="" className={fieldClass}>
                <option value="">No step</option>
                {steps.map((step) => (
                  <option key={step.id} value={step.id}>
                    Step {step.stepNumber} - {step.channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eventType" className={fieldLabelClass}>Event</label>
              <select id="eventType" name="eventType" defaultValue="Sent" className={fieldClass}>
                {emailEventTypes.map((eventType) => (
                  <option key={eventType} value={eventType}>
                    {eventType}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bounceType" className={fieldLabelClass}>Bounce type</label>
              <select id="bounceType" name="bounceType" defaultValue="" className={fieldClass}>
                <option value="">None</option>
                <option value="Hard">Hard</option>
                <option value="Soft">Soft</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="smtpCode" className={fieldLabelClass}>SMTP code</label>
              <input id="smtpCode" name="smtpCode" placeholder="550" className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="subject" className={fieldLabelClass}>Subject</label>
              <input id="subject" name="subject" placeholder="{{company}} growth list quality" className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bodySnapshot" className={fieldLabelClass}>Body snapshot</label>
              <textarea id="bodySnapshot" name="bodySnapshot" placeholder="Provider payload or body snapshot" className={fieldTextareaClass} />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Record email event
              </Button>
            </div>
          </form>
        </Panel>

        <Panel
          title="Record SMS event"
          subtitle="SMS opt-out events suppress the contact phone for future SMS."
          action={<ToneIcon icon={MessageSquare} tone="info" />}
        >
          <form action={recordSmsEventAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="smsContactId" className={fieldLabelClass}>Contact</label>
              <select id="smsContactId" name="contactId" required className={fieldClass}>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="smsCampaignId" className={fieldLabelClass}>Campaign</label>
              <select id="smsCampaignId" name="campaignId" defaultValue="" className={fieldClass}>
                <option value="">No campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sdrUserId" className={fieldLabelClass}>SDR</label>
              <select id="sdrUserId" name="sdrUserId" defaultValue={state.users[0]?.id} className={fieldClass}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="direction" className={fieldLabelClass}>Direction</label>
              <select id="direction" name="direction" defaultValue="Outbound" className={fieldClass}>
                <option value="Outbound">Outbound</option>
                <option value="Inbound">Inbound</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="status" className={fieldLabelClass}>Status</label>
              <select id="status" name="status" defaultValue="Delivered" className={fieldClass}>
                {smsEventStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="body" className={fieldLabelClass}>Body</label>
              <textarea id="body" name="body" placeholder="SMS payload" className={fieldTextareaClass} />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Record SMS event
              </Button>
            </div>
          </form>
        </Panel>

        <Panel
          title="Record call"
          subtitle="Tracked calls include recording, consent, transcript, summary, and next step."
          action={<ToneIcon icon={Mic} tone="info" />}
        >
          <form action={recordTrackedCallAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="callContactId" className={fieldLabelClass}>Contact</label>
              <select id="callContactId" name="contactId" required className={fieldClass}>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="callSdrUserId" className={fieldLabelClass}>SDR</label>
              <select id="callSdrUserId" name="sdrUserId" defaultValue={state.users[0]?.id} className={fieldClass}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="callStatus" className={fieldLabelClass}>Status</label>
              <select id="callStatus" name="callStatus" defaultValue="Connected" className={fieldClass}>
                {trackedCallStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="disposition" className={fieldLabelClass}>Disposition</label>
              <select id="disposition" name="disposition" defaultValue="Interested" className={fieldClass}>
                {callDispositions.map((disposition) => (
                  <option key={disposition} value={disposition}>
                    {disposition}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="durationSeconds" className={fieldLabelClass}>Duration seconds</label>
              <input id="durationSeconds" name="durationSeconds" type="number" min="0" defaultValue="300" className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="recordingUrl" className={fieldLabelClass}>Recording URL</label>
              <input id="recordingUrl" name="recordingUrl" placeholder="https://recordings.syncore.local/call.mp3" className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="recordingConsent" className={fieldLabelClass}>Recording consent</label>
              <select id="recordingConsent" name="recordingConsent" defaultValue="Unknown" className={fieldClass}>
                {recordingConsentStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="recordingConsentSource" className={fieldLabelClass}>Consent source</label>
              <input id="recordingConsentSource" name="recordingConsentSource" placeholder="Verbal disclosure at call start" className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="callSummary" className={fieldLabelClass}>Summary</label>
              <textarea id="callSummary" name="callSummary" placeholder="Call summary" className={fieldTextareaClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nextStep" className={fieldLabelClass}>Next step</label>
              <input id="nextStep" name="nextStep" placeholder="Send ROI one-pager" className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="transcript" className={fieldLabelClass}>Transcript</label>
              <textarea id="transcript" name="transcript" placeholder="Transcript excerpt" className={fieldTextareaClass} />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Record call
              </Button>
            </div>
          </form>
        </Panel>
      </section>
      ) : null}
    </>
  );
}

function eventStream(snapshot: ReturnType<typeof outreachDashboardSnapshot>): EventRow[] {
  const rows: EventRow[] = [
    ...snapshot.emailEvents.map((event) => ({
      id: event.id,
      channel: "Email" as const,
      contactName: event.contactName,
      companyName: event.companyName,
      campaignName: event.campaignName,
      status: event.eventType,
      detail: event.subject || event.bodySnapshot || event.messageId,
      timestamp: emailTimestamp(event)
    })),
    ...snapshot.smsEvents.map((event) => ({
      id: event.id,
      channel: "SMS" as const,
      contactName: event.contactName,
      companyName: event.companyName,
      campaignName: undefined,
      status: event.status,
      detail: event.body,
      timestamp: event.repliedAt ?? event.deliveredAt ?? event.failedAt ?? event.createdAt
    })),
    ...snapshot.calls.map((call) => ({
      id: call.id,
      channel: "Call" as const,
      contactName: call.contactName,
      companyName: call.companyName,
      campaignName: undefined,
      status: call.disposition,
      detail: call.callSummary ?? call.nextStep ?? `${call.callStatus}, ${minutes(call.durationSeconds)}`,
      timestamp: call.createdAt
    }))
  ];

  return rows.sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? ""));
}


function emailTimestamp(event: ReturnType<typeof outreachDashboardSnapshot>["emailEvents"][number]) {
  return (
    event.unsubscribeAt ??
    event.bouncedAt ??
    event.repliedAt ??
    event.clickedAt ??
    event.openedAt ??
    event.deliveredAt ??
    event.sentAt
  );
}

function isResponseStatus(status: string) {
  return ["Replied", "Interested", "Meeting booked", "Clicked", "Opened"].includes(status);
}

function minutes(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function formatDate(value?: string) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

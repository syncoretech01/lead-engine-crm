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
import { StatusPill, statusTone } from "@/components/status-pill";
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
import { StatCard, LaneCard } from "@/components/ui-metrics";

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

  const metrics = [
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

  const lanes = [
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
        title="Outreach event tracking"
        copy="A CRM-facing activity monitor for replies, bounces, opt-outs, SMS delivery, call recordings, and webhook processing. Provider configuration stays in the developer view."
        actions={
          <>
            <Link href="/outreach/campaigns" className="button secondary">
              <ArrowRight size={17} aria-hidden="true" />
              Campaigns
            </Link>
            <Link href="/sdr/queue" className="button primary">
              <Send size={17} aria-hidden="true" />
              SDR queue
            </Link>
          </>
        }
      />

      <section className="stat-grid" aria-label="Outreach event metrics">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="Outreach event lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Response stream</h2>
              <p className="section-subtitle">Recent replies and positive call outcomes that need SDR follow-up.</p>
            </div>
            <StatusPill label={`${responseRows.length} visible`} tone={responseRows.length ? "success" : "info"} />
          </div>
          <div className="panel-body stage-list">
            {responseRows.map((event) => (
              <div className="stage-row" key={event.id}>
                <div className="stage-meta">
                  <div className="entity">
                    <strong>{event.contactName}</strong>
                    <span>{event.companyName}</span>
                  </div>
                  <StatusPill label={event.status} tone={statusTone(event.status)} />
                </div>
                <p className="section-subtitle">{event.detail}</p>
                <div className="chip-row">
                  <span className="pill">{event.channel}</span>
                  {event.campaignName ? <span className="pill">{event.campaignName}</span> : null}
                  <span className="pill">{formatDate(event.timestamp)}</span>
                </div>
              </div>
            ))}
            {responseRows.length === 0 ? <p className="section-subtitle">No response events are waiting right now.</p> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Deliverability stops</h2>
              <p className="section-subtitle">Events that suppress or block future outreach.</p>
            </div>
            <StatusPill label={`${hardStops.length} stops`} tone={hardStops.length ? "danger" : "success"} />
          </div>
          <div className="panel-body stage-list">
            {bouncedEmails.slice(0, 4).map((event) => (
              <div className="stage-row" key={event.id}>
                <div className="stage-meta">
                  <strong>{event.contactName}</strong>
                  <StatusPill label={event.bounceType ? `${event.bounceType} bounce` : "Bounced"} tone="danger" />
                </div>
                <p className="section-subtitle">
                  {event.recipientEmail} {event.smtpCode ? `- SMTP ${event.smtpCode}` : ""}
                </p>
              </div>
            ))}
            {unsubscribedEmails.slice(0, 3).map((event) => (
              <div className="stage-row" key={event.id}>
                <div className="stage-meta">
                  <strong>{event.contactName}</strong>
                  <StatusPill label="Unsubscribed" tone="danger" />
                </div>
                <p className="section-subtitle">{event.recipientEmail}</p>
              </div>
            ))}
            {smsOptOuts.slice(0, 3).map((event) => (
              <div className="stage-row" key={event.id}>
                <div className="stage-meta">
                  <strong>{event.contactName}</strong>
                  <StatusPill label="SMS opt-out" tone="danger" />
                </div>
                <p className="section-subtitle">{event.toNumber}</p>
              </div>
            ))}
            {hardStops.length === 0 ? <p className="section-subtitle">No hard-stop events recorded.</p> : null}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Event stream</h2>
            <p className="section-subtitle">Combined email, SMS, and voice activity sorted by newest event timestamp.</p>
          </div>
          <StatusPill label={`${eventRows.length} latest`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Campaign</th>
                <th>Detail</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {eventRows.map((event) => (
                <tr key={event.id}>
                  <td>
                    <div className="entity">
                      <strong>{event.contactName}</strong>
                      <span>{event.companyName}</span>
                    </div>
                  </td>
                  <td>{event.channel}</td>
                  <td>
                    <StatusPill label={event.status} tone={statusTone(event.status)} />
                  </td>
                  <td>{event.campaignName ?? "No campaign"}</td>
                  <td>{event.detail}</td>
                  <td>{formatDate(event.timestamp)}</td>
                </tr>
              ))}
              {eventRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No outreach events have been recorded yet.</td>
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
              <h2 className="section-title">SMS events</h2>
              <p className="section-subtitle">RingCentral Local delivery, replies, failures, and STOP handling.</p>
            </div>
            <MessageSquare size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Direction</th>
                  <th>Body</th>
                  <th>Opt-out</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.smsEvents.slice(0, 15).map((event) => (
                  <tr key={event.id}>
                    <td>
                      <div className="entity">
                        <strong>{event.contactName}</strong>
                        <span>{event.toNumber}</span>
                        <span>{event.companyName}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={event.status} tone={statusTone(event.status)} />
                    </td>
                    <td>{event.direction}</td>
                    <td>{event.body}</td>
                    <td>{event.optOutFlag ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {snapshot.smsEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No SMS events have been recorded yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Call recordings</h2>
              <p className="section-subtitle">Voice events with recording metadata, consent, summary, and next step.</p>
            </div>
            <Phone size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {snapshot.calls.slice(0, 12).map((call) => (
              <div className="stage-row" key={call.id}>
                <div className="stage-meta">
                  <div className="entity">
                    <strong>{call.contactName}</strong>
                    <span>{call.companyName}</span>
                  </div>
                  <StatusPill label={call.disposition} tone={statusTone(call.disposition)} />
                </div>
                <p className="section-subtitle">
                  {call.callStatus}, {minutes(call.durationSeconds)} - {call.sdrName}
                </p>
                <div className="chip-row">
                  <span className="pill">{call.recordingUrl ? "Recording attached" : "No recording"}</span>
                  <span className="pill">Consent {call.recordingConsent}</span>
                  {call.recordingStoragePath ? <span className="pill">{call.recordingStoragePath}</span> : null}
                </div>
                {call.callSummary ? <p className="section-subtitle">{call.callSummary}</p> : null}
                {call.nextStep ? <p className="section-subtitle">Next: {call.nextStep}</p> : null}
              </div>
            ))}
            {snapshot.calls.length === 0 ? <p className="section-subtitle">No calls have been tracked yet.</p> : null}
          </div>
        </div>
      </section>

      {canManageOutreach ? (
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Webhook receipts</h2>
            <p className="section-subtitle">Signed provider events with idempotency status and processed record links.</p>
          </div>
          <StatusPill
            label={`${formatNumber(snapshot.metrics.webhooksProcessed)} processed / ${formatNumber(snapshot.metrics.webhookDuplicates)} duplicates`}
            tone="success"
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Target</th>
                <th>Event</th>
                <th>Status</th>
                <th>Idempotency key</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.webhookEvents.slice(0, 20).map((event) => (
                <tr key={event.id}>
                  <td>{event.provider}</td>
                  <td>{event.target}</td>
                  <td>{event.eventType}</td>
                  <td>
                    <StatusPill label={event.status} tone={statusTone(event.status)} />
                  </td>
                  <td>{event.idempotencyKey}</td>
                  <td>{formatDate(event.receivedAt)}</td>
                </tr>
              ))}
              {snapshot.webhookEvents.length === 0 ? (
                <tr>
                  <td colSpan={6}>No webhook receipts have been recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {canManageOutreach ? (
      <section className="grid" id="manual-event-capture">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Record email event</h2>
              <p className="section-subtitle">Hard bounces, unsubscribes, and complaints immediately suppress contacts.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <form action={recordEmailEventAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="emailContactId">Contact</label>
              <select id="emailContactId" name="contactId" required>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="emailCampaignId">Campaign</label>
              <select id="emailCampaignId" name="campaignId" defaultValue="">
                <option value="">No campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="emailSequenceId">Sequence</label>
              <select id="emailSequenceId" name="sequenceId" defaultValue="">
                <option value="">No sequence</option>
                {sequences.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>
                    {sequence.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="emailStepId">Step</label>
              <select id="emailStepId" name="sequenceStepId" defaultValue="">
                <option value="">No step</option>
                {steps.map((step) => (
                  <option key={step.id} value={step.id}>
                    Step {step.stepNumber} - {step.channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="eventType">Event</label>
              <select id="eventType" name="eventType" defaultValue="Sent">
                {emailEventTypes.map((eventType) => (
                  <option key={eventType} value={eventType}>
                    {eventType}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="bounceType">Bounce type</label>
              <select id="bounceType" name="bounceType" defaultValue="">
                <option value="">None</option>
                <option value="Hard">Hard</option>
                <option value="Soft">Soft</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="smtpCode">SMTP code</label>
              <input id="smtpCode" name="smtpCode" placeholder="550" />
            </div>
            <div className="field">
              <label htmlFor="subject">Subject</label>
              <input id="subject" name="subject" placeholder="{{company}} growth list quality" />
            </div>
            <div className="field">
              <label htmlFor="bodySnapshot">Body snapshot</label>
              <textarea id="bodySnapshot" name="bodySnapshot" placeholder="Provider payload or body snapshot" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Record email event
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Record SMS event</h2>
              <p className="section-subtitle">SMS opt-out events suppress the contact phone for future SMS.</p>
            </div>
            <MessageSquare size={20} aria-hidden="true" />
          </div>
          <form action={recordSmsEventAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="smsContactId">Contact</label>
              <select id="smsContactId" name="contactId" required>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="smsCampaignId">Campaign</label>
              <select id="smsCampaignId" name="campaignId" defaultValue="">
                <option value="">No campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sdrUserId">SDR</label>
              <select id="sdrUserId" name="sdrUserId" defaultValue={state.users[0]?.id}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="direction">Direction</label>
              <select id="direction" name="direction" defaultValue="Outbound">
                <option value="Outbound">Outbound</option>
                <option value="Inbound">Inbound</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue="Delivered">
                {smsEventStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="body">Body</label>
              <textarea id="body" name="body" placeholder="SMS payload" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Record SMS event
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Record call</h2>
              <p className="section-subtitle">Tracked calls include recording, consent, transcript, summary, and next step.</p>
            </div>
            <Mic size={20} aria-hidden="true" />
          </div>
          <form action={recordTrackedCallAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="callContactId">Contact</label>
              <select id="callContactId" name="contactId" required>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="callSdrUserId">SDR</label>
              <select id="callSdrUserId" name="sdrUserId" defaultValue={state.users[0]?.id}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="callStatus">Status</label>
              <select id="callStatus" name="callStatus" defaultValue="Connected">
                {trackedCallStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="disposition">Disposition</label>
              <select id="disposition" name="disposition" defaultValue="Interested">
                {callDispositions.map((disposition) => (
                  <option key={disposition} value={disposition}>
                    {disposition}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="durationSeconds">Duration seconds</label>
              <input id="durationSeconds" name="durationSeconds" type="number" min="0" defaultValue="300" />
            </div>
            <div className="field">
              <label htmlFor="recordingUrl">Recording URL</label>
              <input id="recordingUrl" name="recordingUrl" placeholder="https://recordings.syncore.local/call.mp3" />
            </div>
            <div className="field">
              <label htmlFor="recordingConsent">Recording consent</label>
              <select id="recordingConsent" name="recordingConsent" defaultValue="Unknown">
                {recordingConsentStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="recordingConsentSource">Consent source</label>
              <input id="recordingConsentSource" name="recordingConsentSource" placeholder="Verbal disclosure at call start" />
            </div>
            <div className="field">
              <label htmlFor="callSummary">Summary</label>
              <textarea id="callSummary" name="callSummary" placeholder="Call summary" />
            </div>
            <div className="field">
              <label htmlFor="nextStep">Next step</label>
              <input id="nextStep" name="nextStep" placeholder="Send ROI one-pager" />
            </div>
            <div className="field">
              <label htmlFor="transcript">Transcript</label>
              <textarea id="transcript" name="transcript" placeholder="Transcript excerpt" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Record call
              </button>
            </div>
          </form>
        </div>
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

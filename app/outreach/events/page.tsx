import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Mail,
  MessageSquare,
  Mic,
  Phone,
  ShieldCheck
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
import { recordingConsentStatuses } from "@/lib/phase1/compliance";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OutreachEventsPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_outreach");
  const outreachRows = await outreachEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithOutreachEventReadRows(state, workspaceId, outreachRows);
  const snapshot = outreachDashboardSnapshot(readState, workspaceId);
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const campaigns = state.outreachCampaigns.filter((campaign) => campaign.workspaceId === workspaceId);
  const sequences = state.campaignSequences.filter((sequence) => sequence.workspaceId === workspaceId);
  const steps = state.sequenceSteps.filter((step) => step.workspaceId === workspaceId);

  return (
    <>
      <PageHeader
        kicker="Phase 6"
        title="Outreach event tracking"
        copy="Track email, SMS, calls, recordings, replies, bounces, unsubscribes, and hard suppression automation from local provider events."
        actions={
          <>
            <Link href="/outreach/campaigns" className="button secondary">
              <ArrowRight size={17} aria-hidden="true" />
              Campaigns
            </Link>
            <Link href="/compliance" className="button primary">
              <ShieldCheck size={17} aria-hidden="true" />
              Suppression controls
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Email events</span>
            <Mail size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.emailEvents.length)}</div>
          <span className="metric-note">{formatPercent(snapshot.metrics.replyRate)} reply rate.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">SMS events</span>
            <MessageSquare size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.smsEvents.length)}</div>
          <span className="metric-note">RingCentral Local delivery and opt-out events.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Call records</span>
            <Phone size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.calls.length)}</div>
          <span className="metric-note">{formatNumber(snapshot.metrics.callsRecorded)} with recordings.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Hard stops</span>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.suppressions)}</div>
          <span className="metric-note">Bounces, unsubscribes, complaints, and SMS opt-outs.</span>
        </article>
      </section>

      <section className="grid three">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Record email event</h2>
              <p className="section-subtitle">Hard bounce, unsubscribe, and complaint events immediately suppress contacts.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <form action={recordEmailEventAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="emailContactId">Contact</label>
              <select id="emailContactId" name="contactId" required>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} - {contact.email}
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
              <p className="section-subtitle">SMS Opt-out events suppress the contact phone for future SMS.</p>
            </div>
            <MessageSquare size={20} aria-hidden="true" />
          </div>
          <form action={recordSmsEventAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="smsContactId">Contact</label>
              <select id="smsContactId" name="contactId" required>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} - {contact.phone || "no phone"}
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
              <p className="section-subtitle">Tracked calls include recording URL, storage path, transcript, summary, and next step.</p>
            </div>
            <Mic size={20} aria-hidden="true" />
          </div>
          <form action={recordTrackedCallAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="callContactId">Contact</label>
              <select id="callContactId" name="contactId" required>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} - {contact.phone || "no phone"}
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

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Email event history</h2>
            <p className="section-subtitle">Provider, message ID, event timestamp, bounce data, and raw local payload.</p>
          </div>
          <StatusPill label={`${snapshot.emailEvents.length} events`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Campaign</th>
                <th>Event</th>
                <th>Subject</th>
                <th>Provider</th>
                <th>Bounce</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.emailEvents.slice(0, 30).map((event) => (
                <tr key={event.id}>
                  <td>
                    <div className="entity">
                      <strong>{event.contactName}</strong>
                      <span>{event.recipientEmail}</span>
                      <span>{event.companyName}</span>
                    </div>
                  </td>
                  <td>{event.campaignName}</td>
                  <td>
                    <StatusPill label={event.eventType} tone={statusTone(event.eventType)} />
                  </td>
                  <td>{event.subject}</td>
                  <td>{event.provider}</td>
                  <td>{event.bounceType ? `${event.bounceType} ${event.smtpCode ?? ""}` : "None"}</td>
                  <td>{formatDate(event.unsubscribeAt ?? event.bouncedAt ?? event.repliedAt ?? event.openedAt ?? event.deliveredAt ?? event.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">SMS events</h2>
              <p className="section-subtitle">RingCentral Local status, replies, failures, and STOP handling.</p>
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
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Call recordings</h2>
              <p className="section-subtitle">Voice events with recording metadata, transcript, call summary, and next step.</p>
            </div>
            <Phone size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {snapshot.calls.slice(0, 12).map((call) => (
              <div className="list-row" key={call.id}>
                <div className="row-meta">
                  <strong>{call.contactName}</strong>
                  <StatusPill label={call.disposition} tone={statusTone(call.disposition)} />
                </div>
                <p className="section-subtitle">
                  {call.companyName} - {call.callStatus}, {call.durationSeconds}s - {call.sdrName}
                </p>
                <div className="chip-row">
                  <span className="pill">{call.recordingUrl ? "Recording attached" : "No recording"}</span>
                  <span className="pill">Consent {call.recordingConsent}</span>
                  {call.recordingStoragePath ? <span className="pill">{call.recordingStoragePath}</span> : null}
                </div>
                {call.recordingConsentSource ? <p className="section-subtitle">Consent source: {call.recordingConsentSource}</p> : null}
                {call.callSummary ? <p className="section-subtitle">{call.callSummary}</p> : null}
                {call.nextStep ? <p className="section-subtitle">Next: {call.nextStep}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
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

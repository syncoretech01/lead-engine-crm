import Link from "next/link";
import {
  Activity,
  BarChart3,
  Mail,
  Pause,
  Play,
  Plus,
  RadioTower,
  Send,
  ShieldCheck,
  Workflow
} from "lucide-react";
import {
  createCampaignSequenceAction,
  createOutreachCampaignAction,
  createSequenceStepAction,
  simulateCampaignSendAction,
  updateOutreachProviderStatusAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  campaignStatuses,
  campaignTypes,
  outreachChannels,
  outreachDashboardSnapshot,
  outreachProviderStatuses
} from "@/lib/phase1/outreach";
import {
  outreachEventReadRowsForWorkspace,
  stateWithOutreachEventReadRows
} from "@/lib/phase1/outreach-read-path";
import { defaultPhysicalAddress } from "@/lib/phase1/compliance";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OutreachCampaignsPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_outreach");
  const outreachRows = await outreachEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithOutreachEventReadRows(state, workspaceId, outreachRows);
  const snapshot = outreachDashboardSnapshot(readState, workspaceId);
  const sequences = state.campaignSequences.filter((sequence) => sequence.workspaceId === workspaceId);
  const steps = state.sequenceSteps.filter((step) => step.workspaceId === workspaceId);

  return (
    <>
      <PageHeader
        kicker="Phase 6"
        title="Outreach campaigns"
        copy="Local email, SMS, and voice provider tracking with campaigns, sequences, sequence steps, deliverability guardrails, and provider simulation."
        actions={
          <>
            <Link href="/outreach/events" className="button secondary">
              <Activity size={17} aria-hidden="true" />
              Event tracking
            </Link>
            <Link href="/sdr/queue" className="button primary">
              <Send size={17} aria-hidden="true" />
              SDR queue
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Active campaigns</span>
            <Workflow size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.activeCampaigns)}</div>
          <span className="metric-note">Email, SMS, call, and multichannel campaigns.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Sent</span>
            <Mail size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.sent)}</div>
          <span className="metric-note">Local provider send events.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Reply rate</span>
            <BarChart3 size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatPercent(snapshot.metrics.replyRate)}</div>
          <span className="metric-note">Email and SMS replies.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Bounce rate</span>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatPercent(snapshot.metrics.bounceRate)}</div>
          <span className="metric-note">{formatNumber(snapshot.metrics.suppressions)} hard-stop events.</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Provider connections</h2>
            <p className="section-subtitle">Local stand-ins for email provider and RingCentral SMS/voice integrations.</p>
          </div>
          <RadioTower size={20} aria-hidden="true" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Sender</th>
                <th>Health</th>
                <th>Limits</th>
                <th>Auth</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.providers.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    <div className="entity">
                      <strong>{provider.provider}</strong>
                      <span>{provider.kind}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{provider.senderEmail ?? provider.fromNumber}</strong>
                      <span>{provider.sendingDomain ?? provider.mailboxGroup ?? provider.warmupStage}</span>
                    </div>
                  </td>
                  <td>
                    <div className="chip-row">
                      <span className="pill">Bounce {provider.bounceRate}%</span>
                      <span className="pill">Unsub {provider.unsubscribeRate}%</span>
                      <span className="pill">Complaint {provider.complaintRate}%</span>
                    </div>
                  </td>
                  <td>{provider.sentToday}/{provider.dailyLimit}</td>
                  <td>
                    <div className="chip-row">
                      {provider.kind === "Email" ? (
                        <>
                          <StatusPill label="SPF" tone={provider.spf ? "success" : "warning"} />
                          <StatusPill label="DKIM" tone={provider.dkim ? "success" : "warning"} />
                          <StatusPill label="DMARC" tone={provider.dmarc ? "success" : "warning"} />
                        </>
                      ) : null}
                      <StatusPill label="TLS" tone={provider.tls ? "success" : "warning"} />
                    </div>
                  </td>
                  <td>
                    <form action={updateOutreachProviderStatusAction} className="inline-form">
                      <input name="id" type="hidden" value={provider.id} />
                      <select name="status" defaultValue={provider.status} aria-label="Provider status">
                        {outreachProviderStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <button className="icon-button" type="submit" aria-label="Save provider status">
                        {provider.status === "Paused" ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
                      </button>
                    </form>
                  </td>
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
              <h2 className="section-title">Create campaign</h2>
              <p className="section-subtitle">Campaigns track target segment, sending domain, mailbox group, status, and performance counters.</p>
            </div>
            <Plus size={20} aria-hidden="true" />
          </div>
          <form action={createOutreachCampaignAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="name">Campaign name</label>
              <input id="name" name="name" placeholder="Q3 dealer owner sequence" required />
            </div>
            <div className="field">
              <label htmlFor="campaignType">Type</label>
              <select id="campaignType" name="campaignType" defaultValue="Multichannel">
                {campaignTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="targetSegment">Target segment</label>
              <input id="targetSegment" name="targetSegment" placeholder="High review dealer" />
            </div>
            <div className="field">
              <label htmlFor="sourceJobIds">Source job IDs</label>
              <input id="sourceJobIds" name="sourceJobIds" placeholder="job-1042, job-1038" />
            </div>
            <div className="field">
              <label htmlFor="ownerUserId">Owner</label>
              <select id="ownerUserId" name="ownerUserId" defaultValue={state.users[0]?.id}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue="Draft">
                {campaignStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sendingDomain">Sending domain</label>
              <input id="sendingDomain" name="sendingDomain" defaultValue="outbound.syncore.tech" />
            </div>
            <div className="field">
              <label htmlFor="mailboxGroup">Mailbox group</label>
              <input id="mailboxGroup" name="mailboxGroup" defaultValue="syncore-sdr" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Create campaign
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Create sequence and step</h2>
              <p className="section-subtitle">Sequences stop on reply, bounce, or unsubscribe and steps define channel-specific content.</p>
            </div>
            <Workflow size={20} aria-hidden="true" />
          </div>
          <form action={createCampaignSequenceAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="sequenceCampaignId">Campaign</label>
              <select id="sequenceCampaignId" name="campaignId">
                {snapshot.campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sequenceName">Sequence name</label>
              <input id="sequenceName" name="name" placeholder="Owner first touch" />
            </div>
            <div className="field">
              <label htmlFor="sequenceSegment">Target segment</label>
              <input id="sequenceSegment" name="targetSegment" placeholder="High review dealer" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button secondary" type="submit">
                Create sequence
              </button>
            </div>
          </form>
          <form action={createSequenceStepAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="sequenceId">Sequence</label>
              <select id="sequenceId" name="sequenceId">
                {sequences.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>
                    {sequence.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="stepNumber">Step</label>
              <input id="stepNumber" name="stepNumber" type="number" min="1" defaultValue="1" />
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
              <label htmlFor="delayDays">Delay days</label>
              <input id="delayDays" name="delayDays" type="number" min="0" defaultValue="0" />
            </div>
            <div className="field">
              <label htmlFor="subject">Subject</label>
              <input id="subject" name="subject" placeholder="{{company}} growth list quality" />
            </div>
            <div className="field">
              <label htmlFor="bodyTemplate">Email body</label>
              <textarea id="bodyTemplate" name="bodyTemplate" placeholder="Hi {{first_name}}, ..." />
            </div>
            <div className="field">
              <label htmlFor="physicalAddress">Physical address</label>
              <input id="physicalAddress" name="physicalAddress" defaultValue={defaultPhysicalAddress} />
            </div>
            <div className="field">
              <label htmlFor="smsTemplate">SMS template</label>
              <input id="smsTemplate" name="smsTemplate" placeholder="Quick Syncore note for {{company}}" />
            </div>
            <div className="field">
              <label htmlFor="callScript">Call script</label>
              <input id="callScript" name="callScript" placeholder="Reference source signal and confirm fit" />
            </div>
            <div className="field">
              <label htmlFor="personalizationVariables">Variables</label>
              <input id="personalizationVariables" name="personalizationVariables" placeholder="first_name, company, segment" />
            </div>
            <div className="field">
              <label htmlFor="requiredFields">Required fields</label>
              <input id="requiredFields" name="requiredFields" placeholder="email, phone, company" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Create step
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Campaign performance</h2>
            <p className="section-subtitle">Counters update from email, SMS, call, meeting, opportunity, and revenue events.</p>
          </div>
          <StatusPill label={`${snapshot.campaigns.length} campaigns`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Leads</th>
                <th>Sent</th>
                <th>Replies</th>
                <th>Bounces</th>
                <th>Unsubs</th>
                <th>Meetings</th>
                <th>Revenue won</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <div className="entity">
                      <strong>{campaign.name}</strong>
                      <span>{campaign.targetSegment}</span>
                      <span>{campaign.ownerName}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill label={campaign.status} tone={statusTone(campaign.status)} />
                  </td>
                  <td>{campaign.totalLeads}</td>
                  <td>{campaign.sentCount}</td>
                  <td>{campaign.replyCount} ({campaign.replyRate}%)</td>
                  <td>{campaign.bounceCount} ({campaign.bounceRate}%)</td>
                  <td>{campaign.unsubscribeCount} ({campaign.unsubscribeRate}%)</td>
                  <td>{campaign.meetingsBooked}</td>
                  <td>{formatCurrency(campaign.revenueWon)}</td>
                  <td>
                    <form action={simulateCampaignSendAction}>
                      <input name="campaignId" type="hidden" value={campaign.id} />
                      <button className="button secondary" type="submit">
                        Simulate send
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Sequence steps</h2>
            <p className="section-subtitle">Channel steps with delay rules, templates, scripts, variables, and required fields.</p>
          </div>
          <StatusPill label={`${steps.length} steps`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Step</th>
                <th>Channel</th>
                <th>Delay</th>
                <th>Template/script</th>
                <th>Requirements</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.id}>
                  <td>{sequences.find((sequence) => sequence.id === step.sequenceId)?.name ?? "Unknown sequence"}</td>
                  <td>{step.stepNumber}</td>
                  <td>
                    <StatusPill label={step.channel} tone="info" />
                  </td>
                  <td>{step.delayDays}d</td>
                  <td>
                    <div className="entity">
                      <strong>{step.subject ?? step.smsTemplate ?? step.callScript ?? step.manualTaskInstruction ?? "No copy"}</strong>
                      <span>{step.bodyTemplate}</span>
                    </div>
                  </td>
                  <td>
                    <div className="chip-row">
                      {step.requiredFields.map((field) => (
                        <span className="pill" key={field}>
                          {field}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <StatusPill label={step.complianceStatus} tone={step.complianceStatus === "Compliant" ? "success" : "warning"} />
                      <span>{step.complianceNotes}</span>
                      {step.physicalAddress ? <span>{step.physicalAddress}</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

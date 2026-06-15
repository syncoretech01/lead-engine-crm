import Link from "next/link";
import {
  Activity,
  AlertTriangle,
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
import { ProgressBar } from "@/components/progress-bar";
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
import { formatCurrency, formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function OutreachCampaignsPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_outreach");
  const outreachRows = await outreachEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithOutreachEventReadRows(state, workspaceId, outreachRows);
  const snapshot = outreachDashboardSnapshot(readState, workspaceId);
  const sequences = state.campaignSequences.filter((sequence) => sequence.workspaceId === workspaceId);
  const steps = state.sequenceSteps.filter((step) => step.workspaceId === workspaceId);
  const sentToday = snapshot.providers.reduce((total, provider) => total + provider.sentToday, 0);
  const dailyLimit = snapshot.providers.reduce((total, provider) => total + provider.dailyLimit, 0);
  const emailProviders = snapshot.providers.filter((provider) => provider.kind === "Email");
  const authenticatedEmailProviders = emailProviders.filter((provider) => provider.spf && provider.dkim && provider.dmarc);
  const providerRisk = snapshot.providers.filter(
    (provider) => provider.status !== "Connected" || provider.bounceRate > 3 || provider.complaintRate > 1
  );

  const metrics = [
    {
      label: "Active campaigns",
      value: formatNumber(snapshot.metrics.activeCampaigns),
      note: "Email, SMS, call, and multichannel",
      icon: Workflow,
      tone: "info" as const
    },
    {
      label: "Sent",
      value: formatNumber(snapshot.metrics.sent),
      note: "Local provider send events",
      icon: Mail,
      tone: "success" as const
    },
    {
      label: "Reply rate",
      value: `${snapshot.metrics.replyRate}%`,
      note: "Email and SMS replies",
      icon: BarChart3,
      tone: snapshot.metrics.replyRate ? "success" as const : "info" as const
    },
    {
      label: "Bounce rate",
      value: `${snapshot.metrics.bounceRate}%`,
      note: `${formatNumber(snapshot.metrics.suppressions)} hard-stop events`,
      icon: ShieldCheck,
      tone: snapshot.metrics.bounceRate > 5 ? "danger" as const : "success" as const
    }
  ];

  const lanes = [
    {
      label: "Sender auth",
      value: authenticatedEmailProviders.length,
      note: `${formatNumber(emailProviders.length)} email providers`,
      icon: ShieldCheck,
      tone: authenticatedEmailProviders.length === emailProviders.length ? "success" as const : "warning" as const
    },
    {
      label: "Daily usage",
      value: sentToday,
      note: `${formatNumber(dailyLimit)} total send capacity`,
      icon: Mail,
      tone: dailyLimit && sentToday / dailyLimit > 0.8 ? "warning" as const : "info" as const
    },
    {
      label: "Risk flags",
      value: providerRisk.length,
      note: "Provider health issues",
      icon: AlertTriangle,
      tone: providerRisk.length ? "warning" as const : "success" as const
    },
    {
      label: "Sync events",
      value: snapshot.metrics.webhooksProcessed + snapshot.metrics.callsRecorded,
      note: `${formatNumber(snapshot.metrics.webhooksProcessed)} webhooks, ${formatNumber(snapshot.metrics.callsRecorded)} calls`,
      icon: Activity,
      tone: "info" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="CRM outreach"
        title="Outreach campaigns"
        copy="A CRM-facing campaign control room for sender readiness, active sequences, deliverability signals, and simulated sends. Provider setup remains isolated in the developer view."
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

      <section className="stat-grid" aria-label="Outreach campaign metrics">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="Outreach readiness lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Campaign focus</h2>
              <p className="section-subtitle">Active and recent campaigns with send progress, replies, and deliverability risk.</p>
            </div>
            <StatusPill label={`${snapshot.campaigns.length} campaigns`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Replies</th>
                  <th>Risk</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.campaigns.map((campaign) => {
                  const sentPercent = campaign.totalLeads ? Math.round((campaign.sentCount / campaign.totalLeads) * 100) : 0;

                  return (
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
                      <td>
                        <div className="entity">
                          <strong>
                            {formatNumber(campaign.sentCount)}/{formatNumber(campaign.totalLeads)} sent
                          </strong>
                          <ProgressBar value={sentPercent} />
                        </div>
                      </td>
                      <td>
                        {formatNumber(campaign.replyCount)} ({campaign.replyRate}%)
                      </td>
                      <td>
                        <div className="chip-row">
                          <StatusPill
                            label={`${campaign.bounceRate}% bounce`}
                            tone={campaign.bounceRate > 5 ? "danger" : campaign.bounceRate > 2 ? "warning" : "success"}
                          />
                          <StatusPill
                            label={`${campaign.unsubscribeRate}% unsub`}
                            tone={campaign.unsubscribeRate > 3 ? "warning" : "success"}
                          />
                        </div>
                      </td>
                      <td>
                        <form action={simulateCampaignSendAction}>
                          <input name="campaignId" type="hidden" value={campaign.id} />
                          <button className="button secondary" type="submit">
                            Simulate send
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {snapshot.campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No outreach campaigns have been created yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Provider readiness</h2>
              <p className="section-subtitle">CRM-visible sender status, daily limits, authentication, and local provider health.</p>
            </div>
            <RadioTower size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {snapshot.providers.map((provider) => {
              const usagePercent = provider.dailyLimit ? Math.round((provider.sentToday / provider.dailyLimit) * 100) : 0;

              return (
                <div className="stage-row" key={provider.id}>
                  <div className="stage-meta">
                    <div className="entity">
                      <strong>{provider.provider}</strong>
                      <span>{provider.senderEmail ?? provider.fromNumber}</span>
                    </div>
                    <StatusPill label={provider.status} tone={statusTone(provider.status)} />
                  </div>
                  <ProgressBar value={usagePercent} />
                  <div className="chip-row">
                    <span className="pill">{provider.sentToday}/{provider.dailyLimit} today</span>
                    <span className="pill">Bounce {provider.bounceRate}%</span>
                    <span className="pill">Complaint {provider.complaintRate}%</span>
                    {provider.kind === "Email" ? (
                      <>
                        <StatusPill label="SPF" tone={provider.spf ? "success" : "warning"} />
                        <StatusPill label="DKIM" tone={provider.dkim ? "success" : "warning"} />
                        <StatusPill label="DMARC" tone={provider.dmarc ? "success" : "warning"} />
                      </>
                    ) : null}
                    <StatusPill label="TLS" tone={provider.tls ? "success" : "warning"} />
                  </div>
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
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel" id="create-campaign">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Create campaign</h2>
              <p className="section-subtitle">Create the campaign shell; sequence content and steps can be added after the campaign exists.</p>
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

        <div className="panel" id="sequence-builder">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Sequence builder</h2>
              <p className="section-subtitle">Add a sequence and its next email, SMS, call, or manual step.</p>
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

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Campaign performance</h2>
              <p className="section-subtitle">Revenue, meetings, and engagement counters from local outreach events.</p>
            </div>
            <StatusPill label={`${formatNumber(snapshot.campaigns.length)} campaigns`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Leads</th>
                  <th>Meetings</th>
                  <th>Revenue won</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <div className="entity">
                        <strong>{campaign.name}</strong>
                        <span>{campaign.status}</span>
                      </div>
                    </td>
                    <td>{formatNumber(campaign.totalLeads)}</td>
                    <td>{formatNumber(campaign.meetingsBooked)}</td>
                    <td>{formatCurrency(campaign.revenueWon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Sequence steps</h2>
              <p className="section-subtitle">Channel steps with delay rules, templates, scripts, variables, and compliance notes.</p>
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
                  <th>Template</th>
                  <th>Compliance</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.id}>
                    <td>{sequences.find((sequence) => sequence.id === step.sequenceId)?.name ?? "Unknown sequence"}</td>
                    <td>{step.stepNumber} after {step.delayDays}d</td>
                    <td>
                      <StatusPill label={step.channel} tone="info" />
                    </td>
                    <td>
                      <div className="entity">
                        <strong>{step.subject ?? step.smsTemplate ?? step.callScript ?? step.manualTaskInstruction ?? "No copy"}</strong>
                        <span>{step.bodyTemplate}</span>
                      </div>
                    </td>
                    <td>
                      <div className="entity">
                        <StatusPill label={step.complianceStatus} tone={step.complianceStatus === "Compliant" ? "success" : "warning"} />
                        <span>{step.complianceNotes}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {steps.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No sequence steps have been created yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

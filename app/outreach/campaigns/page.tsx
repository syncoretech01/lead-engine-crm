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
  scoreAndAssignByCampaignAction,
  sendCampaignAction,
  updateOutreachProviderStatusAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { MeterBar } from "@/components/ui/meter-bar";
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
import { statusTone } from "@/components/status-pill";
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
import { readFastOutreachDashboardModel } from "@/lib/phase1/outreach-dashboard-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OutreachCampaignsPage({
  searchParams
}: {
  searchParams?: Promise<{ sendError?: string }>;
}) {
  // A refused send (cold-send guards, rules 8/13) lands back here with the exact
  // remediation in ?sendError — prod redacts thrown server-action messages.
  const sendError = (await searchParams)?.sendError ?? "";
  const sessionContext = await getWorkspaceSessionContext("manage_outreach");
  const fastModel = await readFastOutreachDashboardModel(sessionContext.session, sessionContext.workspaceId);
  let state = fastModel?.state;
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let snapshot = fastModel?.snapshot;
  let sequences = fastModel?.sequences;
  let steps = fastModel?.steps;

  if (!fastModel) {
    const context = await getWorkspaceContext("manage_outreach");
    state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    const outreachRows = await outreachEventReadRowsForWorkspace(state, workspaceId);
    const readState = stateWithOutreachEventReadRows(state, workspaceId, outreachRows);
    snapshot = outreachDashboardSnapshot(readState, workspaceId);
    sequences = state.campaignSequences.filter((sequence) => sequence.workspaceId === workspaceId);
    steps = state.sequenceSteps.filter((step) => step.workspaceId === workspaceId);
  }

  if (!state || !snapshot || !sequences || !steps) {
    throw new Error("Unable to load outreach campaigns.");
  }

  const sentToday = snapshot.providers.reduce((total, provider) => total + provider.sentToday, 0);
  const dailyLimit = snapshot.providers.reduce((total, provider) => total + provider.dailyLimit, 0);
  const emailProviders = snapshot.providers.filter((provider) => provider.kind === "Email");
  const authenticatedEmailProviders = emailProviders.filter((provider) => provider.spf && provider.dkim && provider.dmarc);
  const providerRisk = snapshot.providers.filter(
    (provider) => provider.status !== "Connected" || provider.bounceRate > 3 || provider.complaintRate > 1
  );
  const canAssignByEngagement = session.permissions.includes("manage_sdr_team");

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
      {sendError ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <strong>Send refused:</strong> {sendError}
        </div>
      ) : null}
      <PageHeader
        kicker="CRM outreach"
        title="Outreach campaigns"
        copy="A CRM-facing campaign control room for sender readiness, active sequences, deliverability signals, and simulated sends. Provider setup remains isolated in the developer view."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/outreach/events">
                <Activity aria-hidden="true" />
                Event tracking
              </Link>
            </Button>
            <Button asChild>
              <Link href="/sdr/queue">
                <Send aria-hidden="true" />
                SDR queue
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Outreach campaign metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <section aria-label="Outreach readiness lanes" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          title="Campaign focus"
          subtitle="Active and recent campaigns with send progress, replies, and deliverability risk."
          action={<StatusBadge label={`${snapshot.campaigns.length} campaigns`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Replies</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.campaigns.map((campaign) => {
                const sentPercent = campaign.totalLeads ? Math.round((campaign.sentCount / campaign.totalLeads) * 100) : 0;

                return (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{campaign.name}</span>
                        <span className="text-xs text-muted-foreground">{campaign.targetSegment}</span>
                        <span className="text-xs text-muted-foreground">{campaign.ownerName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={campaign.status} tone={statusTone(campaign.status)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <span className="font-medium text-foreground">
                          {formatNumber(campaign.sentCount)}/{formatNumber(campaign.totalLeads)} sent
                        </span>
                        <MeterBar value={sentPercent} />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatNumber(campaign.replyCount)} ({campaign.replyRate}%)
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge
                          label={`${campaign.bounceRate}% bounce`}
                          tone={campaign.bounceRate > 5 ? "danger" : campaign.bounceRate > 2 ? "warning" : "success"}
                        />
                        <StatusBadge
                          label={`${campaign.unsubscribeRate}% unsub`}
                          tone={campaign.unsubscribeRate > 3 ? "warning" : "success"}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-2">
                        <form action={sendCampaignAction}>
                          <input name="campaignId" type="hidden" value={campaign.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Send campaign
                          </Button>
                        </form>
                        <span className="text-xs text-muted-foreground">Live SES sends one batch; local mode simulates.</span>
                        {canAssignByEngagement && campaign.sentCount > 0 ? (
                          <form action={scoreAndAssignByCampaignAction}>
                            <input name="campaignId" type="hidden" value={campaign.id} />
                            <Button type="submit" variant="outline" size="sm">
                              Score &amp; assign by engagement
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {snapshot.campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No outreach campaigns have been created yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Provider readiness"
          subtitle="CRM-visible sender status, daily limits, authentication, and local provider health."
          action={<ToneIcon icon={RadioTower} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            {snapshot.providers.map((provider) => {
              const usagePercent = provider.dailyLimit ? Math.round((provider.sentToday / provider.dailyLimit) * 100) : 0;

              return (
                <div className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0" key={provider.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{provider.provider}</span>
                      <span className="text-xs text-muted-foreground">{provider.senderEmail ?? provider.fromNumber}</span>
                    </div>
                    <StatusBadge label={provider.status} tone={statusTone(provider.status)} />
                  </div>
                  <MeterBar value={usagePercent} />
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge label={`${provider.sentToday}/${provider.dailyLimit} today`} tone="default" />
                    <StatusBadge label={`Bounce ${provider.bounceRate}%`} tone="default" />
                    <StatusBadge label={`Complaint ${provider.complaintRate}%`} tone="default" />
                    {provider.kind === "Email" ? (
                      <>
                        <StatusBadge label="SPF" tone={provider.spf ? "success" : "warning"} />
                        <StatusBadge label="DKIM" tone={provider.dkim ? "success" : "warning"} />
                        <StatusBadge label="DMARC" tone={provider.dmarc ? "success" : "warning"} />
                      </>
                    ) : null}
                    <StatusBadge label="TLS" tone={provider.tls ? "success" : "warning"} />
                  </div>
                  <form action={updateOutreachProviderStatusAction} className="flex items-center gap-2">
                    <input name="id" type="hidden" value={provider.id} />
                    <select name="status" defaultValue={provider.status} aria-label="Provider status" className={fieldClass}>
                      {outreachProviderStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="outline" size="icon" aria-label="Save provider status">
                      {provider.status === "Paused" ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                    </Button>
                  </form>
                </div>
              );
            })}
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div id="create-campaign">
          <Panel
            title="Create campaign"
            subtitle="Create the campaign shell; sequence content and steps can be added after the campaign exists."
            action={<ToneIcon icon={Plus} tone="info" />}
          >
            <form action={createOutreachCampaignAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="name" className={fieldLabelClass}>
                  Campaign name
                </label>
                <input id="name" name="name" placeholder="Q3 dealer owner sequence" required className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="campaignType" className={fieldLabelClass}>
                  Type
                </label>
                <select id="campaignType" name="campaignType" defaultValue="Multichannel" className={fieldClass}>
                  {campaignTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="targetSegment" className={fieldLabelClass}>
                  Target segment
                </label>
                <input id="targetSegment" name="targetSegment" placeholder="High review dealer" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sourceJobIds" className={fieldLabelClass}>
                  Source job IDs
                </label>
                <input id="sourceJobIds" name="sourceJobIds" placeholder="job-1042, job-1038" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ownerUserId" className={fieldLabelClass}>
                  Owner
                </label>
                <select id="ownerUserId" name="ownerUserId" defaultValue={state.users[0]?.id} className={fieldClass}>
                  {state.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="status" className={fieldLabelClass}>
                  Status
                </label>
                <select id="status" name="status" defaultValue="Draft" className={fieldClass}>
                  {campaignStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sendingDomain" className={fieldLabelClass}>
                  Sending domain
                </label>
                <input id="sendingDomain" name="sendingDomain" defaultValue="outbound.syncore.tech" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mailboxGroup" className={fieldLabelClass}>
                  Mailbox group
                </label>
                <input id="mailboxGroup" name="mailboxGroup" defaultValue="syncore-sdr" className={fieldClass} />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full">
                  Create campaign
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        <div id="sequence-builder">
          <Panel
            title="Sequence builder"
            subtitle="Add a sequence and its next email, SMS, call, or manual step."
            action={<ToneIcon icon={Workflow} tone="info" />}
          >
            <div className="flex flex-col gap-6">
              <form action={createCampaignSequenceAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sequenceCampaignId" className={fieldLabelClass}>
                    Campaign
                  </label>
                  <select id="sequenceCampaignId" name="campaignId" className={fieldClass}>
                    {snapshot.campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sequenceName" className={fieldLabelClass}>
                    Sequence name
                  </label>
                  <input id="sequenceName" name="name" placeholder="Owner first touch" className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sequenceSegment" className={fieldLabelClass}>
                    Target segment
                  </label>
                  <input id="sequenceSegment" name="targetSegment" placeholder="High review dealer" className={fieldClass} />
                </div>
                <div className="flex items-end">
                  <Button type="submit" variant="outline" className="w-full">
                    Create sequence
                  </Button>
                </div>
              </form>
              <form action={createSequenceStepAction} className="grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sequenceId" className={fieldLabelClass}>
                    Sequence
                  </label>
                  <select id="sequenceId" name="sequenceId" className={fieldClass}>
                    {sequences.map((sequence) => (
                      <option key={sequence.id} value={sequence.id}>
                        {sequence.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="stepNumber" className={fieldLabelClass}>
                    Step
                  </label>
                  <input id="stepNumber" name="stepNumber" type="number" min="1" defaultValue="1" className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="channel" className={fieldLabelClass}>
                    Channel
                  </label>
                  <select id="channel" name="channel" defaultValue="Email" className={fieldClass}>
                    {outreachChannels.map((channel) => (
                      <option key={channel} value={channel}>
                        {channel}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="delayDays" className={fieldLabelClass}>
                    Delay days
                  </label>
                  <input id="delayDays" name="delayDays" type="number" min="0" defaultValue="0" className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="subject" className={fieldLabelClass}>
                    Subject
                  </label>
                  <input id="subject" name="subject" placeholder="{{company}} growth list quality" className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="bodyTemplate" className={fieldLabelClass}>
                    Email body
                  </label>
                  <textarea id="bodyTemplate" name="bodyTemplate" placeholder="Hi {{first_name}}, ..." className={fieldTextareaClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="physicalAddress" className={fieldLabelClass}>
                    Physical address
                  </label>
                  <input id="physicalAddress" name="physicalAddress" defaultValue={defaultPhysicalAddress} className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="smsTemplate" className={fieldLabelClass}>
                    SMS template
                  </label>
                  <input id="smsTemplate" name="smsTemplate" placeholder="Quick Syncore note for {{company}}" className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="callScript" className={fieldLabelClass}>
                    Call script
                  </label>
                  <input id="callScript" name="callScript" placeholder="Reference source signal and confirm fit" className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="personalizationVariables" className={fieldLabelClass}>
                    Variables
                  </label>
                  <input id="personalizationVariables" name="personalizationVariables" placeholder="first_name, company, segment" className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="requiredFields" className={fieldLabelClass}>
                    Required fields
                  </label>
                  <input id="requiredFields" name="requiredFields" placeholder="email, phone, company" className={fieldClass} />
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="w-full">
                    Create step
                  </Button>
                </div>
              </form>
            </div>
          </Panel>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Campaign performance"
          subtitle="Revenue, meetings, and engagement counters from local outreach events."
          action={<StatusBadge label={`${formatNumber(snapshot.campaigns.length)} campaigns`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Meetings</TableHead>
                <TableHead>Revenue won</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{campaign.name}</span>
                      <span className="text-xs text-muted-foreground">{campaign.status}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatNumber(campaign.totalLeads)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatNumber(campaign.meetingsBooked)}</TableCell>
                  <TableCell className="text-foreground">{formatCurrency(campaign.revenueWon)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Sequence steps"
          subtitle="Channel steps with delay rules, templates, scripts, variables, and compliance notes."
          action={<StatusBadge label={`${steps.length} steps`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sequence</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Compliance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {steps.map((step) => (
                <TableRow key={step.id}>
                  <TableCell className="text-muted-foreground">
                    {sequences.find((sequence) => sequence.id === step.sequenceId)?.name ?? "Unknown sequence"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{step.stepNumber} after {step.delayDays}d</TableCell>
                  <TableCell>
                    <StatusBadge label={step.channel} tone="info" />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{step.subject ?? step.smsTemplate ?? step.callScript ?? step.manualTaskInstruction ?? "No copy"}</span>
                      <span className="text-xs text-muted-foreground">{step.bodyTemplate}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusBadge label={step.complianceStatus} tone={step.complianceStatus === "Compliant" ? "success" : "warning"} />
                      <span className="text-xs text-muted-foreground">{step.complianceNotes}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {steps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No sequence steps have been created yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
      </section>
    </>
  );
}

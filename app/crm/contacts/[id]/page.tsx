import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Calendar,
  Check,
  CircleDollarSign,
  Mail,
  NotebookPen,
  Phone,
  Pencil,
  Save,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import {
  completeTaskAction,
  createCallLogAction,
  createCustomFieldAction,
  createNoteAction,
  createOpportunityAction,
  createTaskAction,
  sendDirectEmailAction,
  sendDirectSmsAction,
  setCustomFieldValueAction,
  updateContactComplianceAction,
  updateContactDetailsAction,
  updateOpportunityStageAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { directSendOutboxEnabled, readOpenDirectSendClaimsForContact } from "@/lib/phase1/direct-send-outbox";
import { statusTone } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass, fieldLabelClass, fieldTextareaClass } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  callOutcomes,
  customFieldValuesForObject,
  opportunityStages,
  taskPriorities,
  userNameForId
} from "@/lib/phase1/crm";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { consentStatuses, lawfulBases } from "@/lib/phase1/compliance";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { contactDetailReadModelForWorkspace, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { readFastContactDetailModel } from "@/lib/phase1/crm-detail-read-model";
import { dedupeTimelineActivities } from "@/lib/phase1/crm-display";
import { displayContactName as formatContactDisplayName } from "@/lib/phase1/lead-data-quality";
import { directEmailBlockReason } from "@/lib/phase1/direct-email-send";
import { directSmsBlockReason, directSmsLiveBlockReason } from "@/lib/phase1/direct-sms-send";
import { resolveUserSenderIdentity } from "@/lib/phase1/sender-identities";
import { resolveUserTelephonyIdentity, telephonyIdentityBlockReason } from "@/lib/phase1/telephony-identities";
import { timelineActivityDisplayForViewer } from "@/lib/phase1/activity-timeline-redaction";
import { SoftphoneButton } from "@/components/softphone-button";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { runWaterfallEnrichmentAction } from "@/lib/phase1/waterfall-enrichment-service";
import { waterfallTemplatesForWorkspace } from "@/lib/phase1/waterfall-templates";
import type { ActivityType, CallLog, CustomField, Note } from "@/lib/phase1/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { StatCard, ToneIcon } from "@/components/ui/stat-card";
import { TileGrid, TileItem } from "@/components/tile-grid";
import { ActivityTimeline, type TimelineItem, type TimelineKind } from "@/components/crm/activity-timeline";
import { TaskList, type TaskItem } from "@/components/crm/task-list";
import { InlineField } from "@/components/crm/inline-field";
import { canCustomizeTiles, readUserTileLayout } from "@/lib/phase1/tile-layouts";

export const dynamic = "force-dynamic";

const activityIcons: Record<ActivityType, typeof NotebookPen> = {
  Call: Phone,
  Task: Calendar,
  Email: Mail,
  SMS: Mail,
  Note: NotebookPen,
  Meeting: Users,
  "Status change": Sparkles,
  Verification: BadgeCheck,
  Opportunity: CircleDollarSign
};

const activityKindMap: Partial<Record<ActivityType, TimelineKind>> = {
  Call: "call",
  Task: "task",
  Email: "email",
  SMS: "sms",
  Note: "note",
  Meeting: "meeting",
  "Status change": "status",
  Verification: "status",
  Opportunity: "status"
};

function activityKind(type: ActivityType): TimelineKind {
  return activityKindMap[type] ?? "note";
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionContext = await getWorkspaceSessionContext("manage_crm");
  const fastModel = await readFastContactDetailModel(sessionContext.session, sessionContext.workspaceId, id);
  let state = fastModel?.state;
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let readState = fastModel?.state;
  let readModel = fastModel?.readModel;
  const fastReadCheckedVisibility = Boolean(fastModel);

  if (fastModel && !fastModel.visible) {
    notFound();
  }

  if (!fastModel) {
    const context = await getWorkspaceContext("manage_crm");
    state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
    readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
    readModel = await contactDetailReadModelForWorkspace(readState, workspaceId, id);
  }

  if (!state || !readState || !readModel) {
    notFound();
  }

  const contact = readModel.contact;

  if (!contact) {
    notFound();
  }

  if (
    !fastReadCheckedVisibility &&
    restrictsToOwnedRecords(session) &&
    !ownedCrmRecordScope(readState, session).contactIds.has(contact.id)
  ) {
    notFound();
  }

  const company = readModel.company;
  const isSdr = session.role === "SDR";
  const canEditContactDetails = session.role === "Admin" || session.role === "Manager";
  const contactDisplayName = formatContactDisplayName(contact);
  const companyDisplayName = company?.name ?? "unknown account";
  const opportunities = readState.opportunities
    .filter(
      (opportunity) =>
        opportunity.workspaceId === workspaceId &&
        (opportunity.contactId === contact.id || opportunity.companyId === contact.companyId)
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const tasks = readState.tasks
    .filter((task) => task.workspaceId === workspaceId && task.contactId === contact.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const notes = readState.notes
    .filter((note) => note.workspaceId === workspaceId && note.contactId === contact.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const calls = readState.callLogs
    .filter((call) => call.workspaceId === workspaceId && call.contactId === contact.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activities = dedupeTimelineActivities(
    readState.activities
      .filter((activity) => activity.workspaceId === workspaceId && activity.contactId === contact.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  ).slice(0, 14);
  const contactFields = state.customFields.filter(
    (field) => field.workspaceId === workspaceId && field.objectType === "contact"
  );
  const fieldValueMap = customFieldValuesForObject(state, contact.id);
  const activeTasks = tasks.filter((task) => task.status !== "Completed");
  const timelineItems: TimelineItem[] = activities.flatMap((activity) => {
    const display = timelineActivityDisplayForViewer({
      activity,
      actorName: userNameForId(state, activity.actorUserId),
      viewerRole: session.role,
      viewerName: session.user.name
    });
    if (display.hidden) {
      return [];
    }

    return [
      {
        id: activity.id,
        kind: activityKind(activity.type),
        title: display.title,
        body: display.body,
        actor: display.actor,
        occurredAt: activity.createdAt
      }
    ];
  });
  const taskItems: TaskItem[] = activeTasks.slice(0, 8).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    ownerName: userNameForId(state, task.ownerUserId),
    dueLabel: task.dueAt ? `Due ${formatDate(task.dueAt)}` : undefined
  }));
  const recentInteractions = [...notes.slice(0, 4), ...calls.slice(0, 4)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);
  const totalOpportunityValue = opportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
  const canManageCompliance = session.permissions.includes("manage_compliance");
  const canSendDirectOutreach = session.permissions.includes("send_direct_outreach");
  const canManageWaterfalls = session.permissions.includes("manage_waterfalls");
  const directSenderIdentity = resolveUserSenderIdentity(session.user);
  const directTelephonyIdentity = resolveUserTelephonyIdentity(session.user);
  const directEmailRestriction = directEmailBlockReason(contact);
  const directSmsRestriction = directSmsBlockReason(contact);
  const directSmsLiveRestriction = directTelephonyIdentity ? directSmsLiveBlockReason() : undefined;
  const canSendEmail = Boolean(!directEmailRestriction && directSenderIdentity);
  const canSendSms = Boolean(!directSmsRestriction && directTelephonyIdentity && !directSmsLiveRestriction);
  const directEmailStatus = directSenderIdentity
    ? directEmailRestriction ?? "Ready to send from your approved sender."
    : "No approved sending email configured for this user.";
  const directSmsStatus = directTelephonyIdentity
    ? directSmsRestriction ?? directSmsLiveRestriction ?? `Ready from ${directTelephonyIdentity.phoneNumber}.`
    : telephonyIdentityBlockReason(session.user);
  const directEmailRequestId = `direct-${contact.id}-${randomUUID()}`;
  const directSmsRequestId = `direct-sms-${contact.id}-${randomUUID()}`;
  const activeWaterfallTemplates = waterfallTemplatesForWorkspace(state, workspaceId).filter(
    (template) => template.status === "Active"
  );
  const contactFieldSources = state.fieldSources
    .filter((source) => source.targetType === "contact" && source.targetId === contact.id)
    .sort((a, b) => Date.parse(b.enrichmentDate) - Date.parse(a.enrichmentDate));

  const metrics = [
    {
      label: "Grade",
      value: contact.grade,
      note: isSdr ? contact.verification || "Current lead quality" : contact.verification,
      icon: BadgeCheck,
      tone: contact.grade === "A" || contact.grade === "B" ? "success" as const : "warning" as const
    },
    {
      label: "Score",
      value: formatNumber(contact.score),
      note: `${contact.priority} - ${contact.segment}`,
      icon: BadgeCheck,
      tone: contact.priority === "P1" ? "success" as const : "info" as const
    },
    {
      label: "Open tasks",
      value: formatNumber(activeTasks.length),
      note: `Owned by ${contact.owner}`,
      icon: Calendar,
      tone: activeTasks.length ? "warning" as const : "success" as const
    },
    {
      label: "Opportunities",
      value: formatNumber(opportunities.length),
      note: formatCurrency(totalOpportunityValue),
      icon: CircleDollarSign,
      tone: opportunities.length ? "success" as const : "info" as const
    }
  ];

  const lanes = [
    {
      label: "Email channel",
      value: contact.email ? 1 : 0,
      note: contact.email || "No email",
      icon: Mail,
      tone: contact.email ? "success" as const : "warning" as const
    },
    {
      label: "Phone channel",
      value: contact.phone ? 1 : 0,
      note: contact.phone || "No phone",
      icon: Phone,
      tone: contact.phone ? "info" as const : "warning" as const
    },
    {
      label: "Open work",
      value: activeTasks.length,
      note: `${formatNumber(timelineItems.length)} timeline events`,
      icon: Check,
      tone: activeTasks.length ? "warning" as const : "success" as const
    },
    {
      label: "Guardrails",
      value: contact.doNotContact ? 1 : 0,
      note: contact.doNotContact ? "Do not contact" : contact.consentStatus,
      icon: ShieldCheck,
      tone: contact.doNotContact ? "warning" as const : "success" as const
    }
  ];
  const nextAction = recommendedContactAction({
    activeTasks,
    canSendEmail,
    phone: contact.phone,
    isSuppressed: contact.isSuppressed,
    doNotContact: contact.doNotContact
  });
  const contactNotes = contact.notes?.trim();
  const snapshotRows: Array<{ label: string; value: string; multiline?: boolean }> = isSdr
    ? [
        { label: "Account", value: company?.name ?? "Unknown" },
        { label: "Email", value: contact.email || "No email" },
        { label: "Phone", value: contact.phone || "No phone" },
        { label: "Owner", value: contact.owner },
        { label: "Fit reason", value: contact.fitReason ?? "No fit reason yet" },
        ...(contactNotes ? [{ label: "Notes", value: contactNotes, multiline: true }] : []),
        { label: "Source", value: contact.sourceLineage[0] ?? "Unknown" },
        { label: "Status", value: contact.status },
        { label: "Do not contact", value: contact.doNotContact ? "Yes" : "No" }
      ]
    : [
        { label: "Account", value: company?.name ?? "Unknown" },
        { label: "Email", value: contact.email },
        { label: "Phone", value: contact.phone || "No phone" },
        { label: "Owner", value: contact.owner },
        { label: "Seniority", value: contact.seniority ?? "Unknown" },
        { label: "Department", value: contact.department ?? "Unknown" },
        { label: "Enrichment", value: `${contact.enrichmentCoverage ?? 0}% coverage` },
        { label: "Fit reason", value: contact.fitReason ?? "No fit reason yet" },
        ...(contactNotes ? [{ label: "Notes", value: contactNotes, multiline: true }] : []),
        { label: "Lawful basis", value: contact.lawfulBasis },
        { label: "Consent", value: contact.consentStatus },
        { label: "Do not contact", value: contact.doNotContact ? "Yes" : "No" }
      ];

  const canCustomize = canCustomizeTiles(session);
  const savedLayout = await readUserTileLayout(session.user.id, "crm-contact-detail");
  const openSendClaims = directSendOutboxEnabled()
    ? await readOpenDirectSendClaimsForContact(workspaceId, contact.id)
    : [];

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title={contactDisplayName}
        copy={
          isSdr
            ? `${companyDisplayName}. Work the next touch, send email, log outcomes, and keep the follow-up moving.`
            : `${contact.title} at ${companyDisplayName}. Work the person, not the backend: channels, compliance, next task, timeline, and related pipeline.`
        }
        actions={
          <>
            <SoftphoneButton
              contactId={contact.id}
              contactName={contactDisplayName}
              phone={contact.phone}
              callerLabel={
                directTelephonyIdentity
                  ? `${directTelephonyIdentity.displayName} · ${directTelephonyIdentity.phoneNumber}`
                  : undefined
              }
              blockReason={directTelephonyIdentity ? undefined : telephonyIdentityBlockReason(session.user)}
              variant="outline"
              size="default"
            />
            <Button asChild variant="outline">
              <Link href="/crm/contacts">
                <ArrowRight aria-hidden="true" />
                Contacts
              </Link>
            </Button>
            {company ? (
              <Button asChild>
                <Link href={`/crm/accounts/${company.id}`}>
                  <Building2 aria-hidden="true" />
                  Account
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {openSendClaims.length > 0 ? (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Unconfirmed send</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A previous{" "}
                {openSendClaims.length === 1 ? "send" : `${openSendClaims.length} sends`} to this contact did
                not confirm (status: Sending) — it may or may not have reached the prospect. Verify before
                resending to avoid a duplicate.
              </p>
            </div>
            <ToneIcon icon={ShieldCheck} tone="warning" />
          </div>
        </Card>
      ) : null}

      <TileGrid pageKey="crm-contact-detail" canCustomize={canCustomize} saved={savedLayout}>
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

        {canEditContactDetails ? (
        <TileItem id="edit-contact-details" x={0} y={4} w={12} h={5} minW={6} minH={3}>
          <Panel
            title="Edit contact details"
            subtitle="Click a value to edit it inline — name, email, and phone are used across CRM and Lead Engine views."
            action={<ToneIcon icon={Pencil} tone="info" />}
            fill
          >
            <div className="divide-y">
              {(
                [
                  { field: "name" as const, label: "Name", value: contact.name, type: "text" as const },
                  { field: "email" as const, label: "Email", value: contact.email, type: "email" as const },
                  { field: "phone" as const, label: "Phone", value: contact.phone, type: "tel" as const }
                ]
              ).map((row) => (
                <div className="flex items-center justify-between gap-4 py-2.5" key={row.field}>
                  <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                  <InlineField
                    contactId={contact.id}
                    field={row.field}
                    value={row.value}
                    label={row.label}
                    type={row.type}
                    canEdit={canEditContactDetails}
                  />
                </div>
              ))}
            </div>
          </Panel>
        </TileItem>
      ) : null}

      {isSdr ? (
        <TileItem id="sdr-next-action" x={0} y={9} w={6} h={7} minW={4} minH={4}>
          <Panel
            title="Next best action"
            subtitle="A compact SDR view of what should happen next."
            action={<ToneIcon icon={Sparkles} tone="info" />}
            fill
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 border-b pb-4">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">{nextAction.label}</span>
                  <span className="text-xs text-muted-foreground">{nextAction.note}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={contact.priority} tone={contact.priority === "P1" ? "success" : "info"} />
                  <StatusBadge label={contact.grade} tone={contact.grade === "A" || contact.grade === "B" ? "success" : "warning"} />
                  <StatusBadge label={contact.status} tone={statusTone(contact.status)} />
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 border-b pb-4">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">Email readiness</span>
                  <span className="text-xs text-muted-foreground">{directEmailStatus}</span>
                </div>
                <StatusBadge label={canSendEmail ? "Sendable" : "Blocked"} tone={canSendEmail ? "success" : "warning"} />
              </div>
              <div className="flex items-start justify-between gap-3 border-b pb-4">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">RingCentral line</span>
                  <span className="text-xs text-muted-foreground">{directSmsStatus}</span>
                </div>
                <StatusBadge label={canSendSms ? "SMS ready" : "Not ready"} tone={canSendSms ? "success" : "warning"} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm">
                  <a href="#send-direct-email">
                    <Mail size={16} aria-hidden="true" />
                    Email
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="#add-contact-work">
                    <Calendar size={16} aria-hidden="true" />
                    Task
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="#log-contact-activity">
                    <NotebookPen size={16} aria-hidden="true" />
                    Log note
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="#send-direct-sms">
                    <Phone size={16} aria-hidden="true" />
                    SMS
                  </a>
                </Button>
              </div>
            </div>
          </Panel>
        </TileItem>
        ) : null}

        {isSdr && canSendDirectOutreach ? (
        <TileItem id="sdr-direct-email" x={6} y={9} w={6} h={7} minW={3} minH={4}>
            <Panel
              title="Send 1:1 email"
              subtitle="Use your approved SES sender and log the touch automatically."
              action={<ToneIcon icon={Mail} tone="info" />}
              fill
            >
              <form action={sendDirectEmailAction} id="send-direct-email" className="flex flex-col gap-4">
                <input name="contactId" type="hidden" value={contact.id} />
                <input name="requestId" type="hidden" value={directEmailRequestId} />
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  From: {directSenderIdentity?.mailbox ?? "No approved sending email configured for this user."}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={fieldLabelClass} htmlFor="direct-email-subject">Subject</label>
                  <input
                    className={fieldClass}
                    id="direct-email-subject"
                    name="subject"
                    defaultValue={`Quick question for ${company?.name ?? contactDisplayName}`}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={fieldLabelClass} htmlFor="direct-email-body">Body</label>
                  <textarea
                    className={fieldTextareaClass}
                    id="direct-email-body"
                    name="bodySnapshot"
                    placeholder="Hi {{first_name}}, quick question about {{company}}."
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={fieldLabelClass} htmlFor="direct-email-attachments">Attachments</label>
                  <input
                    id="direct-email-attachments"
                    name="attachments"
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.md,.zip"
                    className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
                  />
                  <p className="text-xs text-muted-foreground">Up to 5 files, 10 MB total. PDF, images, Office docs, txt/csv, zip.</p>
                </div>
                <div>
                  <SubmitButton className={buttonVariants()} pendingLabel="Sending…" disabled={!canSendEmail}>
                    <Mail size={16} aria-hidden="true" />
                    Send email
                  </SubmitButton>
                </div>
              </form>
            </Panel>
        </TileItem>
        ) : null}

      <TileItem id="contact-snapshot" x={0} y={16} w={7} h={7} minW={4} minH={3}>
        <Panel
          title={isSdr ? "Contact context" : "Contact snapshot"}
          subtitle={
            isSdr
              ? "The useful context for a good first touch and follow-up."
              : "Verification, channels, enrichment, source lineage, and compliance state."
          }
          action={<StatusBadge label={contact.status} tone={statusTone(contact.status)} />}
          fill
        >
          <div className="flex flex-col gap-3">
            {snapshotRows.map((row) => (
              <div
                className={row.multiline ? "border-b pb-3 last:border-0 last:pb-0" : "flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"}
                key={row.label}
              >
                <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                {row.multiline ? (
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground">{row.value}</p>
                ) : (
                  <span className="text-right text-sm text-foreground">{row.value}</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </TileItem>

      <TileItem id="current-work" x={7} y={16} w={5} h={7} minW={3} minH={3}>
        <Panel
          title="Current work"
          subtitle="Contact-specific tasks and follow-ups."
          action={<StatusBadge label={`${activeTasks.length} open`} tone={activeTasks.length ? "warning" : "success"} />}
          fill
        >
          <TaskList tasks={taskItems} />
        </Panel>
      </TileItem>

      {!isSdr ? (
      <TileItem id="related-opportunities" x={0} y={23} w={7} h={7} minW={4} minH={3}>
        <Panel
          title="Related opportunities"
          subtitle="Deals linked to this contact or account."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/crm/opportunities">Pipeline</Link>
            </Button>
          }
          flush
          fill
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Move</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.map((opportunity) => (
                <TableRow key={opportunity.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{opportunity.name}</span>
                      <span className="text-xs text-muted-foreground">{userNameForId(state, opportunity.ownerUserId)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatCurrency(opportunity.amount)}</TableCell>
                  <TableCell>
                    <form action={updateOpportunityStageAction} className="flex items-center gap-2">
                      <input name="id" type="hidden" value={opportunity.id} />
                      <select className={fieldClass} name="stage" defaultValue={opportunity.stage} aria-label="Stage">
                        {opportunityStages.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage}
                          </option>
                        ))}
                      </select>
                      <button className={buttonVariants({ variant: "outline", size: "icon-sm" })} type="submit" aria-label="Save stage">
                        <Save size={16} aria-hidden="true" />
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {opportunities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">No opportunities are linked yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
      </TileItem>
      ) : null}

      <TileItem id="contact-timeline" x={7} y={23} w={5} h={9} minW={3} minH={4}>
        <Panel
          title="Timeline"
          subtitle="Contact-level notes, calls, tasks, and opportunity updates."
          action={<StatusBadge label={`${timelineItems.length} events`} tone="info" />}
          fill
        >
          <ActivityTimeline items={timelineItems} />
        </Panel>
      </TileItem>

      <TileItem id="add-contact-work" x={0} y={32} w={7} h={11} minW={4} minH={5}>
        <Panel
          title="Add contact work"
          subtitle="Create the next task or opportunity for this contact."
          action={<ToneIcon icon={Calendar} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-6">
          <form action={createTaskAction} id="add-contact-work" className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="task-title">Task</label>
              <input className={fieldClass} id="task-title" name="title" placeholder="Call after email reply" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="task-priority">Priority</label>
              <select className={fieldClass} id="task-priority" name="priority" defaultValue="Normal">
                {taskPriorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="task-due">Due date</label>
              <input className={fieldClass} id="task-due" name="dueAt" type="date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="task-owner">Owner</label>
              <select className={fieldClass} id="task-owner" name="ownerUserId" defaultValue={session.user.id}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} aria-hidden="true">&nbsp;</label>
              <SubmitButton className={buttonVariants()} pendingLabel="Adding…">
                Add task
              </SubmitButton>
            </div>
          </form>
          {!isSdr ? (
          <form action={createOpportunityAction} className="grid items-end gap-4 border-t pt-6 sm:grid-cols-2 lg:grid-cols-3">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="opp-name">Opportunity</label>
              <input className={fieldClass} id="opp-name" name="name" defaultValue={`${company?.name ?? contactDisplayName} opportunity`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="opp-stage">Stage</label>
              <select className={fieldClass} id="opp-stage" name="stage" defaultValue="Prospecting">
                {opportunityStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="opp-amount">Amount</label>
              <input className={fieldClass} id="opp-amount" name="amount" type="number" min="0" step="500" defaultValue="25000" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="opp-close">Expected close</label>
              <input className={fieldClass} id="opp-close" name="expectedCloseDate" type="date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} aria-hidden="true">&nbsp;</label>
              <SubmitButton className={buttonVariants({ variant: "outline" })} pendingLabel="Adding…">
                Add opportunity
              </SubmitButton>
            </div>
          </form>
          ) : null}
          </div>
        </Panel>
      </TileItem>

      <TileItem id="log-contact-activity" x={7} y={32} w={5} h={11} minW={3} minH={5}>
        <Panel
          title="Log activity"
          subtitle="Add manual notes and call outcomes."
          action={<ToneIcon icon={Phone} tone="info" />}
          fill
        >
          <div id="log-contact-activity" className="flex flex-col gap-6">
          <form action={createNoteAction} className="flex flex-col gap-4">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="note-body">Note</label>
              <textarea className={fieldTextareaClass} id="note-body" name="body" placeholder="Add contact context" />
            </div>
            <div>
              <SubmitButton className={buttonVariants()} pendingLabel="Adding…">
                Add note
              </SubmitButton>
            </div>
          </form>
          <form action={createCallLogAction} className="flex flex-col gap-4 border-t pt-6">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="call-phone">Phone</label>
              <input className={fieldClass} id="call-phone" name="phone" defaultValue={contact.phone} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="call-outcome">Outcome</label>
              <select className={fieldClass} id="call-outcome" name="outcome" defaultValue="Connected">
                {callOutcomes.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="call-duration">Minutes</label>
              <input className={fieldClass} id="call-duration" name="durationMinutes" type="number" min="0" step="1" defaultValue="5" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="call-notes">Call notes</label>
              <textarea className={fieldTextareaClass} id="call-notes" name="notes" placeholder="Summarize the conversation" />
            </div>
            <div>
              <SubmitButton className={buttonVariants({ variant: "outline" })} pendingLabel="Logging…">
                Log call
              </SubmitButton>
            </div>
          </form>
          <div className="flex flex-col gap-4 border-t pt-6">
            {recentInteractions.map((item) => (
              <div className="flex flex-col gap-1 border-b pb-4 last:border-0 last:pb-0" key={item.id}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm font-medium text-foreground">{isCall(item) ? item.outcome : "Note"}</strong>
                  <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{isCall(item) ? item.notes : item.body}</p>
              </div>
            ))}
            {recentInteractions.length === 0 ? <p className="text-xs text-muted-foreground">No notes or calls have been logged yet.</p> : null}
          </div>
          </div>
        </Panel>
      </TileItem>

      {canSendDirectOutreach && !isSdr ? (
        <TileItem id="direct-email" x={0} y={43} w={6} h={8} minW={3} minH={4}>
          <Panel
            title="Send 1:1 email"
            subtitle="Send an individual SES email to this assigned contact and log it on the timeline."
            action={<ToneIcon icon={Mail} tone="info" />}
            fill
          >
            <form action={sendDirectEmailAction} id="send-direct-email" className="flex flex-col gap-4">
              <input name="contactId" type="hidden" value={contact.id} />
              <input name="requestId" type="hidden" value={directEmailRequestId} />
              <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                From: {directSenderIdentity?.mailbox ?? "No approved sending email configured for this user."}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="direct-email-subject">Subject</label>
                <input
                  className={fieldClass}
                  id="direct-email-subject"
                  name="subject"
                  defaultValue={`Quick question for ${company?.name ?? contactDisplayName}`}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="direct-email-body">Body</label>
                <textarea
                  className={fieldTextareaClass}
                  id="direct-email-body"
                  name="bodySnapshot"
                  placeholder="Hi {{first_name}}, quick question about {{company}}."
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="direct-email-attachments">Attachments</label>
                <input
                  id="direct-email-attachments"
                  name="attachments"
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.md,.zip"
                  className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
                />
                <p className="text-xs text-muted-foreground">Up to 5 files, 10 MB total. PDF, images, Office docs, txt/csv, zip.</p>
              </div>
              <div>
                <SubmitButton className={buttonVariants()} pendingLabel="Sending…" disabled={!canSendEmail}>
                  <Mail size={16} aria-hidden="true" />
                  Send email
                </SubmitButton>
              </div>
            </form>
          </Panel>
        </TileItem>
        ) : null}

        {canSendDirectOutreach ? (
        <TileItem id="direct-sms" x={6} y={43} w={6} h={8} minW={3} minH={4}>
          <Panel
            title="Send 1:1 SMS"
            subtitle="Send an individual SMS to this assigned contact and log it on the timeline."
            action={<ToneIcon icon={Phone} tone="info" />}
            fill
          >
            <form action={sendDirectSmsAction} id="send-direct-sms" className="flex flex-col gap-4">
              <input name="contactId" type="hidden" value={contact.id} />
              <input name="requestId" type="hidden" value={directSmsRequestId} />
              <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                From: {directTelephonyIdentity?.label ?? "No RingCentral phone number configured for this user."}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="direct-sms-body">Message</label>
                <textarea className={fieldTextareaClass} id="direct-sms-body" name="body" placeholder="Keep it short" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass}>To</label>
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{contact.phone || "No phone number on contact."}</div>
              </div>
              <div>
                <SubmitButton className={buttonVariants()} pendingLabel="Sending…" disabled={!canSendSms}>
                  <Phone size={16} aria-hidden="true" />
                  Send SMS
                </SubmitButton>
              </div>
            </form>
          </Panel>
        </TileItem>
        ) : null}

      {!isSdr ? (
      <TileItem id="contact-compliance" x={0} y={51} w={4} h={8} minW={3} minH={4}>
        <Panel
          title="Contact guardrails"
          subtitle="CRM-visible lawful basis, consent, source, and do-not-contact status. Editing is reserved for developer controls."
          action={<ToneIcon icon={ShieldCheck} tone="info" />}
          fill
        >
          {canManageCompliance ? (
            <form action={updateContactComplianceAction} id="contact-compliance" className="flex flex-col gap-4">
              <input name="contactId" type="hidden" value={contact.id} />
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="lawfulBasis">Lawful basis</label>
                <select className={fieldClass} id="lawfulBasis" name="lawfulBasis" defaultValue={contact.lawfulBasis}>
                  {lawfulBases.map((basis) => (
                    <option key={basis} value={basis}>
                      {basis}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="consentStatus">Consent status</label>
                <select className={fieldClass} id="consentStatus" name="consentStatus" defaultValue={contact.consentStatus}>
                  {consentStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="consentSource">Consent source</label>
                <input className={fieldClass} id="consentSource" name="consentSource" defaultValue={contact.consentSource} />
              </div>
              <div className="flex flex-col gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input name="doNotContact" type="checkbox" defaultChecked={contact.doNotContact} />
                  Do not contact
                </label>
                <button className={buttonVariants({ variant: "outline" })} type="submit">
                  <ShieldCheck size={16} aria-hidden="true" />
                  Save compliance
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              {[
                ["Lawful basis", contact.lawfulBasis],
                ["Consent status", contact.consentStatus],
                ["Consent source", contact.consentSource || "Not captured"],
                ["Do not contact", contact.doNotContact ? "Yes" : "No"]
              ].map(([label, value]) => (
                <div className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0" key={label}>
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <StatusBadge label={String(value)} tone={statusTone(String(value))} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </TileItem>
      ) : null}

      {!isSdr ? (
      <TileItem id="contact-field-provenance" x={4} y={51} w={4} h={9} minW={3} minH={4}>
        <Panel
          title="Field provenance"
          subtitle="Where each enriched field came from — provider, confidence, validation, and cost."
          action={<StatusBadge label={`${contactFieldSources.length} sources`} tone="info" />}
          fill
        >
          <div id="contact-field-provenance" className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            {contactFieldSources.length ? (
              contactFieldSources.map((source) => (
                <div className="flex items-start justify-between gap-3 border-b pb-4 last:border-0 last:pb-0" key={source.id}>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <strong className="text-sm font-medium text-foreground">
                      {source.field}: {source.value || "—"}
                    </strong>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={`via ${source.providerId}`} />
                      <StatusBadge label={source.validationStatus} tone={statusTone(source.validationStatus)} />
                      {source.phoneType ? <StatusBadge label={source.phoneType} /> : null}
                      <StatusBadge label={`conf ${source.confidence}`} />
                      {source.cacheHit ? <StatusBadge label="cache" /> : null}
                      <StatusBadge label={`$${(source.costCents / 100).toFixed(2)}`} />
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(source.enrichmentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                No enrichment provenance yet. Run a waterfall (below) — each accepted field records its source, confidence, validation, and cost here.
              </p>
            )}
          </div>
          {canManageWaterfalls && activeWaterfallTemplates.length ? (
            <form action={runWaterfallEnrichmentAction} className="flex flex-col gap-4 border-t pt-6">
              <input name="contactIds" type="hidden" value={contact.id} />
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="waterfall-template">Run enrichment waterfall</label>
                <select className={fieldClass} id="waterfall-template" name="templateId" defaultValue={activeWaterfallTemplates[0].id}>
                  {activeWaterfallTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  Runs the selected template on this contact. With providers in mock mode no calls are made; live providers populate provenance above.
                </span>
              </div>
              <div>
                <button className={buttonVariants()} type="submit">
                  <Sparkles size={16} aria-hidden="true" />
                  Run waterfall
                </button>
              </div>
            </form>
          ) : null}
          </div>
        </Panel>
      </TileItem>
      ) : null}

      {!isSdr ? (
      <TileItem id="contact-custom-fields" x={8} y={51} w={4} h={9} minW={3} minH={4}>
        <Panel
          title="Custom fields"
          subtitle="Fields specific to contact workflows and preferences."
          action={<StatusBadge label={`${contactFields.length} fields`} tone="info" />}
          fill
        >
          <div id="contact-custom-fields" className="flex flex-col gap-4">
            {contactFields.map((field) => (
              <form action={setCustomFieldValueAction} className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0" key={field.id}>
                <input name="customFieldId" type="hidden" value={field.id} />
                <input name="objectId" type="hidden" value={contact.id} />
                <div className="flex flex-col gap-1.5">
                  <strong className="text-xs font-medium text-muted-foreground">{field.name}</strong>
                  <CustomFieldInput field={field} value={fieldValueMap.get(field.id)?.value ?? ""} />
                </div>
                <button className={buttonVariants({ variant: "outline", size: "sm" })} type="submit">
                  <Save size={16} aria-hidden="true" />
                  Save field
                </button>
              </form>
            ))}
            <form action={createCustomFieldAction} className="flex flex-col gap-4 border-t pt-6">
              <input name="objectType" type="hidden" value="contact" />
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="contact-field-name">Field name</label>
                <input className={fieldClass} id="contact-field-name" name="name" placeholder="Buying role" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="contact-field-type">Type</label>
                <select className={fieldClass} id="contact-field-type" name="fieldType" defaultValue="text">
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="contact-field-options">Options</label>
                <input className={fieldClass} id="contact-field-options" name="options" placeholder="Economic, Technical, User" />
              </div>
              <div>
                <button className={buttonVariants()} type="submit">
                  Create field
                </button>
              </div>
            </form>
          </div>
        </Panel>
      </TileItem>
      ) : null}
      </TileGrid>
    </>
  );
}

function recommendedContactAction(input: {
  activeTasks: Array<{ title: string; dueAt?: string }>;
  canSendEmail: boolean;
  phone: string;
  isSuppressed: boolean;
  doNotContact: boolean;
}) {
  const nextTask = input.activeTasks[0];

  if (input.isSuppressed || input.doNotContact) {
    return {
      label: "Do not contact",
      note: "This record has a compliance stop. Review the account context instead."
    };
  }

  if (nextTask) {
    return {
      label: nextTask.title,
      note: nextTask.dueAt ? `Due ${formatDate(nextTask.dueAt)}` : "Open task on this contact."
    };
  }

  if (input.canSendEmail) {
    return {
      label: "Send a focused 1:1 email",
      note: "Start with a short, specific first touch and then set the next follow-up."
    };
  }

  if (input.phone) {
    return {
      label: "Call and log outcome",
      note: "No email send is available, but the contact has a phone number."
    };
  }

  return {
    label: "Review contact quality",
    note: "This contact needs more usable channel data before outreach."
  };
}

function CustomFieldInput({ field, value }: { field: CustomField; value: string }) {
  if (field.fieldType === "select") {
    return (
      <select className={fieldClass} name="value" defaultValue={value} aria-label={field.name}>
        <option value="">Unset</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return <input className={fieldClass} name="value" type={field.fieldType} defaultValue={value} aria-label={field.name} />;
}


function isCall(item: Note | CallLog): item is CallLog {
  return "outcome" in item;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

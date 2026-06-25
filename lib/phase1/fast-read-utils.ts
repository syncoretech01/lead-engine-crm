import type {
  ActivityType,
  AppState,
  AssignmentMethod,
  CallDirection,
  CallDisposition,
  CampaignStatus,
  CampaignType,
  ConsentStatus,
  EmailEventType,
  LawfulBasis,
  LeadGrade,
  LeadStatus,
  OpportunityStage,
  OutreachChannel,
  OutreachProviderKind,
  OutreachProviderStatus,
  Permission,
  Priority,
  RecordingConsentStatus,
  ReminderStatus,
  SdrLeadStatus,
  SequenceComplianceStatus,
  SequenceStatus,
  Session,
  SlaStatus,
  SmsEventStatus,
  TaskPriority,
  TaskStatus,
  TrackedCallStatus,
  User,
  WebhookEvent,
  WorkspaceMember,
  WorkspaceRole
} from "@/lib/phase1/types";

type FastStateInput = Partial<Omit<AppState, "version">>;

export function createFastState(session: Session, input: FastStateInput = {}): AppState {
  const users = uniqueUsers([session.user, ...(input.users ?? [])]);

  return {
    version: 16,
    workspaces: input.workspaces ?? [session.workspace],
    users,
    workspaceMembers: input.workspaceMembers ?? [],
    authAccounts: input.authAccounts ?? [],
    authSessions: input.authSessions ?? [],
    userInvites: input.userInvites ?? [],
    passwordResetTokens: input.passwordResetTokens ?? [],
    providerConnections: input.providerConnections ?? [],
    providerCredentialAudits: input.providerCredentialAudits ?? [],
    providerEncryptedSecrets: input.providerEncryptedSecrets ?? [],
    providerJobs: input.providerJobs ?? [],
    providerJobRuns: input.providerJobRuns ?? [],
    providerUsageLedger: input.providerUsageLedger ?? [],
    searchProfiles: input.searchProfiles ?? [],
    leadJobs: input.leadJobs ?? [],
    asyncJobRuns: input.asyncJobRuns ?? [],
    jobLogs: input.jobLogs ?? [],
    jobIdempotencyRecords: input.jobIdempotencyRecords ?? [],
    rawLeads: input.rawLeads ?? [],
    normalizedRecords: input.normalizedRecords ?? [],
    companies: input.companies ?? [],
    contacts: input.contacts ?? [],
    verificationResults: input.verificationResults ?? [],
    dedupeMatches: input.dedupeMatches ?? [],
    exportRules: input.exportRules ?? [],
    providerCache: input.providerCache ?? [],
    enrichmentResults: input.enrichmentResults ?? [],
    segmentRules: input.segmentRules ?? [],
    recordSegments: input.recordSegments ?? [],
    leadScores: input.leadScores ?? [],
    opportunities: input.opportunities ?? [],
    activities: input.activities ?? [],
    tasks: input.tasks ?? [],
    notes: input.notes ?? [],
    callLogs: input.callLogs ?? [],
    customFields: input.customFields ?? [],
    customFieldValues: input.customFieldValues ?? [],
    sdrTeams: input.sdrTeams ?? [],
    sdrAssignments: input.sdrAssignments ?? [],
    followUpReminders: input.followUpReminders ?? [],
    reassignmentRules: input.reassignmentRules ?? [],
    outreachProviders: input.outreachProviders ?? [],
    outreachCampaigns: input.outreachCampaigns ?? [],
    campaignSequences: input.campaignSequences ?? [],
    sequenceSteps: input.sequenceSteps ?? [],
    emailEvents: input.emailEvents ?? [],
    smsEvents: input.smsEvents ?? [],
    webhookEvents: input.webhookEvents ?? [],
    trackedCalls: input.trackedCalls ?? [],
    reportSnapshots: input.reportSnapshots ?? [],
    retentionPolicies: input.retentionPolicies ?? [],
    retentionRuns: input.retentionRuns ?? [],
    complianceChecklistItems: input.complianceChecklistItems ?? [],
    dataSubjectRequests: input.dataSubjectRequests ?? [],
    deliverabilityAlerts: input.deliverabilityAlerts ?? [],
    aiPersonalizations: input.aiPersonalizations ?? [],
    aiReplyClassifications: input.aiReplyClassifications ?? [],
    aiCallSummaries: input.aiCallSummaries ?? [],
    aiLeadScorePredictions: input.aiLeadScorePredictions ?? [],
    aiIcpRecommendations: input.aiIcpRecommendations ?? [],
    aiDeliverabilityRecommendations: input.aiDeliverabilityRecommendations ?? [],
    aiRevenueInsights: input.aiRevenueInsights ?? [],
    aiAutomationRuns: input.aiAutomationRuns ?? [],
    suppressionRecords: input.suppressionRecords ?? [],
    exports: input.exports ?? [],
    auditLogs: input.auditLogs ?? [],
    waterfallTemplates: input.waterfallTemplates ?? [],
    fieldSources: input.fieldSources ?? [],
    providerMetricsDaily: input.providerMetricsDaily ?? []
  };
}

export function userFromPrisma(row: { id: string; email: string; name: string; createdAt: Date }) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString()
  } satisfies User;
}

export function workspaceMemberFromPrisma(row: { id: string; workspaceId: string; userId: string; role: string }) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: workspaceRoleValue(row.role)
  } satisfies WorkspaceMember;
}

export function uniqueUsers(users: User[]) {
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

export function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

export function optionalIso(value: Date | string | null | undefined) {
  return value ? iso(value) : undefined;
}

export function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function recordFromJson(value: unknown): Record<string, string | number | boolean | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output: Record<string, string | number | boolean | undefined> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === undefined) {
      output[key] = item;
    }
  }
  return output;
}

export function permissionSet(session: Session) {
  return new Set<Permission>(session.permissions);
}

export function leadGradeValue(value: string | null | undefined): LeadGrade {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "S" ? value : "D";
}

export function priorityValue(value: string | null | undefined): Priority {
  return value === "P1" || value === "P2" || value === "P3" || value === "P4" || value === "S" ? value : "P4";
}

export function leadStatusValue(value: string | null | undefined): LeadStatus {
  const statuses: LeadStatus[] = [
    "New",
    "Assigned",
    "Working",
    "Contacted",
    "Opened",
    "Replied",
    "Interested",
    "Meeting Booked",
    "Qualified",
    "Proposal Sent",
    "Won",
    "Lost",
    "Nurture",
    "Disqualified",
    "Invalid",
    "Unsubscribed",
    "Ready for SDR",
    "Needs enrichment",
    "Suppressed",
    "In review",
    "Exported"
  ];
  return value && statuses.includes(value as LeadStatus) ? value as LeadStatus : "New";
}

export function lawfulBasisValue(value: string | null | undefined): LawfulBasis {
  if (
    value === "Legitimate interest" ||
    value === "Consent" ||
    value === "Contract" ||
    value === "Legal obligation" ||
    value === "Do not contact"
  ) {
    return value;
  }
  return "Legitimate interest";
}

export function consentStatusValue(value: string | null | undefined): ConsentStatus {
  return value === "Not required" || value === "Granted" || value === "Revoked" || value === "Unknown" ? value : "Unknown";
}

export function opportunityStageValue(value: string | null | undefined): OpportunityStage {
  const map: Record<string, OpportunityStage> = {
    PROSPECTING: "Prospecting",
    QUALIFIED: "Qualified",
    DISCOVERY: "Discovery",
    PROPOSAL: "Proposal",
    CLOSED_WON: "Closed won",
    CLOSED_LOST: "Closed lost",
    Prospecting: "Prospecting",
    Qualified: "Qualified",
    Discovery: "Discovery",
    Proposal: "Proposal",
    "Closed won": "Closed won",
    "Closed lost": "Closed lost"
  };
  return value ? map[value] ?? "Prospecting" : "Prospecting";
}

export function taskStatusValue(value: string | null | undefined): TaskStatus {
  return value === "Completed" || value === "Overdue" || value === "Open" ? value : "Open";
}

export function taskPriorityValue(value: string | null | undefined): TaskPriority {
  if (!value) return "Normal";
  const normalized = value.toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "high") return "High";
  return "Normal";
}

export function activityTypeValue(value: string | null | undefined): ActivityType {
  const map: Record<string, ActivityType> = {
    EMAIL: "Email",
    CALL: "Call",
    NOTE: "Note",
    TASK: "Task",
    MEETING: "Meeting",
    STATUS_CHANGE: "Status change",
    VERIFICATION: "Verification",
    OPPORTUNITY: "Opportunity",
    Email: "Email",
    Call: "Call",
    SMS: "SMS",
    Note: "Note",
    Task: "Task",
    Meeting: "Meeting",
    "Status change": "Status change",
    Verification: "Verification",
    Opportunity: "Opportunity"
  };
  return value ? map[value] ?? "Note" : "Note";
}

export function customFieldObjectTypeValue(value: string): "company" | "contact" | "opportunity" {
  return value === "company" || value === "contact" || value === "opportunity" ? value : "company";
}

export function customFieldTypeValue(value: string): "text" | "number" | "date" | "select" {
  return value === "number" || value === "date" || value === "select" ? value : "text";
}

export function assignmentMethodValue(value: string | null | undefined): AssignmentMethod {
  const methods: AssignmentMethod[] = [
    "Round robin",
    "Weighted round robin",
    "Territory-based",
    "Industry-based",
    "Lead-score based",
    "Capacity-based",
    "Account ownership",
    "Client/team-based",
    "Timezone/language"
  ];
  return value && methods.includes(value as AssignmentMethod) ? value as AssignmentMethod : "Capacity-based";
}

export function sdrLeadStatusValue(value: string | null | undefined): SdrLeadStatus {
  const statuses: SdrLeadStatus[] = [
    "New",
    "Assigned",
    "Working",
    "Contacted",
    "Opened",
    "Replied",
    "Interested",
    "Meeting Booked",
    "Qualified",
    "Proposal Sent",
    "Won",
    "Lost",
    "Nurture",
    "Disqualified",
    "Invalid",
    "Unsubscribed",
    "Suppressed"
  ];
  return value && statuses.includes(value as SdrLeadStatus) ? value as SdrLeadStatus : "Assigned";
}

export function slaStatusValue(value: string | null | undefined): SlaStatus {
  const statuses: SlaStatus[] = ["On track", "Due soon", "Overdue", "No SLA", "Paused"];
  return value && statuses.includes(value as SlaStatus) ? value as SlaStatus : "No SLA";
}

export function reminderStatusValue(value: string | null | undefined): ReminderStatus {
  const statuses: ReminderStatus[] = ["Open", "Completed", "Snoozed", "Overdue"];
  return value && statuses.includes(value as ReminderStatus) ? value as ReminderStatus : "Open";
}

export function outreachChannelValue(value: string | null | undefined): OutreachChannel {
  const channels: OutreachChannel[] = ["Email", "Call", "SMS", "LinkedIn", "Meeting"];
  return value && channels.includes(value as OutreachChannel) ? value as OutreachChannel : "Email";
}

export function outreachProviderKindValue(value: string | null | undefined): OutreachProviderKind {
  return value === "SMS" || value === "Voice" ? value : "Email";
}

export function outreachProviderStatusValue(value: string | null | undefined): OutreachProviderStatus {
  return value === "Paused" || value === "Needs review" ? value : "Connected";
}

export function campaignStatusValue(value: string | null | undefined): CampaignStatus {
  return value === "Active" || value === "Paused" || value === "Completed" ? value : "Draft";
}

export function campaignTypeValue(value: string | null | undefined): CampaignType {
  return value === "Email" || value === "SMS" || value === "Call" || value === "Multichannel" ? value : "Multichannel";
}

export function sequenceStatusValue(value: string | null | undefined): SequenceStatus {
  return value === "Draft" || value === "Paused" ? value : "Active";
}

export function sequenceComplianceStatusValue(value: string | null | undefined): SequenceComplianceStatus {
  const statuses: SequenceComplianceStatus[] = ["Compliant", "Needs footer", "Needs address", "Needs STOP", "Needs review"];
  return value && statuses.includes(value as SequenceComplianceStatus) ? value as SequenceComplianceStatus : "Compliant";
}

export function emailEventTypeValue(value: string | null | undefined): EmailEventType {
  const types: EmailEventType[] = [
    "Sent",
    "Delivered",
    "Opened",
    "Clicked",
    "Replied",
    "Bounced",
    "Unsubscribed",
    "Spam complaint"
  ];
  return value && types.includes(value as EmailEventType) ? value as EmailEventType : "Sent";
}

export function smsEventStatusValue(value: string | null | undefined): SmsEventStatus {
  const statuses: SmsEventStatus[] = ["Sent", "Delivered", "Failed", "Replied", "Opt-out"];
  return value && statuses.includes(value as SmsEventStatus) ? value as SmsEventStatus : "Sent";
}

export function callDirectionValue(value: string | null | undefined): CallDirection {
  return value === "Inbound" ? "Inbound" : "Outbound";
}

export function trackedCallStatusValue(value: string | null | undefined): TrackedCallStatus {
  const statuses: TrackedCallStatus[] = ["Dialed", "Connected", "No answer", "Voicemail", "Busy", "Failed"];
  return value && statuses.includes(value as TrackedCallStatus) ? value as TrackedCallStatus : "Dialed";
}

export function callDispositionValue(value: string | null | undefined): CallDisposition {
  const dispositions: CallDisposition[] = [
    "Interested",
    "Not interested",
    "Left voicemail",
    "No answer",
    "Bad number",
    "Meeting booked"
  ];
  return value && dispositions.includes(value as CallDisposition) ? value as CallDisposition : "No answer";
}

export function recordingConsentValue(value: string | null | undefined): RecordingConsentStatus {
  const statuses: RecordingConsentStatus[] = ["Granted", "Denied", "Unknown", "Not recorded"];
  return value && statuses.includes(value as RecordingConsentStatus) ? value as RecordingConsentStatus : "Unknown";
}

export function webhookEventStatusValue(value: string | null | undefined): WebhookEvent["status"] {
  const statuses: WebhookEvent["status"][] = ["Processed", "Duplicate", "Rejected", "Failed"];
  return value && statuses.includes(value as WebhookEvent["status"]) ? value as WebhookEvent["status"] : "Processed";
}

function workspaceRoleValue(value: string): WorkspaceRole {
  const roles: Record<string, WorkspaceRole> = {
    ADMIN: "Admin",
    MANAGER: "Manager",
    SDR: "SDR",
    DATA_OPERATOR: "Data Operator",
    VIEWER: "Viewer",
    COMPLIANCE_ADMIN: "Compliance Admin",
    Admin: "Admin",
    Manager: "Manager",
    "Data Operator": "Data Operator",
    Viewer: "Viewer",
    "Compliance Admin": "Compliance Admin"
  };
  return roles[value] ?? "Viewer";
}

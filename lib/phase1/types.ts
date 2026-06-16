import type { ProviderCapability, ProviderCategory, ProviderExecutionMode, ProviderId } from "@/lib/providers/types";

export type WorkspaceRole =
  | "Admin"
  | "Manager"
  | "SDR"
  | "Data Operator"
  | "Viewer"
  | "Compliance Admin";

export type Permission =
  | "manage_workspace"
  | "manage_profiles"
  | "run_jobs"
  | "import_csv"
  | "view_all_records"
  | "manage_crm"
  | "manage_sdr"
  | "manage_outreach"
  | "export_csv"
  | "manage_export_rules"
  | "manage_enrichment"
  | "manage_compliance"
  | "view_reports"
  | "manage_retention"
  | "manage_ai_automation";

export type JobStatus = "Draft" | "Queued" | "Running" | "Paused" | "Completed" | "Failed";
export type ProcessingStatus = "Pending" | "Normalized" | "Failed" | "Suppressed";
export type LeadGrade = "A" | "B" | "C" | "D" | "S";
export type Priority = "P1" | "P2" | "P3" | "P4" | "S";
export type MoneySource = "Actual" | "Estimated" | "Manual" | "Demo" | "System-generated" | "Projected";
export type MoneyCurrency = "USD";
export type LeadStatus =
  | "New"
  | "Assigned"
  | "Working"
  | "Contacted"
  | "Opened"
  | "Replied"
  | "Interested"
  | "Meeting Booked"
  | "Qualified"
  | "Proposal Sent"
  | "Won"
  | "Lost"
  | "Nurture"
  | "Disqualified"
  | "Invalid"
  | "Unsubscribed"
  | "Ready for SDR"
  | "Needs enrichment"
  | "Suppressed"
  | "In review"
  | "Exported";
export type OpportunityStage =
  | "Prospecting"
  | "Qualified"
  | "Discovery"
  | "Proposal"
  | "Closed won"
  | "Closed lost";
export type TaskStatus = "Open" | "Completed" | "Overdue";
export type TaskPriority = "Low" | "Normal" | "High";
export type ActivityType =
  | "Email"
  | "Call"
  | "SMS"
  | "Note"
  | "Task"
  | "Meeting"
  | "Status change"
  | "Verification"
  | "Opportunity";
export type SdrLeadStatus =
  | "New"
  | "Assigned"
  | "Working"
  | "Contacted"
  | "Opened"
  | "Replied"
  | "Interested"
  | "Meeting Booked"
  | "Qualified"
  | "Proposal Sent"
  | "Won"
  | "Lost"
  | "Nurture"
  | "Disqualified"
  | "Invalid"
  | "Unsubscribed"
  | "Suppressed";
export type AssignmentMethod =
  | "Round robin"
  | "Weighted round robin"
  | "Territory-based"
  | "Industry-based"
  | "Lead-score based"
  | "Capacity-based"
  | "Account ownership"
  | "Client/team-based"
  | "Timezone/language";
export type SlaStatus = "On track" | "Due soon" | "Overdue" | "No SLA" | "Paused";
export type ReminderStatus = "Open" | "Completed" | "Snoozed" | "Overdue";
export type OutreachChannel = "Email" | "Call" | "SMS" | "LinkedIn" | "Meeting";
export type ReassignmentTrigger = "SLA overdue" | "Owner overloaded" | "Inactive owner" | "Territory mismatch";
export type LawfulBasis = "Legitimate interest" | "Consent" | "Contract" | "Legal obligation" | "Do not contact";
export type ConsentStatus = "Not required" | "Granted" | "Revoked" | "Unknown";

export type Workspace = {
  id: string;
  name: string;
  market: string;
  seats: number;
  health: string;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type WorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};

export type Session = {
  user: User;
  workspace: Workspace;
  role: WorkspaceRole;
  permissions: Permission[];
};

export type SearchProfile = {
  id: string;
  workspaceId: string;
  name: string;
  targetMarket: string;
  geographies: string[];
  industries: string[];
  titles: string[];
  sources: string[];
  requiredFields: string[];
  scoringProfile: string;
  segmentRules: string[];
  defaultRouting: string;
  estimatedVolume: number;
  complianceNote: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadJob = {
  id: string;
  workspaceId: string;
  searchProfileId?: string;
  name: string;
  status: JobStatus;
  progress: number;
  sources: string[];
  estimatedRecords?: number;
  estimatedCostCents?: number;
  estimatedCredits?: number;
  budgetCapCents?: number;
  budgetStatus?: "Draft estimate" | "Within budget" | "Over budget" | "Confirmed";
  budgetConfirmedAt?: string;
  budgetConfirmedById?: string;
  preflightSourceEstimates?: LeadSourceEstimate[];
  enrichmentBudgetCents?: number;
  highValueOnlyEnrichment?: boolean;
  raw: number;
  normalized: number;
  duplicates: number;
  suppressed: number;
  verified: number;
  enriched: number;
  exported: number;
  pushedToCrm: number;
  actualCost: number;
  actualCostCents?: number;
  estimatedCostSource?: MoneySource;
  actualCostSource?: MoneySource;
  budgetCapSource?: MoneySource;
  startedAt?: string;
  completedAt?: string;
  eta: string;
  errorSummary: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadSourceEstimate = {
  source: string;
  estimatedRecords: number;
  estimatedCostCents: number;
  estimatedCredits: number;
  unitCostCents: number;
  confidence: number;
};

export type JobRunStatus = "Queued" | "Running" | "Completed" | "Failed" | "Retry scheduled" | "Skipped";
export type JobLogLevel = "Info" | "Warning" | "Error";

export type AsyncJobRun = {
  id: string;
  workspaceId: string;
  leadJobId: string;
  source: string;
  status: JobRunStatus;
  attempt: number;
  maxAttempts: number;
  providerRunId: string;
  idempotencyKey: string;
  checkpoint?: Record<string, string | number | boolean | undefined>;
  creditUsage: number;
  recordsRead: number;
  recordsWritten: number;
  startedAt?: string;
  completedAt?: string;
  nextRetryAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type JobLog = {
  id: string;
  workspaceId: string;
  leadJobId: string;
  runId?: string;
  level: JobLogLevel;
  message: string;
  metadata?: Record<string, string | number | boolean | undefined>;
  createdAt: string;
};

export type JobIdempotencyRecord = {
  id: string;
  workspaceId: string;
  key: string;
  scope: "lead_job" | "csv_import" | "provider_run";
  requestHash: string;
  leadJobId: string;
  status: "Reserved" | "Completed" | "Failed";
  recordIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProviderConnectionStatus = "Not configured" | "Connected" | "Needs attention" | "Disabled";
export type ProviderSecretStorage = "Not configured" | "Encrypted database" | "Managed secret store" | "Environment";
export type ProviderConnectionTestStatus = "Not tested" | "Passed" | "Failed" | "Skipped";
export type ProviderCredentialAuditAction =
  | "Created"
  | "Updated"
  | "Secret rotated"
  | "Tested"
  | "Enabled"
  | "Disabled"
  | "Deleted"
  | "Scopes changed";

export type ProviderConnection = {
  id: string;
  workspaceId: string;
  providerId: ProviderId;
  displayName: string;
  status: ProviderConnectionStatus;
  enabled: boolean;
  executionMode: ProviderExecutionMode;
  categories: ProviderCategory[];
  capabilities: ProviderCapability[];
  scopes: string[];
  allowedOperations: ProviderCapability[];
  credentialLabel?: string;
  secretRef?: string;
  secretStorage: ProviderSecretStorage;
  secretVersion: number;
  maskedSecretSuffix?: string;
  rateLimitPerMinute?: number;
  dailyBudgetCents?: number;
  waterfallOrder: number;
  lastTestStatus: ProviderConnectionTestStatus;
  lastTestedAt?: string;
  lastTestedById?: string;
  lastTestError?: string;
  createdById?: string;
  updatedById?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderCredentialAudit = {
  id: string;
  workspaceId: string;
  providerConnectionId: string;
  providerId: ProviderId;
  actorUserId?: string;
  action: ProviderCredentialAuditAction;
  secretVersion: number;
  redactedMetadata: Record<string, string | number | boolean | string[] | undefined>;
  createdAt: string;
};

export type ProviderEncryptedSecret = {
  id: string;
  workspaceId: string;
  providerConnectionId: string;
  providerId: ProviderId;
  secretRef: string;
  secretVersion: number;
  storage: ProviderSecretStorage;
  algorithm: string;
  keyId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  checksum: string;
  rotatedFromSecretRef?: string;
  createdById?: string;
  createdAt: string;
};

export type ProviderJobStatus =
  | "Queued"
  | "Running"
  | "Completed"
  | "Failed"
  | "Retry scheduled"
  | "Skipped"
  | "Cancelled";

export type ProviderJobOperation = ProviderCapability;

export type ProviderJob = {
  id: string;
  workspaceId: string;
  providerConnectionId: string;
  providerId: ProviderId;
  operation: ProviderJobOperation;
  status: ProviderJobStatus;
  priority: number;
  idempotencyKey: string;
  requestHash: string;
  sourceObjectType?: string;
  sourceObjectId?: string;
  inputSummary: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  recordsRead: number;
  recordsWritten: number;
  costCents: number;
  errorMessage?: string;
  maxAttempts: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  nextRetryAt?: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderJobRun = {
  id: string;
  workspaceId: string;
  providerJobId: string;
  providerConnectionId: string;
  providerId: ProviderId;
  operation: ProviderJobOperation;
  status: ProviderJobStatus;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  providerRequestId: string;
  providerRunId?: string;
  checkpoint?: Record<string, string | number | boolean | undefined>;
  requestSummary?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
  rawResponseRef?: string;
  recordsRead: number;
  recordsWritten: number;
  costCents: number;
  durationMs?: number;
  errorMessage?: string;
  lockedBy?: string;
  lockedAt?: string;
  lockExpiresAt?: string;
  startedAt?: string;
  completedAt?: string;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderUsageLedger = {
  id: string;
  workspaceId: string;
  provider: string;
  operation: string;
  jobId?: string;
  providerJobId?: string;
  providerJobRunId?: string;
  unitsUsed: number;
  unitCostCents: number;
  totalCostCents: number;
  currency: MoneyCurrency;
  amountKind: MoneySource;
  rawProviderMetadata: Record<string, unknown>;
  createdAt: string;
};

export type RawLead = {
  id: string;
  workspaceId: string;
  leadJobId: string;
  source: string;
  sourceRecordId: string;
  sourcePayload: Record<string, string>;
  sourceUrl?: string;
  sourceConfidence?: number;
  extractedAt: string;
  processingStatus: ProcessingStatus;
  processingError?: string;
};

export type NormalizedRecord = {
  id: string;
  workspaceId: string;
  rawLeadId: string;
  leadJobId: string;
  companyName: string;
  normalizedCompanyName: string;
  contactName: string;
  title: string;
  email: string;
  phone: string;
  domain: string;
  website: string;
  city: string;
  state: string;
  country: string;
  industry: string;
  source: string;
  grade: LeadGrade;
  score: number;
  priority: Priority;
  status: LeadStatus;
  segment: string;
  owner: string;
  verification: string;
  duplicateCompanyId?: string;
  duplicateContactId?: string;
  suppressionReason?: string;
  normalizedAt: string;
};

export type Company = {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  domain: string;
  website: string;
  phone: string;
  industry: string;
  employeeBand?: string;
  revenueBand?: string;
  technologies?: string[];
  signals?: string[];
  enrichmentCoverage?: number;
  city: string;
  state: string;
  country: string;
  sourceLineage: string[];
  score: number;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
};

export type Contact = {
  id: string;
  workspaceId: string;
  companyId: string;
  name: string;
  title: string;
  seniority?: string;
  department?: string;
  email: string;
  phone: string;
  grade: LeadGrade;
  score: number;
  priority: Priority;
  status: LeadStatus;
  segment: string;
  owner: string;
  sourceLineage: string[];
  verification: string;
  enrichmentCoverage?: number;
  fitReason?: string;
  enrichedAt?: string;
  lawfulBasis: LawfulBasis;
  consentStatus: ConsentStatus;
  consentSource: string;
  consentCapturedAt?: string;
  doNotContact: boolean;
  isSuppressed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SuppressionRecord = {
  id: string;
  workspaceId: string;
  type:
    | "Unsubscribe"
    | "Hard bounce"
    | "Do not call"
    | "Existing customer"
    | "Competitor"
    | "Spam complaint"
    | "SMS opt-out"
    | "Deletion request";
  email?: string;
  phone?: string;
  domain?: string;
  reason: string;
  source: string;
  createdAt: string;
};

export type ExportRecord = {
  id: string;
  workspaceId: string;
  leadJobId?: string;
  exportRuleId?: string;
  name: string;
  type: "companies" | "contacts" | "verified_email_leads" | "phone_leads" | "sdr_assignments";
  columns: string[];
  recordIds: string[];
  recordCount: number;
  blockedCount?: number;
  createdById: string;
  createdAt: string;
  status: "Ready" | "Draft";
};

export type VerificationResult = {
  id: string;
  workspaceId: string;
  contactId: string;
  provider: "Syncore Local";
  email: string;
  phone: string;
  grade: LeadGrade;
  emailStatus: "Valid" | "Risky" | "Invalid" | "Missing" | "Suppressed";
  domainStatus: "Mail-capable" | "Missing" | "Invalid";
  phoneStatus: "Valid" | "Invalid" | "Missing";
  roleEmail: boolean;
  disposable: boolean;
  catchAll: boolean;
  suppressionReason?: string;
  checks: string[];
  rawResponse: Record<string, string | number | boolean | string[] | undefined>;
  verifiedAt: string;
  expiresAt: string;
};

export type DedupeMatch = {
  id: string;
  workspaceId: string;
  objectType: "company" | "contact";
  primaryId: string;
  duplicateId: string;
  reason: string;
  confidence: number;
  status: "Open" | "Merged" | "Ignored";
  detectedAt: string;
  resolvedAt?: string;
};

export type ExportRule = {
  id: string;
  workspaceId: string;
  name: string;
  exportType: ExportRecord["type"];
  allowedGrades: LeadGrade[];
  allowedStatuses: LeadStatus[];
  minScore: number;
  includeRoleEmails: boolean;
  includeCatchAll: boolean;
  requirePhone: boolean;
  excludeSuppressed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EnrichmentProvider =
  | "Syncore Apollo Local"
  | "Syncore Hunter Local"
  | "Syncore Web Signals Local";

export type EnrichmentTargetType = "company" | "contact";

export type EnrichmentFields = {
  industry?: string;
  employeeBand?: string;
  revenueBand?: string;
  technologies?: string[];
  signals?: string[];
  seniority?: string;
  department?: string;
  directEmailCandidate?: string;
  confidenceNote?: string;
};

export type EnrichmentResult = {
  id: string;
  workspaceId: string;
  provider: EnrichmentProvider;
  targetType: EnrichmentTargetType;
  targetId: string;
  confidence: number;
  fields: EnrichmentFields;
  rawResponse: Record<string, string | number | boolean | string[] | undefined>;
  cacheKey: string;
  enrichedAt: string;
  expiresAt: string;
};

export type ProviderCacheEntry = {
  id: string;
  workspaceId: string;
  provider: EnrichmentProvider;
  targetType: EnrichmentTargetType;
  cacheKey: string;
  inputHash: string;
  fields: EnrichmentFields;
  confidence: number;
  hits: number;
  createdAt: string;
  expiresAt: string;
};

export type SegmentCondition = {
  industries: string[];
  titleKeywords: string[];
  domainKeywords: string[];
  technologyKeywords: string[];
  signalKeywords: string[];
  grades: LeadGrade[];
  minScore: number;
  requirePhone: boolean;
};

export type SegmentRule = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  outputSegment: string;
  scoreBoost: number;
  priorityOverride?: Priority;
  conditions: SegmentCondition;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RecordSegment = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  segmentRuleId: string;
  segment: string;
  scoreContribution: number;
  assignedAt: string;
};

export type LeadScore = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  score: number;
  priority: Priority;
  breakdown: {
    verification: number;
    enrichment: number;
    segment: number;
    fit: number;
    compliance: number;
  };
  reasons: string[];
  calculatedAt: string;
};

export type Opportunity = {
  id: string;
  workspaceId: string;
  companyId: string;
  contactId?: string;
  name: string;
  stage: OpportunityStage;
  amount: number;
  probability: number;
  expectedCloseDate?: string;
  ownerUserId: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmTask = {
  id: string;
  workspaceId: string;
  companyId?: string;
  contactId?: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt?: string;
  ownerUserId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type Note = {
  id: string;
  workspaceId: string;
  companyId?: string;
  contactId?: string;
  body: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type CallLog = {
  id: string;
  workspaceId: string;
  companyId?: string;
  contactId?: string;
  phone: string;
  outcome: "Connected" | "Left voicemail" | "No answer" | "Bad number";
  durationSeconds: number;
  notes: string;
  createdById: string;
  createdAt: string;
};

export type Activity = {
  id: string;
  workspaceId: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
  type: ActivityType;
  title: string;
  body?: string;
  actorUserId: string;
  metadata?: Record<string, string | number | boolean | undefined>;
  createdAt: string;
};

export type CustomField = {
  id: string;
  workspaceId: string;
  objectType: "company" | "contact" | "opportunity";
  name: string;
  fieldType: "text" | "number" | "date" | "select";
  options?: string[];
  createdAt: string;
};

export type CustomFieldValue = {
  id: string;
  workspaceId: string;
  customFieldId: string;
  objectId: string;
  value: string;
  updatedAt: string;
};

export type SdrTeam = {
  id: string;
  workspaceId: string;
  name: string;
  managerUserId: string;
  memberUserIds: string[];
  territories: string[];
  industries: string[];
  capacityWeight: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SdrAssignment = {
  id: string;
  workspaceId: string;
  companyId: string;
  contactId: string;
  assignedSdrId: string;
  assignedTeamId?: string;
  assignedById: string;
  assignmentMethod: AssignmentMethod;
  assignmentReason: string;
  assignedAt: string;
  firstTouchDueAt?: string;
  followUpDueAt?: string;
  status: SdrLeadStatus;
  reassignmentReason?: string;
  previousOwnerId?: string;
  slaStatus: SlaStatus;
  firstTouchedAt?: string;
  lastTouchAt?: string;
  touchCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FollowUpReminder = {
  id: string;
  workspaceId: string;
  assignmentId: string;
  companyId: string;
  contactId: string;
  ownerUserId: string;
  title: string;
  channel: OutreachChannel;
  dueAt: string;
  status: ReminderStatus;
  createdAt: string;
  completedAt?: string;
  snoozedUntil?: string;
};

export type ReassignmentRule = {
  id: string;
  workspaceId: string;
  name: string;
  trigger: ReassignmentTrigger;
  assignmentMethod: AssignmentMethod;
  thresholdHours: number;
  targetTeamId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OutreachProviderKind = "Email" | "SMS" | "Voice";
export type OutreachProviderStatus = "Connected" | "Paused" | "Needs review";
export type CampaignStatus = "Draft" | "Active" | "Paused" | "Completed";
export type CampaignType = "Email" | "SMS" | "Call" | "Multichannel";
export type SequenceStatus = "Draft" | "Active" | "Paused";
export type SequenceComplianceStatus = "Compliant" | "Needs footer" | "Needs address" | "Needs STOP" | "Needs review";
export type EmailEventType =
  | "Sent"
  | "Delivered"
  | "Opened"
  | "Clicked"
  | "Replied"
  | "Bounced"
  | "Unsubscribed"
  | "Spam complaint";
export type SmsEventStatus = "Sent" | "Delivered" | "Failed" | "Replied" | "Opt-out";
export type CallDirection = "Outbound" | "Inbound";
export type TrackedCallStatus = "Dialed" | "Connected" | "No answer" | "Voicemail" | "Busy" | "Failed";
export type RecordingConsentStatus = "Granted" | "Denied" | "Unknown" | "Not recorded";
export type CallDisposition =
  | "Interested"
  | "Not interested"
  | "Left voicemail"
  | "No answer"
  | "Bad number"
  | "Meeting booked";

export type OutreachProvider = {
  id: string;
  workspaceId: string;
  kind: OutreachProviderKind;
  provider: "Syncore Mail Local" | "RingCentral Local";
  status: OutreachProviderStatus;
  sendingDomain?: string;
  mailboxGroup?: string;
  senderEmail?: string;
  fromNumber?: string;
  dailyLimit: number;
  sentToday: number;
  bounceRate: number;
  complaintRate: number;
  unsubscribeRate: number;
  warmupStage: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  tls: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OutreachCampaign = {
  id: string;
  workspaceId: string;
  name: string;
  campaignType: CampaignType;
  targetSegment: string;
  sourceJobIds: string[];
  ownerUserId: string;
  sendingDomain: string;
  mailboxGroup: string;
  status: CampaignStatus;
  startDate?: string;
  endDate?: string;
  totalLeads: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  meetingsBooked: number;
  opportunitiesCreated: number;
  revenueWon: number;
  createdAt: string;
  updatedAt: string;
};

export type CampaignSequence = {
  id: string;
  workspaceId: string;
  campaignId: string;
  name: string;
  targetSegment: string;
  defaultDelayRules: string;
  stopOnReply: boolean;
  stopOnBounce: boolean;
  stopOnUnsubscribe: boolean;
  createdById: string;
  status: SequenceStatus;
  createdAt: string;
  updatedAt: string;
};

export type SequenceStep = {
  id: string;
  workspaceId: string;
  sequenceId: string;
  stepNumber: number;
  channel: OutreachChannel;
  delayDays: number;
  subject?: string;
  bodyTemplate?: string;
  callScript?: string;
  smsTemplate?: string;
  manualTaskInstruction?: string;
  personalizationVariables: string[];
  requiredFields: string[];
  unsubscribeFooterRequired: boolean;
  physicalAddress?: string;
  complianceStatus: SequenceComplianceStatus;
  complianceNotes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmailEvent = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  campaignId?: string;
  sequenceId?: string;
  sequenceStepId?: string;
  messageId: string;
  provider: "Syncore Mail Local";
  senderEmail: string;
  recipientEmail: string;
  eventType: EmailEventType;
  subject: string;
  bodySnapshot: string;
  sentAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  repliedAt?: string;
  bouncedAt?: string;
  unsubscribeAt?: string;
  bounceType?: "Hard" | "Soft";
  smtpCode?: string;
  rawPayload: Record<string, string | number | boolean | undefined>;
};

export type SmsEvent = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  campaignId?: string;
  sequenceId?: string;
  sequenceStepId?: string;
  sdrUserId: string;
  provider: "RingCentral Local";
  fromNumber: string;
  toNumber: string;
  direction: "Outbound" | "Inbound";
  body: string;
  status: SmsEventStatus;
  deliveredAt?: string;
  repliedAt?: string;
  failedAt?: string;
  optOutFlag: boolean;
  rawPayload: Record<string, string | number | boolean | undefined>;
  createdAt: string;
};

export type WebhookProvider = "Syncore Mail Local" | "RingCentral Local";
export type WebhookEventStatus = "Processed" | "Duplicate" | "Rejected" | "Failed";
export type WebhookEventTarget = "email" | "sms";

export type WebhookEvent = {
  id: string;
  workspaceId: string;
  provider: WebhookProvider;
  target: WebhookEventTarget;
  providerEventId: string;
  eventType: string;
  idempotencyKey: string;
  status: WebhookEventStatus;
  processedRecordId?: string;
  errorMessage?: string;
  rawPayload: Record<string, string | number | boolean | undefined>;
  receivedAt: string;
  processedAt?: string;
};

export type TrackedCall = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  sdrUserId: string;
  phoneNumber: string;
  direction: CallDirection;
  callStatus: TrackedCallStatus;
  disposition: CallDisposition;
  durationSeconds: number;
  recordingConsent: RecordingConsentStatus;
  recordingConsentSource?: string;
  recordingConsentCapturedAt?: string;
  recordingUrl?: string;
  recordingStoragePath?: string;
  transcript?: string;
  callSummary?: string;
  nextStep?: string;
  createdAt: string;
};

export type ReportCategory =
  | "Executive Overview"
  | "Lead Source Performance"
  | "SDR Performance"
  | "Campaign Performance"
  | "Deliverability Health"
  | "Pipeline Dashboard"
  | "Data Quality"
  | "Enrichment Performance"
  | "Activity Volume"
  | "Compliance Dashboard"
  | "Revenue Attribution";

export type ReportMetric = {
  label: string;
  value: number;
  unit?: "count" | "percent" | "currency";
  note?: string;
};

export type ReportSnapshot = {
  id: string;
  workspaceId: string;
  category: ReportCategory;
  title: string;
  metrics: ReportMetric[];
  generatedById: string;
  generatedAt: string;
};

export type RetentionAction = "Purge" | "Anonymize" | "Preserve" | "Expire export" | "Review";
export type RetentionRunMode = "Preview" | "Apply";
export type RetentionRunStatus = "Previewed" | "Applied" | "Skipped";

export type RetentionPolicy = {
  id: string;
  workspaceId: string;
  dataType: string;
  retentionDays: number;
  action: RetentionAction;
  active: boolean;
  legalBasis: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type RetentionRun = {
  id: string;
  workspaceId: string;
  retentionPolicyId: string;
  dataType: string;
  mode: RetentionRunMode;
  action: RetentionAction;
  candidateCount: number;
  affectedCount: number;
  status: RetentionRunStatus;
  summary: string;
  runById: string;
  runAt: string;
};

export type ComplianceChecklistStatus = "Pass" | "Warning" | "Fail";
export type DataSubjectRequestType = "Access" | "Deletion" | "Suppression" | "Correction" | "Export";
export type DataSubjectRequestStatus = "Open" | "Verified" | "Completed" | "Rejected";

export type ComplianceChecklistItem = {
  id: string;
  workspaceId: string;
  category: string;
  requirement: string;
  control: string;
  status: ComplianceChecklistStatus;
  evidence: string;
  ownerRole: WorkspaceRole;
  updatedAt: string;
};

export type DataSubjectRequest = {
  id: string;
  workspaceId: string;
  requestType: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  email?: string;
  phone?: string;
  contactId?: string;
  requestedAt: string;
  dueAt: string;
  verifiedAt?: string;
  completedAt?: string;
  handledById?: string;
  notes: string;
  evidence?: string;
};

export type DeliverabilityAlertSeverity = "Info" | "Warning" | "Critical";
export type DeliverabilityAlertStatus = "Open" | "Resolved";

export type DeliverabilityAlert = {
  id: string;
  workspaceId: string;
  providerId?: string;
  trigger: string;
  severity: DeliverabilityAlertSeverity;
  status: DeliverabilityAlertStatus;
  currentValue: number;
  threshold: number;
  recommendation: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedById?: string;
};

export type AiRecordStatus = "Generated" | "Applied" | "Dismissed";
export type AiReplyIntent = "Positive" | "Negative" | "Objection" | "OOO" | "Unsubscribe" | "Neutral";
export type AiSentiment = "Positive" | "Neutral" | "Negative";
export type AiAutomationStatus = "Completed" | "Skipped" | "Failed";
export type AiAutomationKind =
  | "Personalization"
  | "Reply classification"
  | "Call summaries"
  | "Lead scoring"
  | "ICP builder"
  | "Deliverability advisor"
  | "Revenue attribution insights"
  | "Full automation suite";

export type AiPersonalization = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  campaignId?: string;
  provider: "Syncore AI Local";
  firstLine: string;
  painPointAngle: string;
  recommendedOffer: string;
  recommendedChannel: OutreachChannel;
  confidence: number;
  status: AiRecordStatus;
  generatedById: string;
  generatedAt: string;
  appliedAt?: string;
};

export type AiReplyClassification = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  campaignId?: string;
  emailEventId?: string;
  smsEventId?: string;
  channel: "Email" | "SMS";
  intent: AiReplyIntent;
  sentiment: AiSentiment;
  confidence: number;
  summary: string;
  recommendedAction: string;
  status: AiRecordStatus;
  classifiedAt: string;
};

export type AiCallSummary = {
  id: string;
  workspaceId: string;
  trackedCallId: string;
  contactId: string;
  companyId: string;
  provider: "Syncore AI Local";
  summary: string;
  nextSteps: string[];
  sentiment: AiSentiment;
  objections: string[];
  topics: string[];
  confidence: number;
  status: AiRecordStatus;
  generatedAt: string;
};

export type AiLeadScorePrediction = {
  id: string;
  workspaceId: string;
  contactId: string;
  companyId: string;
  provider: "Syncore AI Local";
  modelVersion: string;
  score: number;
  conversionProbability: number;
  priority: Priority;
  factors: string[];
  risks: string[];
  recommendedAction: string;
  status: AiRecordStatus;
  generatedAt: string;
  appliedAt?: string;
};

export type AiIcpRecommendation = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  industries: string[];
  titles: string[];
  geographies: string[];
  technologies: string[];
  segments: string[];
  sourceSummary: string;
  fitSignals: string[];
  confidence: number;
  prompt?: string;
  status: AiRecordStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  appliedSearchProfileId?: string;
};

export type AiDeliverabilityRecommendation = {
  id: string;
  workspaceId: string;
  providerId?: string;
  title: string;
  severity: DeliverabilityAlertSeverity;
  recommendation: string;
  triggerMetric: string;
  expectedImpact: string;
  status: AiRecordStatus;
  createdAt: string;
  appliedAt?: string;
};

export type AiRevenueInsight = {
  id: string;
  workspaceId: string;
  dimension: "Source" | "Segment" | "Campaign" | "SDR";
  dimensionValue: string;
  insight: string;
  recommendedAction: string;
  impactAmount: number;
  confidence: number;
  status: AiRecordStatus;
  createdAt: string;
};

export type AiAutomationRun = {
  id: string;
  workspaceId: string;
  automationType: AiAutomationKind;
  status: AiAutomationStatus;
  recordsAnalyzed: number;
  recordsCreated: number;
  summary: string;
  runById: string;
  startedAt: string;
  completedAt: string;
};

export type AuditLog = {
  id: string;
  workspaceId: string;
  actorUserId: string;
  objectType: string;
  objectId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  createdAt: string;
};

export type AppState = {
  version: 15;
  workspaces: Workspace[];
  users: User[];
  workspaceMembers: WorkspaceMember[];
  providerConnections: ProviderConnection[];
  providerCredentialAudits: ProviderCredentialAudit[];
  providerEncryptedSecrets: ProviderEncryptedSecret[];
  providerJobs: ProviderJob[];
  providerJobRuns: ProviderJobRun[];
  providerUsageLedger: ProviderUsageLedger[];
  searchProfiles: SearchProfile[];
  leadJobs: LeadJob[];
  asyncJobRuns: AsyncJobRun[];
  jobLogs: JobLog[];
  jobIdempotencyRecords: JobIdempotencyRecord[];
  rawLeads: RawLead[];
  normalizedRecords: NormalizedRecord[];
  companies: Company[];
  contacts: Contact[];
  verificationResults: VerificationResult[];
  dedupeMatches: DedupeMatch[];
  exportRules: ExportRule[];
  providerCache: ProviderCacheEntry[];
  enrichmentResults: EnrichmentResult[];
  segmentRules: SegmentRule[];
  recordSegments: RecordSegment[];
  leadScores: LeadScore[];
  opportunities: Opportunity[];
  activities: Activity[];
  tasks: CrmTask[];
  notes: Note[];
  callLogs: CallLog[];
  customFields: CustomField[];
  customFieldValues: CustomFieldValue[];
  sdrTeams: SdrTeam[];
  sdrAssignments: SdrAssignment[];
  followUpReminders: FollowUpReminder[];
  reassignmentRules: ReassignmentRule[];
  outreachProviders: OutreachProvider[];
  outreachCampaigns: OutreachCampaign[];
  campaignSequences: CampaignSequence[];
  sequenceSteps: SequenceStep[];
  emailEvents: EmailEvent[];
  smsEvents: SmsEvent[];
  webhookEvents: WebhookEvent[];
  trackedCalls: TrackedCall[];
  reportSnapshots: ReportSnapshot[];
  retentionPolicies: RetentionPolicy[];
  retentionRuns: RetentionRun[];
  complianceChecklistItems: ComplianceChecklistItem[];
  dataSubjectRequests: DataSubjectRequest[];
  deliverabilityAlerts: DeliverabilityAlert[];
  aiPersonalizations: AiPersonalization[];
  aiReplyClassifications: AiReplyClassification[];
  aiCallSummaries: AiCallSummary[];
  aiLeadScorePredictions: AiLeadScorePrediction[];
  aiIcpRecommendations: AiIcpRecommendation[];
  aiDeliverabilityRecommendations: AiDeliverabilityRecommendation[];
  aiRevenueInsights: AiRevenueInsight[];
  aiAutomationRuns: AiAutomationRun[];
  suppressionRecords: SuppressionRecord[];
  exports: ExportRecord[];
  auditLogs: AuditLog[];
};

export type CsvImportMapping = {
  companyName?: string;
  contactName?: string;
  title?: string;
  email?: string;
  phone?: string;
  domain?: string;
  website?: string;
  city?: string;
  state?: string;
  country?: string;
  industry?: string;
  sourceUrl?: string;
};

export type CsvImportResult = {
  jobId: string;
  replayed?: boolean;
  idempotencyKey?: string;
  raw: number;
  normalized: number;
  duplicates: number;
  suppressed: number;
  companies: number;
  contacts: number;
};

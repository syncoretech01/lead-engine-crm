-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('ADMIN', 'MANAGER', 'SDR', 'DATA_OPERATOR', 'VIEWER', 'COMPLIANCE_ADMIN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'NORMALIZED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "VerificationGrade" AS ENUM ('A', 'B', 'C', 'D', 'S');

-- CreateEnum
CREATE TYPE "PriorityTier" AS ENUM ('P1', 'P2', 'P3', 'P4', 'S');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('PROSPECTING', 'QUALIFIED', 'DISCOVERY', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('EMAIL', 'CALL', 'SMS', 'NOTE', 'TASK', 'MEETING', 'STATUS_CHANGE', 'VERIFICATION', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "SuppressionType" AS ENUM ('UNSUBSCRIBE', 'HARD_BOUNCE', 'DO_NOT_CALL', 'EXISTING_CUSTOMER', 'COMPETITOR', 'SPAM_COMPLAINT', 'SMS_OPT_OUT', 'INTERNAL', 'DISQUALIFIED', 'DELETION_REQUEST');

-- CreateTable
CREATE TABLE "AppStateSnapshot" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppStateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "market" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 0,
    "health" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "executionMode" TEXT NOT NULL DEFAULT 'mock',
    "categories" TEXT[],
    "capabilities" TEXT[],
    "scopes" TEXT[],
    "allowedOperations" TEXT[],
    "credentialLabel" TEXT,
    "secretRef" TEXT,
    "secretStorage" TEXT NOT NULL DEFAULT 'Not configured',
    "secretVersion" INTEGER NOT NULL DEFAULT 0,
    "maskedSecretSuffix" TEXT,
    "rateLimitPerMinute" INTEGER,
    "dailyBudgetCents" INTEGER,
    "waterfallOrder" INTEGER NOT NULL DEFAULT 0,
    "lastTestStatus" TEXT NOT NULL DEFAULT 'Not tested',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestedById" TEXT,
    "lastTestError" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredentialAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "secretVersion" INTEGER NOT NULL DEFAULT 0,
    "redactedMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCredentialAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEncryptedSecret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "secretVersion" INTEGER NOT NULL DEFAULT 0,
    "storage" TEXT NOT NULL DEFAULT 'Encrypted database',
    "algorithm" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "rotatedFromSecretRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEncryptedSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "sourceObjectType" TEXT,
    "sourceObjectId" TEXT,
    "inputSummary" JSONB NOT NULL,
    "resultSummary" JSONB,
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderJobRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerJobId" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT NOT NULL,
    "providerRequestId" TEXT NOT NULL,
    "providerRunId" TEXT,
    "checkpoint" JSONB,
    "requestSummary" JSONB,
    "responseSummary" JSONB,
    "rawResponseRef" TEXT,
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsageLedger" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "jobId" TEXT,
    "providerJobId" TEXT,
    "providerJobRunId" TEXT,
    "unitsUsed" INTEGER NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "totalCostCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountKind" TEXT NOT NULL,
    "rawProviderMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderUsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileName" TEXT NOT NULL,
    "targetMarket" TEXT,
    "targetIndustries" TEXT[],
    "targetGeographies" TEXT[],
    "targetTitles" TEXT[],
    "requiredFields" TEXT[],
    "excludedKeywords" TEXT[],
    "excludedDomains" TEXT[],
    "sourcePreferences" JSONB NOT NULL,
    "scoringProfile" TEXT,
    "segmentRules" JSONB NOT NULL,
    "defaultRouting" JSONB,
    "complianceNotes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "searchProfileId" TEXT,
    "jobName" TEXT NOT NULL,
    "selectedSources" TEXT[],
    "sourceConfigs" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "estimatedRecords" INTEGER NOT NULL DEFAULT 0,
    "rawRecordsCount" INTEGER NOT NULL DEFAULT 0,
    "normalizedRecordsCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateRecordsCount" INTEGER NOT NULL DEFAULT 0,
    "suppressedRecordsCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedEmailCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedPhoneCount" INTEGER NOT NULL DEFAULT 0,
    "enrichedRecordsCount" INTEGER NOT NULL DEFAULT 0,
    "exportedRecordsCount" INTEGER NOT NULL DEFAULT 0,
    "pushedToCrmCount" INTEGER NOT NULL DEFAULT 0,
    "failedRecordsCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "actualCostCents" INTEGER NOT NULL DEFAULT 0,
    "complianceNotes" TEXT,
    "errorSummary" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadJobSource" (
    "id" TEXT NOT NULL,
    "leadJobId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "providerCursor" TEXT,
    "requestMetadata" JSONB,
    "responseMetadata" JSONB,
    "creditUsage" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadJobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawLead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadJobId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "sourceUrl" TEXT,
    "sourceConfidence" INTEGER,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processingError" TEXT,

    CONSTRAINT "RawLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rawLeadId" TEXT NOT NULL,
    "leadJobId" TEXT,
    "companyName" TEXT,
    "normalizedName" TEXT,
    "domain" TEXT,
    "website" TEXT,
    "contactName" TEXT,
    "title" TEXT,
    "seniority" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "linkedinUrl" TEXT,
    "industry" TEXT,
    "technology" TEXT[],
    "grade" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT,
    "status" TEXT,
    "segment" TEXT,
    "owner" TEXT,
    "verification" TEXT,
    "suppressionReason" TEXT,
    "normalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "rootDomain" TEXT,
    "website" TEXT,
    "linkedinUrl" TEXT,
    "googlePlaceId" TEXT,
    "phone" TEXT,
    "industry" TEXT,
    "employeeBand" TEXT,
    "revenueBand" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "sourceLineage" JSONB NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "score" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "seniority" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "sourceLineage" JSONB NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "grade" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT,
    "status" TEXT,
    "segment" TEXT,
    "owner" TEXT,
    "verification" TEXT,
    "enrichmentCoverage" INTEGER,
    "fitReason" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "lawfulBasis" TEXT,
    "consentStatus" TEXT,
    "consentSource" TEXT,
    "consentCapturedAt" TIMESTAMP(3),
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "isSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trustScore" INTEGER NOT NULL,
    "confidence" INTEGER,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "grade" "VerificationGrade" NOT NULL,
    "status" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "provider" TEXT NOT NULL,
    "confidence" INTEGER,
    "fields" JSONB NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "enrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "EnrichmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordSegment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScore" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "score" INTEGER NOT NULL,
    "priority" "PriorityTier" NOT NULL,
    "breakdown" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadJobId" TEXT,
    "name" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "filterSnapshot" JSONB NOT NULL,
    "columns" TEXT[],
    "recordCount" INTEGER NOT NULL,
    "fileUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "SuppressionType" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "domain" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "location" TEXT,
    "ownerUserId" TEXT,
    "source" TEXT,
    "score" INTEGER,
    "priority" "PriorityTier",
    "complianceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'PROSPECTING',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "contactId" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "actorUserId" TEXT,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueAt" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "phone" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SdrTeam" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerUserId" TEXT,
    "memberUserIds" TEXT[],
    "territories" TEXT[],
    "industries" TEXT[],
    "capacityWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SdrTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SdrAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "assignedSdrId" TEXT,
    "assignedTeamId" TEXT,
    "assignedById" TEXT,
    "assignmentMethod" TEXT NOT NULL,
    "assignmentReason" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstTouchDueAt" TIMESTAMP(3),
    "followUpDueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "reassignmentReason" TEXT,
    "previousOwnerId" TEXT,
    "slaStatus" TEXT NOT NULL,
    "firstTouchedAt" TIMESTAMP(3),
    "lastTouchAt" TIMESTAMP(3),
    "touchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SdrAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpReminder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "ownerUserId" TEXT,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),

    CONSTRAINT "FollowUpReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReassignmentRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "assignmentMethod" TEXT NOT NULL,
    "thresholdHours" INTEGER NOT NULL DEFAULT 4,
    "targetTeamId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReassignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachProvider" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sendingDomain" TEXT,
    "mailboxGroup" TEXT,
    "senderEmail" TEXT,
    "fromNumber" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 0,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" INTEGER NOT NULL DEFAULT 0,
    "complaintRate" INTEGER NOT NULL DEFAULT 0,
    "unsubscribeRate" INTEGER NOT NULL DEFAULT 0,
    "warmupStage" TEXT,
    "spf" BOOLEAN NOT NULL DEFAULT false,
    "dkim" BOOLEAN NOT NULL DEFAULT false,
    "dmarc" BOOLEAN NOT NULL DEFAULT false,
    "tls" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachCampaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignType" TEXT NOT NULL,
    "targetSegment" TEXT NOT NULL,
    "sourceJobIds" TEXT[],
    "ownerUserId" TEXT,
    "sendingDomain" TEXT,
    "mailboxGroup" TEXT,
    "status" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "totalLeads" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "unsubscribeCount" INTEGER NOT NULL DEFAULT 0,
    "meetingsBooked" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesCreated" INTEGER NOT NULL DEFAULT 0,
    "revenueWonCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSequence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetSegment" TEXT NOT NULL,
    "defaultDelayRules" TEXT,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnBounce" BOOLEAN NOT NULL DEFAULT true,
    "stopOnUnsubscribe" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT,
    "bodyTemplate" TEXT,
    "callScript" TEXT,
    "smsTemplate" TEXT,
    "manualTaskInstruction" TEXT,
    "personalizationVariables" TEXT[],
    "requiredFields" TEXT[],
    "unsubscribeFooterRequired" BOOLEAN NOT NULL DEFAULT false,
    "physicalAddress" TEXT,
    "complianceStatus" TEXT NOT NULL DEFAULT 'Compliant',
    "complianceNotes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "accountId" TEXT,
    "campaignId" TEXT,
    "sequenceId" TEXT,
    "sequenceStepId" TEXT,
    "messageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodySnapshot" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "unsubscribeAt" TIMESTAMP(3),
    "bounceType" TEXT,
    "smtpCode" TEXT,
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "accountId" TEXT,
    "campaignId" TEXT,
    "sequenceId" TEXT,
    "sequenceStepId" TEXT,
    "sdrUserId" TEXT,
    "provider" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "optOutFlag" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedCall" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "accountId" TEXT,
    "sdrUserId" TEXT,
    "leadContactId" TEXT,
    "companyId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "callStatus" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "recordingConsent" TEXT NOT NULL DEFAULT 'Not recorded',
    "recordingConsentSource" TEXT,
    "recordingConsentCapturedAt" TIMESTAMP(3),
    "recordingUrl" TEXT,
    "recordingStoragePath" TEXT,
    "transcript" TEXT,
    "callSummary" TEXT,
    "nextStep" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legalBasis" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "retentionPolicyId" TEXT NOT NULL,
    "runById" TEXT,
    "dataType" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceChecklistItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "control" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "contactId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "handledById" TEXT,
    "notes" TEXT NOT NULL,
    "evidence" TEXT,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverabilityAlert" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT,
    "trigger" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "recommendation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "DeliverabilityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPersonalization" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campaignId" TEXT,
    "provider" TEXT NOT NULL,
    "firstLine" TEXT NOT NULL,
    "painPointAngle" TEXT NOT NULL,
    "recommendedOffer" TEXT NOT NULL,
    "recommendedChannel" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AiPersonalization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReplyClassification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campaignId" TEXT,
    "emailEventId" TEXT,
    "smsEventId" TEXT,
    "channel" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReplyClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCallSummary" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "trackedCallId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "nextSteps" TEXT[],
    "sentiment" TEXT NOT NULL,
    "objections" TEXT[],
    "topics" TEXT[],
    "confidence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiLeadScorePrediction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "conversionProbability" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "factors" TEXT[],
    "risks" TEXT[],
    "recommendedAction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AiLeadScorePrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiIcpRecommendation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "industries" TEXT[],
    "titles" TEXT[],
    "geographies" TEXT[],
    "technologies" TEXT[],
    "segments" TEXT[],
    "sourceSummary" TEXT NOT NULL,
    "fitSignals" TEXT[],
    "confidence" INTEGER NOT NULL,
    "prompt" TEXT,
    "status" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedSearchProfileId" TEXT,

    CONSTRAINT "AiIcpRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDeliverabilityRecommendation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "triggerMetric" TEXT NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AiDeliverabilityRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRevenueInsight" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimensionValue" TEXT NOT NULL,
    "insight" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "impactAmountCents" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRevenueInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAutomationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "runById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"("workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_workspaceId_provider_key" ON "Integration"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "ProviderConnection_workspaceId_status_idx" ON "ProviderConnection"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ProviderConnection_workspaceId_enabled_idx" ON "ProviderConnection"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_workspaceId_providerId_key" ON "ProviderConnection"("workspaceId", "providerId");

-- CreateIndex
CREATE INDEX "ProviderCredentialAudit_workspaceId_providerId_createdAt_idx" ON "ProviderCredentialAudit"("workspaceId", "providerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderCredentialAudit_workspaceId_providerConnectionId_idx" ON "ProviderCredentialAudit"("workspaceId", "providerConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEncryptedSecret_secretRef_key" ON "ProviderEncryptedSecret"("secretRef");

-- CreateIndex
CREATE INDEX "ProviderEncryptedSecret_workspaceId_providerId_secretVersio_idx" ON "ProviderEncryptedSecret"("workspaceId", "providerId", "secretVersion");

-- CreateIndex
CREATE INDEX "ProviderEncryptedSecret_workspaceId_providerConnectionId_idx" ON "ProviderEncryptedSecret"("workspaceId", "providerConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEncryptedSecret_providerConnectionId_secretVersion_key" ON "ProviderEncryptedSecret"("providerConnectionId", "secretVersion");

-- CreateIndex
CREATE INDEX "ProviderJob_workspaceId_providerId_operation_status_idx" ON "ProviderJob"("workspaceId", "providerId", "operation", "status");

-- CreateIndex
CREATE INDEX "ProviderJob_workspaceId_status_priority_idx" ON "ProviderJob"("workspaceId", "status", "priority");

-- CreateIndex
CREATE INDEX "ProviderJob_workspaceId_sourceObjectType_sourceObjectId_idx" ON "ProviderJob"("workspaceId", "sourceObjectType", "sourceObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderJob_workspaceId_idempotencyKey_key" ON "ProviderJob"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderJobRun_workspaceId_providerId_operation_status_idx" ON "ProviderJobRun"("workspaceId", "providerId", "operation", "status");

-- CreateIndex
CREATE INDEX "ProviderJobRun_workspaceId_providerJobId_idx" ON "ProviderJobRun"("workspaceId", "providerJobId");

-- CreateIndex
CREATE INDEX "ProviderJobRun_workspaceId_status_nextRetryAt_idx" ON "ProviderJobRun"("workspaceId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "ProviderJobRun_workspaceId_status_lockExpiresAt_idx" ON "ProviderJobRun"("workspaceId", "status", "lockExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderJobRun_providerJobId_attempt_key" ON "ProviderJobRun"("providerJobId", "attempt");

-- CreateIndex
CREATE INDEX "ProviderUsageLedger_workspaceId_provider_operation_createdA_idx" ON "ProviderUsageLedger"("workspaceId", "provider", "operation", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderUsageLedger_workspaceId_jobId_idx" ON "ProviderUsageLedger"("workspaceId", "jobId");

-- CreateIndex
CREATE INDEX "ProviderUsageLedger_workspaceId_providerJobId_idx" ON "ProviderUsageLedger"("workspaceId", "providerJobId");

-- CreateIndex
CREATE INDEX "ProviderUsageLedger_workspaceId_providerJobRunId_idx" ON "ProviderUsageLedger"("workspaceId", "providerJobRunId");

-- CreateIndex
CREATE INDEX "SearchProfile_workspaceId_profileName_idx" ON "SearchProfile"("workspaceId", "profileName");

-- CreateIndex
CREATE INDEX "LeadJob_workspaceId_status_idx" ON "LeadJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LeadJob_workspaceId_createdAt_idx" ON "LeadJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadJobSource_leadJobId_source_key" ON "LeadJobSource"("leadJobId", "source");

-- CreateIndex
CREATE INDEX "RawLead_workspaceId_leadJobId_idx" ON "RawLead"("workspaceId", "leadJobId");

-- CreateIndex
CREATE UNIQUE INDEX "RawLead_workspaceId_source_sourceRecordId_key" ON "RawLead"("workspaceId", "source", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedRecord_rawLeadId_key" ON "NormalizedRecord"("rawLeadId");

-- CreateIndex
CREATE INDEX "NormalizedRecord_workspaceId_domain_idx" ON "NormalizedRecord"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "NormalizedRecord_workspaceId_email_idx" ON "NormalizedRecord"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "NormalizedRecord_workspaceId_leadJobId_idx" ON "NormalizedRecord"("workspaceId", "leadJobId");

-- CreateIndex
CREATE INDEX "Company_workspaceId_rootDomain_idx" ON "Company"("workspaceId", "rootDomain");

-- CreateIndex
CREATE INDEX "Company_workspaceId_normalizedName_idx" ON "Company"("workspaceId", "normalizedName");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_email_idx" ON "Contact"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_fullName_idx" ON "Contact"("workspaceId", "fullName");

-- CreateIndex
CREATE INDEX "FieldSource_workspaceId_fieldName_idx" ON "FieldSource"("workspaceId", "fieldName");

-- CreateIndex
CREATE INDEX "VerificationResult_workspaceId_grade_idx" ON "VerificationResult"("workspaceId", "grade");

-- CreateIndex
CREATE INDEX "VerificationResult_workspaceId_expiresAt_idx" ON "VerificationResult"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "EnrichmentResult_workspaceId_provider_idx" ON "EnrichmentResult"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_workspaceId_name_key" ON "Segment"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "RecordSegment_workspaceId_segmentId_idx" ON "RecordSegment"("workspaceId", "segmentId");

-- CreateIndex
CREATE INDEX "LeadScore_workspaceId_priority_idx" ON "LeadScore"("workspaceId", "priority");

-- CreateIndex
CREATE INDEX "Export_workspaceId_createdAt_idx" ON "Export"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SuppressionRecord_workspaceId_email_idx" ON "SuppressionRecord"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "SuppressionRecord_workspaceId_phone_idx" ON "SuppressionRecord"("workspaceId", "phone");

-- CreateIndex
CREATE INDEX "SuppressionRecord_workspaceId_domain_idx" ON "SuppressionRecord"("workspaceId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_key" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_workspaceId_domain_idx" ON "Account"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "Account_workspaceId_ownerUserId_idx" ON "Account"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE INDEX "CrmContact_workspaceId_accountId_idx" ON "CrmContact"("workspaceId", "accountId");

-- CreateIndex
CREATE INDEX "CrmContact_workspaceId_email_idx" ON "CrmContact"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_stage_idx" ON "Opportunity"("workspaceId", "stage");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_ownerUserId_idx" ON "Opportunity"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_contactId_idx" ON "Opportunity"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_accountId_occurredAt_idx" ON "Activity"("workspaceId", "accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_contactId_occurredAt_idx" ON "Activity"("workspaceId", "contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_opportunityId_occurredAt_idx" ON "Activity"("workspaceId", "opportunityId", "occurredAt");

-- CreateIndex
CREATE INDEX "Task_workspaceId_ownerUserId_dueAt_idx" ON "Task"("workspaceId", "ownerUserId", "dueAt");

-- CreateIndex
CREATE INDEX "Task_workspaceId_contactId_idx" ON "Task"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_accountId_idx" ON "Note"("workspaceId", "accountId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_contactId_idx" ON "Note"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "CallLog_workspaceId_accountId_createdAt_idx" ON "CallLog"("workspaceId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_workspaceId_contactId_createdAt_idx" ON "CallLog"("workspaceId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomField_workspaceId_objectType_idx" ON "CustomField"("workspaceId", "objectType");

-- CreateIndex
CREATE INDEX "CustomFieldValue_workspaceId_objectId_idx" ON "CustomFieldValue"("workspaceId", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_customFieldId_objectId_key" ON "CustomFieldValue"("customFieldId", "objectId");

-- CreateIndex
CREATE INDEX "SdrTeam_workspaceId_active_idx" ON "SdrTeam"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "SdrAssignment_workspaceId_assignedSdrId_status_idx" ON "SdrAssignment"("workspaceId", "assignedSdrId", "status");

-- CreateIndex
CREATE INDEX "SdrAssignment_workspaceId_slaStatus_idx" ON "SdrAssignment"("workspaceId", "slaStatus");

-- CreateIndex
CREATE INDEX "SdrAssignment_workspaceId_firstTouchDueAt_idx" ON "SdrAssignment"("workspaceId", "firstTouchDueAt");

-- CreateIndex
CREATE INDEX "SdrAssignment_workspaceId_followUpDueAt_idx" ON "SdrAssignment"("workspaceId", "followUpDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SdrAssignment_workspaceId_contactId_key" ON "SdrAssignment"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "FollowUpReminder_workspaceId_ownerUserId_dueAt_idx" ON "FollowUpReminder"("workspaceId", "ownerUserId", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUpReminder_workspaceId_status_idx" ON "FollowUpReminder"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ReassignmentRule_workspaceId_active_idx" ON "ReassignmentRule"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "OutreachProvider_workspaceId_kind_idx" ON "OutreachProvider"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "OutreachProvider_workspaceId_status_idx" ON "OutreachProvider"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "OutreachCampaign_workspaceId_status_idx" ON "OutreachCampaign"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "OutreachCampaign_workspaceId_targetSegment_idx" ON "OutreachCampaign"("workspaceId", "targetSegment");

-- CreateIndex
CREATE INDEX "CampaignSequence_workspaceId_campaignId_idx" ON "CampaignSequence"("workspaceId", "campaignId");

-- CreateIndex
CREATE INDEX "CampaignSequence_workspaceId_status_idx" ON "CampaignSequence"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SequenceStep_workspaceId_channel_idx" ON "SequenceStep"("workspaceId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_stepNumber_key" ON "SequenceStep"("sequenceId", "stepNumber");

-- CreateIndex
CREATE INDEX "EmailEvent_workspaceId_eventType_idx" ON "EmailEvent"("workspaceId", "eventType");

-- CreateIndex
CREATE INDEX "EmailEvent_workspaceId_campaignId_idx" ON "EmailEvent"("workspaceId", "campaignId");

-- CreateIndex
CREATE INDEX "EmailEvent_workspaceId_contactId_idx" ON "EmailEvent"("workspaceId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_workspaceId_messageId_eventType_key" ON "EmailEvent"("workspaceId", "messageId", "eventType");

-- CreateIndex
CREATE INDEX "SmsEvent_workspaceId_status_idx" ON "SmsEvent"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SmsEvent_workspaceId_campaignId_idx" ON "SmsEvent"("workspaceId", "campaignId");

-- CreateIndex
CREATE INDEX "SmsEvent_workspaceId_contactId_idx" ON "SmsEvent"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "TrackedCall_workspaceId_contactId_createdAt_idx" ON "TrackedCall"("workspaceId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedCall_workspaceId_leadContactId_createdAt_idx" ON "TrackedCall"("workspaceId", "leadContactId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedCall_workspaceId_companyId_createdAt_idx" ON "TrackedCall"("workspaceId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedCall_workspaceId_sdrUserId_createdAt_idx" ON "TrackedCall"("workspaceId", "sdrUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportSnapshot_workspaceId_category_generatedAt_idx" ON "ReportSnapshot"("workspaceId", "category", "generatedAt");

-- CreateIndex
CREATE INDEX "RetentionPolicy_workspaceId_dataType_idx" ON "RetentionPolicy"("workspaceId", "dataType");

-- CreateIndex
CREATE INDEX "RetentionPolicy_workspaceId_active_idx" ON "RetentionPolicy"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "RetentionRun_workspaceId_runAt_idx" ON "RetentionRun"("workspaceId", "runAt");

-- CreateIndex
CREATE INDEX "RetentionRun_workspaceId_retentionPolicyId_idx" ON "RetentionRun"("workspaceId", "retentionPolicyId");

-- CreateIndex
CREATE INDEX "ComplianceChecklistItem_workspaceId_status_idx" ON "ComplianceChecklistItem"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceChecklistItem_workspaceId_category_requirement_key" ON "ComplianceChecklistItem"("workspaceId", "category", "requirement");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_workspaceId_status_idx" ON "DataSubjectRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_workspaceId_requestType_idx" ON "DataSubjectRequest"("workspaceId", "requestType");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_workspaceId_dueAt_idx" ON "DataSubjectRequest"("workspaceId", "dueAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_workspaceId_email_idx" ON "DataSubjectRequest"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "DeliverabilityAlert_workspaceId_status_idx" ON "DeliverabilityAlert"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "DeliverabilityAlert_workspaceId_providerId_idx" ON "DeliverabilityAlert"("workspaceId", "providerId");

-- CreateIndex
CREATE INDEX "AiPersonalization_workspaceId_contactId_idx" ON "AiPersonalization"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "AiPersonalization_workspaceId_status_idx" ON "AiPersonalization"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AiReplyClassification_workspaceId_intent_idx" ON "AiReplyClassification"("workspaceId", "intent");

-- CreateIndex
CREATE INDEX "AiReplyClassification_workspaceId_contactId_idx" ON "AiReplyClassification"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "AiCallSummary_workspaceId_trackedCallId_idx" ON "AiCallSummary"("workspaceId", "trackedCallId");

-- CreateIndex
CREATE INDEX "AiCallSummary_workspaceId_sentiment_idx" ON "AiCallSummary"("workspaceId", "sentiment");

-- CreateIndex
CREATE INDEX "AiLeadScorePrediction_workspaceId_contactId_idx" ON "AiLeadScorePrediction"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "AiLeadScorePrediction_workspaceId_priority_idx" ON "AiLeadScorePrediction"("workspaceId", "priority");

-- CreateIndex
CREATE INDEX "AiIcpRecommendation_workspaceId_status_idx" ON "AiIcpRecommendation"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AiIcpRecommendation_workspaceId_name_idx" ON "AiIcpRecommendation"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "AiDeliverabilityRecommendation_workspaceId_severity_idx" ON "AiDeliverabilityRecommendation"("workspaceId", "severity");

-- CreateIndex
CREATE INDEX "AiDeliverabilityRecommendation_workspaceId_status_idx" ON "AiDeliverabilityRecommendation"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AiRevenueInsight_workspaceId_dimension_idx" ON "AiRevenueInsight"("workspaceId", "dimension");

-- CreateIndex
CREATE INDEX "AiRevenueInsight_workspaceId_status_idx" ON "AiRevenueInsight"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AiAutomationRun_workspaceId_completedAt_idx" ON "AiAutomationRun"("workspaceId", "completedAt");

-- CreateIndex
CREATE INDEX "AiAutomationRun_workspaceId_automationType_idx" ON "AiAutomationRun"("workspaceId", "automationType");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_objectType_objectId_idx" ON "AuditLog"("workspaceId", "objectType", "objectId");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredentialAudit" ADD CONSTRAINT "ProviderCredentialAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredentialAudit" ADD CONSTRAINT "ProviderCredentialAudit_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEncryptedSecret" ADD CONSTRAINT "ProviderEncryptedSecret_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEncryptedSecret" ADD CONSTRAINT "ProviderEncryptedSecret_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJob" ADD CONSTRAINT "ProviderJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJob" ADD CONSTRAINT "ProviderJob_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJobRun" ADD CONSTRAINT "ProviderJobRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJobRun" ADD CONSTRAINT "ProviderJobRun_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJobRun" ADD CONSTRAINT "ProviderJobRun_providerJobId_fkey" FOREIGN KEY ("providerJobId") REFERENCES "ProviderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsageLedger" ADD CONSTRAINT "ProviderUsageLedger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchProfile" ADD CONSTRAINT "SearchProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadJob" ADD CONSTRAINT "LeadJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadJob" ADD CONSTRAINT "LeadJob_searchProfileId_fkey" FOREIGN KEY ("searchProfileId") REFERENCES "SearchProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadJob" ADD CONSTRAINT "LeadJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadJobSource" ADD CONSTRAINT "LeadJobSource_leadJobId_fkey" FOREIGN KEY ("leadJobId") REFERENCES "LeadJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawLead" ADD CONSTRAINT "RawLead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawLead" ADD CONSTRAINT "RawLead_leadJobId_fkey" FOREIGN KEY ("leadJobId") REFERENCES "LeadJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedRecord" ADD CONSTRAINT "NormalizedRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedRecord" ADD CONSTRAINT "NormalizedRecord_rawLeadId_fkey" FOREIGN KEY ("rawLeadId") REFERENCES "RawLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldSource" ADD CONSTRAINT "FieldSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldSource" ADD CONSTRAINT "FieldSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldSource" ADD CONSTRAINT "FieldSource_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationResult" ADD CONSTRAINT "VerificationResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationResult" ADD CONSTRAINT "VerificationResult_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentResult" ADD CONSTRAINT "EnrichmentResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentResult" ADD CONSTRAINT "EnrichmentResult_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSegment" ADD CONSTRAINT "RecordSegment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSegment" ADD CONSTRAINT "RecordSegment_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_leadJobId_fkey" FOREIGN KEY ("leadJobId") REFERENCES "LeadJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionRecord" ADD CONSTRAINT "SuppressionRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrTeam" ADD CONSTRAINT "SdrTeam_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrTeam" ADD CONSTRAINT "SdrTeam_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrAssignment" ADD CONSTRAINT "SdrAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrAssignment" ADD CONSTRAINT "SdrAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrAssignment" ADD CONSTRAINT "SdrAssignment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrAssignment" ADD CONSTRAINT "SdrAssignment_assignedSdrId_fkey" FOREIGN KEY ("assignedSdrId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrAssignment" ADD CONSTRAINT "SdrAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdrAssignment" ADD CONSTRAINT "SdrAssignment_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "SdrTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "SdrAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReassignmentRule" ADD CONSTRAINT "ReassignmentRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReassignmentRule" ADD CONSTRAINT "ReassignmentRule_targetTeamId_fkey" FOREIGN KEY ("targetTeamId") REFERENCES "SdrTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachProvider" ADD CONSTRAINT "OutreachProvider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachCampaign" ADD CONSTRAINT "OutreachCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachCampaign" ADD CONSTRAINT "OutreachCampaign_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSequence" ADD CONSTRAINT "CampaignSequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSequence" ADD CONSTRAINT "CampaignSequence_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSequence" ADD CONSTRAINT "CampaignSequence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CampaignSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CampaignSequence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "SequenceStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsEvent" ADD CONSTRAINT "SmsEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsEvent" ADD CONSTRAINT "SmsEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsEvent" ADD CONSTRAINT "SmsEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsEvent" ADD CONSTRAINT "SmsEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsEvent" ADD CONSTRAINT "SmsEvent_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CampaignSequence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsEvent" ADD CONSTRAINT "SmsEvent_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "SequenceStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsEvent" ADD CONSTRAINT "SmsEvent_sdrUserId_fkey" FOREIGN KEY ("sdrUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedCall" ADD CONSTRAINT "TrackedCall_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedCall" ADD CONSTRAINT "TrackedCall_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedCall" ADD CONSTRAINT "TrackedCall_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedCall" ADD CONSTRAINT "TrackedCall_sdrUserId_fkey" FOREIGN KEY ("sdrUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "RetentionPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceChecklistItem" ADD CONSTRAINT "ComplianceChecklistItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverabilityAlert" ADD CONSTRAINT "DeliverabilityAlert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverabilityAlert" ADD CONSTRAINT "DeliverabilityAlert_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "OutreachProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverabilityAlert" ADD CONSTRAINT "DeliverabilityAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPersonalization" ADD CONSTRAINT "AiPersonalization_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPersonalization" ADD CONSTRAINT "AiPersonalization_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReplyClassification" ADD CONSTRAINT "AiReplyClassification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCallSummary" ADD CONSTRAINT "AiCallSummary_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiLeadScorePrediction" ADD CONSTRAINT "AiLeadScorePrediction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiIcpRecommendation" ADD CONSTRAINT "AiIcpRecommendation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiIcpRecommendation" ADD CONSTRAINT "AiIcpRecommendation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDeliverabilityRecommendation" ADD CONSTRAINT "AiDeliverabilityRecommendation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDeliverabilityRecommendation" ADD CONSTRAINT "AiDeliverabilityRecommendation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "OutreachProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRevenueInsight" ADD CONSTRAINT "AiRevenueInsight_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAutomationRun" ADD CONSTRAINT "AiAutomationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAutomationRun" ADD CONSTRAINT "AiAutomationRun_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Persistence hardening: move remaining production helper domains out of the
-- snapshot-only boundary and into normalized, workspace-scoped tables.

ALTER TABLE "ProviderConnection" ADD COLUMN IF NOT EXISTS "costPerUnitCents" INTEGER;
ALTER TABLE "ProviderConnection" ADD COLUMN IF NOT EXISTS "supportedCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ProviderJobRun" ADD COLUMN IF NOT EXISTS "waterfallTemplateId" TEXT;
ALTER TABLE "ProviderJobRun" ADD COLUMN IF NOT EXISTS "waterfallStepId" TEXT;
ALTER TABLE "ProviderJobRun" ADD COLUMN IF NOT EXISTS "leadTargetType" TEXT;
ALTER TABLE "ProviderJobRun" ADD COLUMN IF NOT EXISTS "leadTargetId" TEXT;

ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "estimatedCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "budgetCapCents" INTEGER;
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "budgetStatus" TEXT;
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "budgetConfirmedAt" TIMESTAMP(3);
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "budgetConfirmedById" TEXT;
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "enrichmentBudgetCents" INTEGER;
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "highValueOnlyEnrichment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "waterfallTemplateId" TEXT;
ALTER TABLE "LeadJob" ADD COLUMN IF NOT EXISTS "waterfallOverride" JSONB;

ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "targetType" TEXT NOT NULL DEFAULT 'contact';
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "targetId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "field" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "value" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "providerId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "capability" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "sourcePlatform" TEXT;
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "validationStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "phoneType" TEXT;
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "costCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "cacheHit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "providerJobRunId" TEXT;
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "enrichmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "lastVerifiedDate" TIMESTAMP(3);
ALTER TABLE "FieldSource" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

ALTER TABLE "Export" ADD COLUMN IF NOT EXISTS "exportRuleId" TEXT;
ALTER TABLE "Export" ADD COLUMN IF NOT EXISTS "blockedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Export" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'Ready';

CREATE TABLE IF NOT EXISTS "ProviderMetricDaily" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "valid" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "mobileCount" INTEGER NOT NULL DEFAULT 0,
    "companyMainCount" INTEGER NOT NULL DEFAULT 0,
    "wrongNumber" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProviderMetricDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AsyncJobRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadJobId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "providerRunId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "checkpoint" JSONB,
    "creditUsage" INTEGER NOT NULL DEFAULT 0,
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AsyncJobRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadJobId" TEXT NOT NULL,
    "runId" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "leadJobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DedupeMatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "primaryId" TEXT NOT NULL,
    "duplicateId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "DedupeMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProviderCacheEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "confidence" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderCacheEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExportRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "allowedGrades" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "allowedStatuses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "minScore" INTEGER NOT NULL DEFAULT 0,
    "includeRoleEmails" BOOLEAN NOT NULL DEFAULT false,
    "includeCatchAll" BOOLEAN NOT NULL DEFAULT false,
    "requirePhone" BOOLEAN NOT NULL DEFAULT false,
    "excludeSuppressed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExportRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "processedRecordId" TEXT,
    "errorMessage" TEXT,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WaterfallTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignType" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT,
    "outreachChannel" TEXT NOT NULL,
    "requiredFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "personas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "allowGenericEmail" BOOLEAN NOT NULL DEFAULT false,
    "maxCostPerLeadCents" INTEGER,
    "maxCostPerCampaignCents" INTEGER,
    "highValueScoreThreshold" INTEGER,
    "steps" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaterfallTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderMetricDaily_workspaceId_providerId_capability_date_key" ON "ProviderMetricDaily"("workspaceId", "providerId", "capability", "date");
CREATE INDEX IF NOT EXISTS "ProviderMetricDaily_workspaceId_providerId_capability_idx" ON "ProviderMetricDaily"("workspaceId", "providerId", "capability");
CREATE INDEX IF NOT EXISTS "ProviderMetricDaily_workspaceId_date_idx" ON "ProviderMetricDaily"("workspaceId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "AsyncJobRun_workspaceId_idempotencyKey_attempt_key" ON "AsyncJobRun"("workspaceId", "idempotencyKey", "attempt");
CREATE INDEX IF NOT EXISTS "AsyncJobRun_workspaceId_leadJobId_status_idx" ON "AsyncJobRun"("workspaceId", "leadJobId", "status");
CREATE INDEX IF NOT EXISTS "AsyncJobRun_workspaceId_status_nextRetryAt_idx" ON "AsyncJobRun"("workspaceId", "status", "nextRetryAt");

CREATE INDEX IF NOT EXISTS "JobLog_workspaceId_leadJobId_createdAt_idx" ON "JobLog"("workspaceId", "leadJobId", "createdAt");
CREATE INDEX IF NOT EXISTS "JobLog_workspaceId_level_createdAt_idx" ON "JobLog"("workspaceId", "level", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "JobIdempotencyRecord_workspaceId_key_key" ON "JobIdempotencyRecord"("workspaceId", "key");
CREATE INDEX IF NOT EXISTS "JobIdempotencyRecord_workspaceId_leadJobId_scope_idx" ON "JobIdempotencyRecord"("workspaceId", "leadJobId", "scope");
CREATE INDEX IF NOT EXISTS "JobIdempotencyRecord_workspaceId_status_idx" ON "JobIdempotencyRecord"("workspaceId", "status");

CREATE INDEX IF NOT EXISTS "DedupeMatch_workspaceId_objectType_status_idx" ON "DedupeMatch"("workspaceId", "objectType", "status");
CREATE INDEX IF NOT EXISTS "DedupeMatch_workspaceId_primaryId_idx" ON "DedupeMatch"("workspaceId", "primaryId");
CREATE INDEX IF NOT EXISTS "DedupeMatch_workspaceId_duplicateId_idx" ON "DedupeMatch"("workspaceId", "duplicateId");

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderCacheEntry_workspaceId_provider_cacheKey_inputHash_key" ON "ProviderCacheEntry"("workspaceId", "provider", "cacheKey", "inputHash");
CREATE INDEX IF NOT EXISTS "ProviderCacheEntry_workspaceId_provider_targetType_idx" ON "ProviderCacheEntry"("workspaceId", "provider", "targetType");
CREATE INDEX IF NOT EXISTS "ProviderCacheEntry_workspaceId_expiresAt_idx" ON "ProviderCacheEntry"("workspaceId", "expiresAt");

CREATE INDEX IF NOT EXISTS "ExportRule_workspaceId_exportType_idx" ON "ExportRule"("workspaceId", "exportType");

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_workspaceId_idempotencyKey_key" ON "WebhookEvent"("workspaceId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "WebhookEvent_workspaceId_provider_eventType_idx" ON "WebhookEvent"("workspaceId", "provider", "eventType");
CREATE INDEX IF NOT EXISTS "WebhookEvent_workspaceId_status_receivedAt_idx" ON "WebhookEvent"("workspaceId", "status", "receivedAt");

CREATE INDEX IF NOT EXISTS "WaterfallTemplate_workspaceId_campaignType_status_idx" ON "WaterfallTemplate"("workspaceId", "campaignType", "status");
CREATE INDEX IF NOT EXISTS "WaterfallTemplate_workspaceId_isDefault_idx" ON "WaterfallTemplate"("workspaceId", "isDefault");

CREATE INDEX IF NOT EXISTS "FieldSource_workspaceId_targetType_targetId_idx" ON "FieldSource"("workspaceId", "targetType", "targetId");
CREATE INDEX IF NOT EXISTS "FieldSource_workspaceId_providerId_capability_idx" ON "FieldSource"("workspaceId", "providerId", "capability");
CREATE INDEX IF NOT EXISTS "FieldSource_workspaceId_expiresAt_idx" ON "FieldSource"("workspaceId", "expiresAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProviderMetricDaily_workspaceId_fkey') THEN
    ALTER TABLE "ProviderMetricDaily" ADD CONSTRAINT "ProviderMetricDaily_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsyncJobRun_workspaceId_fkey') THEN
    ALTER TABLE "AsyncJobRun" ADD CONSTRAINT "AsyncJobRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobLog_workspaceId_fkey') THEN
    ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobIdempotencyRecord_workspaceId_fkey') THEN
    ALTER TABLE "JobIdempotencyRecord" ADD CONSTRAINT "JobIdempotencyRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DedupeMatch_workspaceId_fkey') THEN
    ALTER TABLE "DedupeMatch" ADD CONSTRAINT "DedupeMatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProviderCacheEntry_workspaceId_fkey') THEN
    ALTER TABLE "ProviderCacheEntry" ADD CONSTRAINT "ProviderCacheEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExportRule_workspaceId_fkey') THEN
    ALTER TABLE "ExportRule" ADD CONSTRAINT "ExportRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebhookEvent_workspaceId_fkey') THEN
    ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WaterfallTemplate_workspaceId_fkey') THEN
    ALTER TABLE "WaterfallTemplate" ADD CONSTRAINT "WaterfallTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

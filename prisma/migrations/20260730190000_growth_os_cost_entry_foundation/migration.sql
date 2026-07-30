-- Wave 1 Step 1.4B: additive Growth financial-event foundation.
--
-- ADR-001 Option C is binding: CostEntry owns authoritative financial facts;
-- ProviderUsageLedger remains AppState-projected operational evidence. This
-- migration preserves every existing row, performs no inferred backfill, and
-- leaves all new event columns nullable for pre-foundation compatibility.

CREATE TYPE "FinancialEventKind" AS ENUM (
  'ESTIMATE',
  'AUTHORIZATION',
  'ACTUAL',
  'ADJUSTMENT',
  'REVERSAL'
);

CREATE TYPE "FinancialReconciliationStatus" AS ENUM (
  'NOT_APPLICABLE',
  'PENDING',
  'RECONCILED',
  'DISPUTED'
);

-- Provider and unit were mandatory on the pre-foundation row shape. They are
-- nullable now so non-provider services and non-unit costs are representable
-- without fictional identities. No existing value is changed.
ALTER TABLE "CostEntry"
  ALTER COLUMN "provider" DROP NOT NULL,
  ALTER COLUMN "unit" DROP NOT NULL,
  ADD COLUMN "approvalId" TEXT,
  ADD COLUMN "researchRunId" TEXT,
  ADD COLUMN "providerJobId" TEXT,
  ADD COLUMN "providerJobRunId" TEXT,
  ADD COLUMN "providerUsageLedgerId" TEXT,
  ADD COLUMN "adjustsCostEntryId" TEXT,
  ADD COLUMN "reversesCostEntryId" TEXT,
  ADD COLUMN "service" TEXT,
  ADD COLUMN "costActionKey" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceEventId" TEXT,
  ADD COLUMN "sourceLineId" TEXT,
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "eventKind" "FinancialEventKind",
  ADD COLUMN "occurredAt" TIMESTAMP(3),
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "amountCents" INTEGER,
  ADD COLUMN "reconciliationStatus" "FinancialReconciliationStatus",
  ADD COLUMN "authorizationSource" TEXT,
  ADD COLUMN "authorizationId" TEXT;

-- Command replay and explicit source replay are database authorities. The
-- five-column Prisma unique supports partial actual source lines. PostgreSQL's
-- nullable-unique semantics need the partial index for events with no line.
CREATE UNIQUE INDEX "CostEntry_workspaceId_idempotencyKey_key"
  ON "CostEntry"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "CostEntry_source_identity_key"
  ON "CostEntry"("workspaceId", "sourceSystem", "sourceEventId", "eventKind", "sourceLineId");
CREATE UNIQUE INDEX "CostEntry_source_identity_without_line_key"
  ON "CostEntry"("workspaceId", "sourceSystem", "sourceEventId", "eventKind")
  WHERE "sourceLineId" IS NULL
    AND "sourceSystem" IS NOT NULL
    AND "sourceEventId" IS NOT NULL
    AND "eventKind" IS NOT NULL;
CREATE UNIQUE INDEX "CostEntry_providerUsageLedgerId_key"
  ON "CostEntry"("providerUsageLedgerId");
CREATE UNIQUE INDEX "CostEntry_reversesCostEntryId_key"
  ON "CostEntry"("reversesCostEntryId");
CREATE UNIQUE INDEX "CostEntry_workspaceId_id_key"
  ON "CostEntry"("workspaceId", "id");

CREATE INDEX "CostEntry_workspaceId_occurredAt_id_idx"
  ON "CostEntry"("workspaceId", "occurredAt", "id");
CREATE INDEX "CostEntry_workspaceId_campaignId_occurredAt_id_idx"
  ON "CostEntry"("workspaceId", "campaignId", "occurredAt", "id");
CREATE INDEX "CostEntry_workspaceId_stageRunId_occurredAt_id_idx"
  ON "CostEntry"("workspaceId", "stageRunId", "occurredAt", "id");
CREATE INDEX "CostEntry_workspaceId_costActionKey_occurredAt_idx"
  ON "CostEntry"("workspaceId", "costActionKey", "occurredAt");
CREATE INDEX "CostEntry_workspaceId_sourceSystem_sourceEventId_idx"
  ON "CostEntry"("workspaceId", "sourceSystem", "sourceEventId");
CREATE INDEX "CostEntry_workspaceId_approvalId_idx"
  ON "CostEntry"("workspaceId", "approvalId");
CREATE INDEX "CostEntry_workspaceId_researchRunId_idx"
  ON "CostEntry"("workspaceId", "researchRunId");
CREATE INDEX "CostEntry_workspaceId_providerJobId_idx"
  ON "CostEntry"("workspaceId", "providerJobId");
CREATE INDEX "CostEntry_workspaceId_providerJobRunId_idx"
  ON "CostEntry"("workspaceId", "providerJobRunId");
CREATE INDEX "CostEntry_workspace_evidence_idx"
  ON "CostEntry"("workspaceId", "providerUsageLedgerId");

-- These NOT VALID checks do not scan or rewrite historical rows. PostgreSQL
-- still enforces them for every new or changed row, while the inventory tool
-- determines whether old rows can be validated in a later deployment step.
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_native_identity_check" CHECK (
  "eventKind" IS NULL OR (
    "costActionKey" IS NOT NULL AND btrim("costActionKey") <> '' AND
    "idempotencyKey" IS NOT NULL AND btrim("idempotencyKey") <> '' AND
    "sourceSystem" IS NOT NULL AND btrim("sourceSystem") <> '' AND
    "sourceEventId" IS NOT NULL AND btrim("sourceEventId") <> '' AND
    "contentSha256" IS NOT NULL AND "contentSha256" ~ '^[0-9a-f]{64}$' AND
    "occurredAt" IS NOT NULL AND
    "currency" IS NOT NULL AND "currency" ~ '^[A-Z]{3}$' AND
    "amountCents" IS NOT NULL AND
    "reconciliationStatus" IS NOT NULL AND
    num_nonnulls(NULLIF(btrim("provider"), ''), NULLIF(btrim("service"), '')) = 1
  )
) NOT VALID;

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_event_amount_check" CHECK (
  "eventKind" IS NULL OR
  ("eventKind" IN ('ESTIMATE', 'AUTHORIZATION', 'ACTUAL', 'REVERSAL') AND "amountCents" >= 0) OR
  ("eventKind" = 'ADJUSTMENT' AND "amountCents" <> 0)
) NOT VALID;

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_units_check" CHECK (
  "eventKind" IS NULL OR ("units" >= 0 AND "unitCostCents" >= 0)
) NOT VALID;

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_event_links_check" CHECK (
  "eventKind" IS NULL OR (
    ("stageRunId" IS NULL OR "campaignId" IS NOT NULL) AND
    ("providerJobRunId" IS NULL OR "providerJobId" IS NOT NULL) AND
    ("providerUsageLedgerId" IS NULL OR "eventKind" = 'ACTUAL') AND
    ("eventKind" <> 'ADJUSTMENT' OR "adjustsCostEntryId" IS NOT NULL) AND
    ("eventKind" <> 'REVERSAL' OR "reversesCostEntryId" IS NOT NULL) AND
    ("eventKind" <> 'AUTHORIZATION' OR
      ("authorizationSource" IS NOT NULL AND btrim("authorizationSource") <> '' AND
       "authorizationId" IS NOT NULL AND btrim("authorizationId") <> ''))
  )
) NOT VALID;

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_safe_metadata_size_check" CHECK (
  "eventKind" IS NULL OR octet_length("metadata"::text) <= 65536
) NOT VALID;

-- Ordinary relation FKs are represented in Prisma. All new relation columns
-- are null on historical rows, so these do not require a backfill.
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_approvalId_fkey"
  FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_researchRunId_fkey"
  FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_adjustsCostEntryId_fkey"
  FOREIGN KEY ("adjustsCostEntryId") REFERENCES "CostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_reversesCostEntryId_fkey"
  FOREIGN KEY ("reversesCostEntryId") REFERENCES "CostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite candidate keys support tenant-consistency FKs. They do not alter
-- related table ownership or data. NOT VALID FKs enforce all future writes but
-- deliberately make no claim about un-inventoried historical attribution.
CREATE UNIQUE INDEX "Campaign_workspaceId_id_key" ON "Campaign"("workspaceId", "id");
CREATE UNIQUE INDEX "CampaignStageRun_workspaceId_id_key" ON "CampaignStageRun"("workspaceId", "id");
CREATE UNIQUE INDEX "CampaignStageRun_workspaceId_campaignId_id_key"
  ON "CampaignStageRun"("workspaceId", "campaignId", "id");
CREATE UNIQUE INDEX "Approval_workspaceId_id_key" ON "Approval"("workspaceId", "id");
CREATE UNIQUE INDEX "ResearchRun_workspaceId_id_key" ON "ResearchRun"("workspaceId", "id");

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_campaign_tenant_fkey"
  FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "Campaign"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_stage_campaign_tenant_fkey"
  FOREIGN KEY ("workspaceId", "campaignId", "stageRunId")
  REFERENCES "CampaignStageRun"("workspaceId", "campaignId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_approval_tenant_fkey"
  FOREIGN KEY ("workspaceId", "approvalId") REFERENCES "Approval"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_research_run_tenant_fkey"
  FOREIGN KEY ("workspaceId", "researchRunId") REFERENCES "ResearchRun"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_adjustment_tenant_fkey"
  FOREIGN KEY ("workspaceId", "adjustsCostEntryId") REFERENCES "CostEntry"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_reversal_tenant_fkey"
  FOREIGN KEY ("workspaceId", "reversesCostEntryId") REFERENCES "CostEntry"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
COMMENT ON TABLE "CostEntry" IS
  'ADR-001 authoritative append-only Growth financial-control events; nullable event fields identify historical pre-foundation rows.';
COMMENT ON COLUMN "CostEntry"."providerUsageLedgerId" IS
  'Stable optional identity of AppState-projected operational evidence. No FK by design: projection cleanup must not mutate or block immutable financial facts.';

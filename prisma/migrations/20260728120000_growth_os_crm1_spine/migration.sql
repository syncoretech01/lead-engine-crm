-- CreateEnum
CREATE TYPE "NicheRequestSourceChannel" AS ENUM ('telegram', 'slack', 'dashboard');

-- CreateEnum
CREATE TYPE "NicheRequestStatus" AS ENUM ('draft', 'confirmed', 'researching', 'briefed', 'cancelled');

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "NicheBriefStatus" AS ENUM ('pending_approval', 'approved', 'edited', 'declined', 'superseded');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('NICHE_TEST', 'PROVIDER_RUN', 'ENRICHMENT_RUN', 'PAID_VERIFICATION', 'PERSONALIZATION_SAMPLES', 'CAMPAIGN_LAUNCH', 'SPEND_EXCEPTION', 'SCALE', 'REPLY_EXCEPTION', 'SUPPRESS_BULK', 'RESUME_AFTER_BREAKER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'declined', 'superseded');

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('RESEARCH', 'HUB_SEARCH', 'ACQUISITION', 'NORMALIZATION', 'DEDUPLICATION', 'ENRICHMENT', 'FREE_VERIFICATION', 'PAID_VERIFICATION', 'GOLDEN_SYNC', 'SCAN', 'TIERING', 'PERSONALIZATION', 'COLD_OUTREACH', 'INTENT_ROUTING', 'FULL_AUDIT', 'WARM_OUTREACH', 'SDR_EXECUTION', 'REPORTING');

-- CreateEnum
CREATE TYPE "StageRunStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "approvalThresholdT1Cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "approvalThresholdT2Cents" INTEGER;

-- CreateTable
CREATE TABLE "NicheRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "sourceChannel" "NicheRequestSourceChannel" NOT NULL,
    "sourceMessageId" TEXT,
    "voiceAssetRef" TEXT,
    "transcript" TEXT,
    "structuredPayload" JSONB NOT NULL,
    "status" "NicheRequestStatus" NOT NULL DEFAULT 'draft',
    "researchRunId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NicheRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nicheRequestId" TEXT NOT NULL,
    "campaignDraftId" TEXT,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'queued',
    "consoleAgentId" TEXT,
    "progress" DOUBLE PRECISION,
    "nicheBriefId" TEXT,
    "reportAssetRef" JSONB,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "failureCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "callbackSecretRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NicheBrief" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nicheRequestId" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "status" "NicheBriefStatus" NOT NULL DEFAULT 'pending_approval',
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NicheBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nicheBriefId" TEXT NOT NULL,
    "hubSegmentId" TEXT,
    "eligibilityPolicyId" TEXT,
    "budgetCapCents" INTEGER NOT NULL,
    "spendWarnThresholdPct" INTEGER NOT NULL DEFAULT 80,
    "overrunTolerancePct" INTEGER NOT NULL DEFAULT 20,
    "killRuleConfig" JSONB NOT NULL DEFAULT '{}',
    "automationLevel" TEXT NOT NULL DEFAULT 'B',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStageRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stageType" "StageType" NOT NULL,
    "status" "StageRunStatus" NOT NULL DEFAULT 'PENDING',
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "approvedCostCents" INTEGER NOT NULL DEFAULT 0,
    "actualCostCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedRecords" INTEGER NOT NULL DEFAULT 0,
    "inputRecords" INTEGER NOT NULL DEFAULT 0,
    "outputRecords" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerJobId" TEXT,
    "approvalId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "reportPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignStageRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "stageRunId" TEXT,
    "type" "ApprovalType" NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "firstApprovedBy" TEXT,
    "firstApprovedAt" TIMESTAMP(3),
    "supersedesApprovalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "stageRunId" TEXT,
    "provider" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NicheRequest_workspaceId_status_createdAt_idx" ON "NicheRequest"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "NicheRequest_workspaceId_createdAt_idx" ON "NicheRequest"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_workspaceId_status_createdAt_idx" ON "ResearchRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_workspaceId_nicheRequestId_idx" ON "ResearchRun"("workspaceId", "nicheRequestId");

-- CreateIndex
CREATE INDEX "ResearchRun_status_createdAt_idx" ON "ResearchRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NicheBrief_workspaceId_status_createdAt_idx" ON "NicheBrief"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "NicheBrief_workspaceId_nicheRequestId_idx" ON "NicheBrief"("workspaceId", "nicheRequestId");

-- CreateIndex
CREATE INDEX "NicheBrief_workspaceId_researchRunId_idx" ON "NicheBrief"("workspaceId", "researchRunId");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_createdAt_idx" ON "Campaign"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_nicheBriefId_idx" ON "Campaign"("workspaceId", "nicheBriefId");

-- CreateIndex
CREATE INDEX "CampaignStageRun_workspaceId_campaignId_createdAt_idx" ON "CampaignStageRun"("workspaceId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignStageRun_workspaceId_status_createdAt_idx" ON "CampaignStageRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignStageRun_workspaceId_stageType_status_idx" ON "CampaignStageRun"("workspaceId", "stageType", "status");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_status_createdAt_idx" ON "Approval"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_campaignId_createdAt_idx" ON "Approval"("workspaceId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_stageRunId_idx" ON "Approval"("workspaceId", "stageRunId");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_type_status_idx" ON "Approval"("workspaceId", "type", "status");

-- CreateIndex
CREATE INDEX "Approval_supersedesApprovalId_idx" ON "Approval"("supersedesApprovalId");

-- CreateIndex
CREATE INDEX "CostEntry_workspaceId_campaignId_createdAt_idx" ON "CostEntry"("workspaceId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "CostEntry_workspaceId_stageRunId_idx" ON "CostEntry"("workspaceId", "stageRunId");

-- CreateIndex
CREATE INDEX "CostEntry_workspaceId_provider_action_createdAt_idx" ON "CostEntry"("workspaceId", "provider", "action", "createdAt");

-- AddForeignKey
ALTER TABLE "NicheRequest" ADD CONSTRAINT "NicheRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_nicheRequestId_fkey" FOREIGN KEY ("nicheRequestId") REFERENCES "NicheRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheBrief" ADD CONSTRAINT "NicheBrief_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheBrief" ADD CONSTRAINT "NicheBrief_nicheRequestId_fkey" FOREIGN KEY ("nicheRequestId") REFERENCES "NicheRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheBrief" ADD CONSTRAINT "NicheBrief_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_nicheBriefId_fkey" FOREIGN KEY ("nicheBriefId") REFERENCES "NicheBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStageRun" ADD CONSTRAINT "CampaignStageRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStageRun" ADD CONSTRAINT "CampaignStageRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_stageRunId_fkey" FOREIGN KEY ("stageRunId") REFERENCES "CampaignStageRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_supersedesApprovalId_fkey" FOREIGN KEY ("supersedesApprovalId") REFERENCES "Approval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_stageRunId_fkey" FOREIGN KEY ("stageRunId") REFERENCES "CampaignStageRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;


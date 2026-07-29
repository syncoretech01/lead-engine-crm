-- Wave 1, Step 1.3: durable idempotency and audit metadata for applying a
-- final NICHE_TEST approval. All columns are nullable for rolling compatibility
-- with the previous application and with existing manual campaign rows.

ALTER TABLE "Approval"
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "sideEffectsAppliedAt" TIMESTAMP(3);

ALTER TABLE "Campaign"
ADD COLUMN "originApprovalId" TEXT;

ALTER TABLE "CampaignStageRun"
ADD COLUMN "orchestrationKey" TEXT;

-- One brief has one current approval in its immutable revision chain; one final
-- NICHE_TEST approval can originate only one campaign; orchestration replay can
-- create each initial stage row only once.
CREATE UNIQUE INDEX "NicheBrief_approvalId_key" ON "NicheBrief"("approvalId");
CREATE UNIQUE INDEX "Campaign_originApprovalId_key" ON "Campaign"("originApprovalId");
CREATE UNIQUE INDEX "CampaignStageRun_orchestrationKey_key" ON "CampaignStageRun"("orchestrationKey");

CREATE INDEX "Approval_workspaceId_status_expiresAt_idx"
ON "Approval"("workspaceId", "status", "expiresAt");

ALTER TABLE "NicheBrief"
ADD CONSTRAINT "NicheBrief_approvalId_fkey"
FOREIGN KEY ("approvalId") REFERENCES "Approval"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Campaign"
ADD CONSTRAINT "Campaign_originApprovalId_fkey"
FOREIGN KEY ("originApprovalId") REFERENCES "Approval"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Wave 1 Step 1.3A: durable creation/revision identities and one canonical
-- approval chain per researched brief. All new columns are nullable so the
-- application can roll out before legacy rows are backfilled.
ALTER TABLE "Approval"
  ADD COLUMN "creationKey" TEXT,
  ADD COLUMN "revisionReason" TEXT;

-- A retry may return the same approval, but may never create a second one for
-- the same business request or a second successor for one immutable approval.
CREATE UNIQUE INDEX "Approval_creationKey_key" ON "Approval"("creationKey");
CREATE UNIQUE INDEX "Approval_supersedesApprovalId_key" ON "Approval"("supersedesApprovalId");
DROP INDEX "Approval_supersedesApprovalId_idx";

-- A completed ResearchRun produces one canonical NicheBrief. This is the
-- database authority beneath create-request replay and concurrent workers.
CREATE UNIQUE INDEX "NicheBrief_researchRunId_key" ON "NicheBrief"("researchRunId");

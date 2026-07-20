ALTER TABLE "SdrAssignment"
  ADD COLUMN "firstCallCompletedAt" TIMESTAMP(3),
  ADD COLUMN "secondCallCompletedAt" TIMESTAMP(3),
  ADD COLUMN "callCycleCompletedAt" TIMESTAMP(3);

CREATE INDEX "SdrAssignment_workspaceId_assignedSdrId_callCycleCompletedAt_idx"
  ON "SdrAssignment"("workspaceId", "assignedSdrId", "callCycleCompletedAt");

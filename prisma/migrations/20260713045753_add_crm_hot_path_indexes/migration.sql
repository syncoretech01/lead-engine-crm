-- CreateIndex
CREATE INDEX "Activity_workspaceId_occurredAt_idx" ON "Activity"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_score_idx" ON "Contact"("workspaceId", "score");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_owner_idx" ON "Contact"("workspaceId", "owner");

-- CreateIndex
CREATE INDEX "TrackedCall_workspaceId_createdAt_idx" ON "TrackedCall"("workspaceId", "createdAt");

-- CreateTable
CREATE TABLE "NotifyOutbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "envelopeJson" JSONB NOT NULL,
    "eventId" TEXT NOT NULL,
    "approvalId" TEXT,
    "campaignId" TEXT,
    "stageRunId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotifyOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotifyOutbox_workspaceId_deliveredAt_nextAttemptAt_idx" ON "NotifyOutbox"("workspaceId", "deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotifyOutbox_deliveredAt_nextAttemptAt_idx" ON "NotifyOutbox"("deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotifyOutbox_eventId_key" ON "NotifyOutbox"("eventId");

-- AddForeignKey
ALTER TABLE "NotifyOutbox" ADD CONSTRAINT "NotifyOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


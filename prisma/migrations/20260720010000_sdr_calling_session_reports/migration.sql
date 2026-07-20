CREATE TABLE "SdrCallingSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sdrUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "activeDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "connectedCalls" INTEGER NOT NULL DEFAULT 0,
    "voicemailCalls" INTEGER NOT NULL DEFAULT 0,
    "unansweredCalls" INTEGER NOT NULL DEFAULT 0,
    "suppressedContacts" INTEGER NOT NULL DEFAULT 0,
    "followUpContacts" INTEGER NOT NULL DEFAULT 0,
    "totalTalkTimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "completedContactIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SdrCallingSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SdrCallingSession_workspaceId_sdrUserId_startedAt_idx"
ON "SdrCallingSession"("workspaceId", "sdrUserId", "startedAt");

CREATE INDEX "SdrCallingSession_workspaceId_status_startedAt_idx"
ON "SdrCallingSession"("workspaceId", "status", "startedAt");

ALTER TABLE "SdrCallingSession"
ADD CONSTRAINT "SdrCallingSession_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SdrCallingSession"
ADD CONSTRAINT "SdrCallingSession_sdrUserId_fkey"
FOREIGN KEY ("sdrUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

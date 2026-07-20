CREATE TABLE "SdrDailyReport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sdrUserId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "cutoffHour" INTEGER NOT NULL DEFAULT 4,
    "metrics" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SdrDailyReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SdrDailyReport_workspaceId_sdrUserId_reportDate_key"
ON "SdrDailyReport"("workspaceId", "sdrUserId", "reportDate");

CREATE INDEX "SdrDailyReport_workspaceId_reportDate_idx"
ON "SdrDailyReport"("workspaceId", "reportDate");

CREATE INDEX "SdrDailyReport_workspaceId_sdrUserId_periodEnd_idx"
ON "SdrDailyReport"("workspaceId", "sdrUserId", "periodEnd");

ALTER TABLE "SdrDailyReport"
ADD CONSTRAINT "SdrDailyReport_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SdrDailyReport"
ADD CONSTRAINT "SdrDailyReport_sdrUserId_fkey"
FOREIGN KEY ("sdrUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

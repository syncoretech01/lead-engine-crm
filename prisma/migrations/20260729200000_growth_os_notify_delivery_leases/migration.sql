-- Additive delivery-state expansion for Growth OS Wave 1, Step 1.2.
ALTER TABLE "NotifyOutbox"
ADD COLUMN "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN "claimedBy" TEXT,
ADD COLUMN "claimToken" TEXT,
ADD COLUMN "claimExpiresAt" TIMESTAMP(3);

-- Rows already exhausted under the pre-migration hard-coded limit are terminal,
-- not silently pending forever. The production default remains eight attempts.
UPDATE "NotifyOutbox"
SET "deadLetteredAt" = "updatedAt",
    "nextAttemptAt" = NULL
WHERE "deliveredAt" IS NULL
  AND "attempts" >= 8;

CREATE INDEX "NotifyOutbox_deliveredAt_deadLetteredAt_nextAttemptAt_claimExpiresAt_idx"
ON "NotifyOutbox"("deliveredAt", "deadLetteredAt", "nextAttemptAt", "claimExpiresAt");

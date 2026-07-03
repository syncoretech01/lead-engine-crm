-- Per-user RingCentral line: each SDR dials from their own number/extension
-- (replaces the single hardcoded env identity). Nullable so a user without a
-- provisioned line simply can't place calls until an admin sets one.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ringCentralPhoneNumber" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ringCentralExtensionId" TEXT;

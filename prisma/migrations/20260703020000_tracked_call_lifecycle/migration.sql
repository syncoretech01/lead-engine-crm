-- Click-to-call lifecycle: correlate a placed RingOut with its completion event
-- and (Milestone C) its recording. recordingId + provider/session ids let the
-- webhook/worker match and enrich the call; liveState drives the dialer UI.
ALTER TABLE "TrackedCall" ADD COLUMN IF NOT EXISTS "recordingId" TEXT;
ALTER TABLE "TrackedCall" ADD COLUMN IF NOT EXISTS "providerCallId" TEXT;
ALTER TABLE "TrackedCall" ADD COLUMN IF NOT EXISTS "telephonySessionId" TEXT;
ALTER TABLE "TrackedCall" ADD COLUMN IF NOT EXISTS "liveState" TEXT;

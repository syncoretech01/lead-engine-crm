-- Per-SDR RingCentral calling: each SDR's own JWT (encrypted) so calls are placed
-- AS them (their number allowed as caller ID), plus the caller-id number shown to
-- the lead. Both nullable; when absent the app falls back to the shared admin JWT.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ringCentralCallerId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ringCentralJwt" TEXT;

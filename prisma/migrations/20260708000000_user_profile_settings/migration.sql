-- SDR self-service profile settings: per-user email signature + timezone, and a
-- dedicated table for profile-picture bytes (kept out of the AppState blob and
-- the normalized projection; served via GET /api/profile/avatar/[userId]).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailSignature" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "timezone" TEXT;

CREATE TABLE IF NOT EXISTS "UserAvatar" (
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAvatar_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserAvatar" ADD CONSTRAINT "UserAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

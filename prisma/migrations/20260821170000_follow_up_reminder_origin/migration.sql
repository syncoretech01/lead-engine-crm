-- Records who put a follow-up on the calendar so the Follow-ups directory can show
-- SDR-committed work only, and not the reminders the platform invents on its own
-- (first-touch SLA, bulk assign, and touches where the SDR left the date blank and
-- defaultFollowUpDueAt chose one).
--
-- Deliberately NULLable with NO backfill. Nothing in the existing rows records
-- whether an SDR chose the due date or the system defaulted it, so every historical
-- row stays unattributed rather than being guessed into a bucket. Additive and
-- expand-safe: the currently-live bundle neither reads nor writes this column.
ALTER TABLE "FollowUpReminder" ADD COLUMN "origin" TEXT;

CREATE INDEX "FollowUpReminder_workspaceId_origin_status_idx"
  ON "FollowUpReminder"("workspaceId", "origin", "status");

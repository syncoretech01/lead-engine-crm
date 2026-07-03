-- Assigned-contacts directory (/crm/my-contacts): index SdrAssignment by
-- (workspaceId, assignedSdrId, assignedAt) so the per-SDR view can order
-- newest-assigned first without a full scan. Index name matches Prisma's
-- default for @@index([workspaceId, assignedSdrId, assignedAt]).
CREATE INDEX IF NOT EXISTS "SdrAssignment_workspaceId_assignedSdrId_assignedAt_idx"
  ON "SdrAssignment" ("workspaceId", "assignedSdrId", "assignedAt");

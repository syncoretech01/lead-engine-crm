import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { readState, writeState } from "@/lib/phase1/store";
import { backfillFollowUpOrigins } from "@/lib/phase1/follow-up-origin-backfill";

/**
 * Recovers `FollowUpReminder.origin` for rows created before the field existed,
 * from the call wrap-up audit receipts that already recorded whether the SDR set
 * a follow-up date. See lib/phase1/follow-up-origin-backfill.ts for the rules.
 *
 * Writes through the SNAPSHOT (readState/writeState), never straight to the
 * table. FollowUpReminder is blob-projected, so a raw SQL UPDATE would be
 * reverted the next time the projection syncs the blob over the top of it.
 * `writeState` also avoids updateState's 30s transaction cap on a bulk pass.
 *
 * DRY RUN by default — prints the exact verdict counts and writes nothing.
 *
 *   BACKFILL_APPLY=1   actually write
 */
async function main() {
  if (resolveStorageDriver() !== "prisma") {
    throw new Error("backfill-follow-up-origin requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.");
  }
  const apply = process.env.BACKFILL_APPLY === "1";

  const state = await readState();
  const before = countByOrigin(state.followUpReminders);
  console.log(`reminders: ${state.followUpReminders.length}`);
  console.log(`audit logs: ${state.auditLogs.length}`);
  console.log(`before: ${JSON.stringify(before)}`);

  const summary = backfillFollowUpOrigins(state.followUpReminders, state.auditLogs);
  const after = countByOrigin(state.followUpReminders);

  console.log("verdicts:");
  for (const [reason, count] of Object.entries(summary)) {
    if (reason === "scanned" || reason === "updated") continue;
    console.log(`  ${reason}: ${count}`);
  }
  console.log(`scanned: ${summary.scanned}, would update: ${summary.updated}`);
  console.log(`after: ${JSON.stringify(after)}`);

  const openSdr = state.followUpReminders.filter(
    (reminder) => reminder.origin === "sdr" && reminder.status !== "Completed"
  ).length;
  console.log(`open SDR-scheduled follow-ups after backfill: ${openSdr}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with BACKFILL_APPLY=1 to apply.");
    return;
  }

  await writeState(state);
  console.log("\nApplied.");
}

function countByOrigin(reminders: Array<{ origin?: string }>) {
  const counts: Record<string, number> = { sdr: 0, system: 0, unknown: 0 };
  for (const reminder of reminders) {
    counts[reminder.origin ?? "unknown"] = (counts[reminder.origin ?? "unknown"] ?? 0) + 1;
  }
  return counts;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

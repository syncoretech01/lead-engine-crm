import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { readState, writeState } from "@/lib/phase1/store";
import { resetSdrAssignmentToFresh } from "@/lib/phase1/sdr";

/**
 * Test-data cleanup: reset the leads assigned to specific SDRs back to a
 * freshly-assigned state — KEEP the contacts + their assignment/owner, but delete
 * every engagement record (activities, calls, notes, tasks, follow-ups,
 * opportunities, email/SMS events) tied to those contacts and restart the
 * first-touch/SLA clock. See resetSdrAssignmentToFresh.
 *
 * DRY RUN by default (prints exact counts, writes nothing). Set RESET_APPLY=1 to
 * actually write. Requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.
 *
 *   RESET_WORKSPACE_ID    default workspace-acme-outbound (live team)
 *   RESET_SDR_PATTERN     case-insensitive name regex, default "zack|zainab"
 *   RESET_APPLY=1         apply (otherwise dry run)
 *   RESET_RECORDS_ONLY=1  only delete leftover work records (incl. trackedCalls);
 *                         leave the already-fresh assignments + reminders alone.
 */
async function main() {
  if (resolveStorageDriver() !== "prisma") {
    throw new Error("reset-sdr-leads requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.");
  }
  const workspaceId = process.env.RESET_WORKSPACE_ID ?? "workspace-acme-outbound";
  const pattern = new RegExp(process.env.RESET_SDR_PATTERN ?? "zack|zainab", "i");
  const apply = process.env.RESET_APPLY === "1";

  const { prisma } = await import("@/lib/prisma");
  try {
    const state = await readState();

    const sdrs = state.workspaceMembers
      .filter((member) => member.workspaceId === workspaceId)
      .map((member) => state.users.find((user) => user.id === member.userId))
      .filter((user): user is NonNullable<typeof user> => user !== undefined && pattern.test(user.name));
    const sdrIds = new Set(sdrs.map((user) => user.id));
    console.log(`workspace: ${workspaceId}`);
    console.log(`SDRs matched: ${sdrs.map((u) => `${u.name} (${u.id})`).join(", ") || "(none)"}`);
    if (sdrIds.size === 0) {
      throw new Error("No SDRs matched the name pattern — aborting.");
    }

    const assignments = state.sdrAssignments.filter(
      (a) => a.workspaceId === workspaceId && sdrIds.has(a.assignedSdrId)
    );
    const contactIds = new Set(assignments.map((a) => a.contactId));
    const perSdr: Record<string, number> = {};
    for (const a of assignments) perSdr[a.assignedSdrId] = (perSdr[a.assignedSdrId] ?? 0) + 1;
    console.log(`assignments: ${assignments.length}, unique contacts: ${contactIds.size}`);
    for (const [id, n] of Object.entries(perSdr)) {
      console.log(`  ${state.users.find((u) => u.id === id)?.name ?? id}: ${n}`);
    }

    const hit = (contactId?: string) => Boolean(contactId && contactIds.has(contactId));
    const count = (rows: Array<{ contactId?: string }>) => rows.filter((r) => hit(r.contactId)).length;
    // Tracked calls (the softphone/RingOut call log) are keyed by BOTH the called
    // contact and the SDR who placed them — clear either so the SDR's call log empties.
    const hitCall = (c: { contactId?: string; sdrUserId?: string }) =>
      hit(c.contactId) || Boolean(c.sdrUserId && sdrIds.has(c.sdrUserId));
    console.log("engagement records to DELETE:");
    console.log(`  activities:          ${count(state.activities)}`);
    console.log(`  callLogs:            ${count(state.callLogs)}`);
    console.log(`  trackedCalls:        ${state.trackedCalls.filter(hitCall).length}  (call log; by contact or SDR)`);
    console.log(`  notes:               ${count(state.notes)}`);
    console.log(`  tasks:               ${count(state.tasks)}`);
    console.log(`  followUpReminders:   ${count(state.followUpReminders)}`);
    console.log(`  opportunities:       ${count(state.opportunities)}`);
    console.log(`  emailEvents:         ${count(state.emailEvents)}`);
    console.log(`  smsEvents:           ${count(state.smsEvents)}`);
    console.log(`  aiPersonalizations:  ${count(state.aiPersonalizations)}`);
    console.log(`  aiReplyClassif.:     ${count(state.aiReplyClassifications)}`);
    console.log(`  directSendClaims:    ${count(state.directSendClaims)}`);

    const statusCounts: Record<string, number> = {};
    for (const id of contactIds) {
      const c = state.contacts.find((x) => x.id === id);
      if (c) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
    }
    console.log(`current contact statuses: ${JSON.stringify(statusCounts)}`);

    if (!apply) {
      console.log("\nDRY RUN — nothing written. Re-run with RESET_APPLY=1 to apply.");
      return;
    }

    const now = new Date().toISOString();
    const recordsOnly = process.env.RESET_RECORDS_ONLY === "1";
    const keep = <T extends { contactId?: string }>(rows: T[]) => rows.filter((r) => !hit(r.contactId));
    // Work records — never affect the fresh assignment/reminders, always cleared.
    state.activities = keep(state.activities);
    state.callLogs = keep(state.callLogs);
    state.trackedCalls = state.trackedCalls.filter((c) => !hitCall(c));
    state.notes = keep(state.notes);
    state.tasks = keep(state.tasks);
    state.opportunities = keep(state.opportunities);
    state.emailEvents = keep(state.emailEvents);
    state.smsEvents = keep(state.smsEvents);
    state.aiPersonalizations = keep(state.aiPersonalizations);
    state.aiReplyClassifications = keep(state.aiReplyClassifications);
    state.directSendClaims = keep(state.directSendClaims);

    if (recordsOnly) {
      // Leave the already-fresh assignments + first-touch reminders untouched;
      // just clear the leftover work records above.
      console.log(`\nAPPLY (records only): cleared engagement records; assignments + reminders left as-is.`);
    } else {
      state.followUpReminders = keep(state.followUpReminders);
      let reset = 0;
      for (const id of contactIds) {
        if (resetSdrAssignmentToFresh(state, workspaceId, id, now)) reset++;
      }
      console.log(`\nAPPLY: reset ${reset} assignments to fresh; deleted engagement records above.`);
    }
    await writeState(state);
    console.log("writeState complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("reset-sdr-leads failed:", error);
  process.exit(1);
});

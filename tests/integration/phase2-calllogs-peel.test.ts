import { afterAll, describe, expect, it } from "vitest";

/**
 * Blob-migration Phase 2: callLogs peeled to native prisma.callLog.
 *
 * callLogs is no longer blob-projected. The write path collects into state.callLogs
 * as before, but writeStateToPrisma flushes them into prisma.callLog (FK-safe map,
 * after the projection) and clears the array so the snapshot JSON stays small; reads
 * reset the array so pre-peel history is never re-surfaced or re-flushed.
 *
 * Driven via writeState (the full-state path) so no auth session/cookie is needed;
 * the flush lives in the shared writeStateToPrisma both write paths funnel through.
 *
 * Only runs when SYNCORE_RUN_DB_INTEGRATION=1 (CI integration job / docker-compose.dev.yml).
 */
const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";
const SNAPSHOT_ID = "syncore-primary-state";

describe.skipIf(!enabled)("Phase 2: callLogs peel", () => {
  process.env.SYNCORE_STORAGE_DRIVER = "prisma";

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  it("flushes callLogs to prisma.callLog, keeps the blob array empty, no re-seed on read", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { writeState, readState } = await import("@/lib/phase1/store");
    const { createSeedState } = await import("@/lib/phase1/seed");

    const state = createSeedState();
    const contact = state.contacts.find((c) => c.companyId);
    expect(contact).toBeTruthy();
    const userId = state.users[0].id;

    const callId = "call-test-phase2";
    state.callLogs.unshift({
      id: callId,
      workspaceId: contact!.workspaceId,
      companyId: contact!.companyId,
      contactId: contact!.id,
      phone: "+15551112222",
      outcome: "Connected",
      durationSeconds: 120,
      notes: "Phase 2 test call.",
      createdById: userId,
      createdAt: new Date().toISOString()
    });

    await writeState(state);

    // Native row exists; valid createdById FK preserved.
    const native = await prisma.callLog.findUnique({ where: { id: callId } });
    expect(native).not.toBeNull();
    expect(native?.notes).toBe("Phase 2 test call.");
    expect(native?.workspaceId).toBe(contact!.workspaceId);
    expect(native?.createdById).toBe(userId);

    // The snapshot JSON no longer carries callLogs (blob stays small).
    const snap = await prisma.appStateSnapshot.findUniqueOrThrow({
      where: { id: SNAPSHOT_ID },
      select: { state: true }
    });
    expect((snap.state as { callLogs?: unknown[] }).callLogs ?? []).toHaveLength(0);

    // A read does not re-seed callLogs back into the state.
    const stateAfter = await readState();
    expect(stateAfter.callLogs).toHaveLength(0);
  });

  it("nulls dangling FK refs so createMany never violates a foreign key", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { writeState } = await import("@/lib/phase1/store");
    const { createSeedState } = await import("@/lib/phase1/seed");

    const state = createSeedState();
    const userId = state.users[0].id;

    const callId = "call-test-dangling";
    state.callLogs.unshift({
      id: callId,
      workspaceId: state.workspaces[0].id,
      companyId: "company-does-not-exist",
      contactId: "contact-does-not-exist",
      phone: "+15550000000",
      outcome: "No answer",
      durationSeconds: 0,
      notes: "Dangling refs.",
      createdById: userId,
      createdAt: new Date().toISOString()
    });

    await writeState(state);

    const native = await prisma.callLog.findUniqueOrThrow({ where: { id: callId } });
    expect(native.accountId).toBeNull();
    expect(native.contactId).toBeNull();
    expect(native.createdById).toBe(userId); // valid ref kept
  });

  it("flushes notes to prisma.note, keeps the blob array empty, no re-seed on read", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { writeState, readState } = await import("@/lib/phase1/store");
    const { createSeedState } = await import("@/lib/phase1/seed");

    const state = createSeedState();
    const contact = state.contacts.find((c) => c.companyId);
    expect(contact).toBeTruthy();
    const userId = state.users[0].id;

    const noteId = "note-test-phase2";
    state.notes.unshift({
      id: noteId,
      workspaceId: contact!.workspaceId,
      companyId: contact!.companyId,
      contactId: contact!.id,
      body: "Phase 2 test note.",
      createdById: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await writeState(state);

    const native = await prisma.note.findUnique({ where: { id: noteId } });
    expect(native).not.toBeNull();
    expect(native?.body).toBe("Phase 2 test note.");
    expect(native?.createdById).toBe(userId);

    const snap = await prisma.appStateSnapshot.findUniqueOrThrow({
      where: { id: SNAPSHOT_ID },
      select: { state: true }
    });
    expect((snap.state as { notes?: unknown[] }).notes ?? []).toHaveLength(0);

    const stateAfter = await readState();
    expect(stateAfter.notes).toHaveLength(0);
  });
});

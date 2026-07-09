import { describe, expect, it } from "vitest";

import { migrateState } from "@/lib/phase1/store";
import { createSeedState } from "@/lib/phase1/seed";

describe("migrateState idempotency", () => {
  // Regression for the prod OOM outage (2026-07-09): migrateState runs on every
  // readStateFromPrisma, and its dedupe backfill set changed=true unconditionally.
  // Prod's workspaces[0] is a seeded demo workspace with 0 contacts, so
  // detectWorkspaceDuplicates records nothing, dedupeMatches stays empty, and the
  // guard re-fires on EVERY read -> changed=true -> a full 71-table self-heal
  // projection on every read (which exhausted the 2 GB prod box).
  it("reports no change on a second pass when workspaces[0] has no contacts (prod shape)", () => {
    const state = createSeedState();
    const ws0 = state.workspaces[0]!.id;
    // Reproduce prod: the lead workspace exists (with its seeded defaults) but has
    // no contacts, and dedupe results start empty.
    state.contacts = state.contacts.filter((c) => c.workspaceId !== ws0);
    state.dedupeMatches = [];

    // The first pass may legitimately backfill one-time defaults.
    migrateState(state);
    // A second pass over the already-migrated state must be a pure no-op —
    // otherwise every read triggers a self-heal.
    const second = migrateState(state);
    expect(second.changed).toBe(false);
  });

  it("is idempotent on a freshly seeded state", () => {
    const state = createSeedState();
    migrateState(state);
    expect(migrateState(state).changed).toBe(false);
  });
});

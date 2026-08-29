import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CRM_CONTACT_DIRECTORY_LIMIT } from "@/lib/phase1/crm-contacts-read-model";
import { ASSIGNED_CONTACTS_FETCH_LIMIT } from "@/lib/phase1/assigned-contacts-read-model";
import { SDR_QUEUE_FETCH_LIMIT } from "@/lib/phase1/sdr-queue-read-model";
import { DIRECTORY_FETCH_LIMIT } from "@/lib/phase1/directory-bounds";

/**
 * The real ceiling, read from the deployed systemd unit rather than assumed.
 *
 * Hardcoding "the box has 1.8 GB" was wrong by 400 MB: the web service runs
 * under a cgroup that reclaims hard at MemoryHigh and is OOM-killed by the
 * kernel at MemoryMax, so the instance's total RAM is not the number that binds.
 * Parsing the unit file means changing the limit re-derives this budget instead
 * of silently invalidating it.
 */
function serviceMemoryLimitMb(directive: "MemoryHigh" | "MemoryMax"): number {
  const unit = readFileSync(path.resolve(__dirname, "../../deploy/ec2/syncore-web.service"), "utf8");
  const match = unit.match(new RegExp(`^${directive}=(\\d+)M$`, "m"));
  if (!match) throw new Error(`${directive} not found in deploy/ec2/syncore-web.service`);
  return Number(match[1]);
}

/** Retained heap per row across BOTH models a /crm/contacts render builds. */
const MEASURED_RETAINED_BYTES_PER_ROW = 24_000;

/** Where the web process sits after an import, before serving anything. */
const OBSERVED_FLOOR_MB = 800;

/**
 * The page is `force-dynamic` and uncached with no concurrency limit, so the
 * budget cannot assume a single render. Two is the least defensible-in-public
 * assumption: one manager and one SDR, or one person double-loading a slow page.
 */
const ASSUMED_CONCURRENT_RENDERS = 2;

/**
 * The bound itself — the behaviour of the `truncated` flag is asserted against
 * the real read model in crm-contacts-read-model.test.ts, not re-implemented
 * here. (An earlier version of this file defined its own `fetched >= bound`
 * lambda and asserted against that, which meant reverting the read model to the
 * buggy comparison left every test green.)
 *
 * The three read models that list the same book page CLIENT-side, so each fetches
 * a bounded slice and ships all of it. The bound is therefore a memory ceiling on
 * a 1.8 GB box, and the risk runs in both directions: too low silently drops the
 * oldest rows, too high OOMs the instance. These pin the invariants that keep it
 * defensible.
 */
describe("directory fetch bound", () => {
  it("is one number shared by every model that lists the book", () => {
    // Three surfaces render the same assignments and contacts. Separate bounds
    // meant a contact visible in one and missing from another, and the SDR
    // queue's headline metrics are derived from its own slice.
    expect(CRM_CONTACT_DIRECTORY_LIMIT).toBe(DIRECTORY_FETCH_LIMIT);
    expect(ASSIGNED_CONTACTS_FETCH_LIMIT).toBe(DIRECTORY_FETCH_LIMIT);
    // The queue's bound was the one nothing held: reverting it to its old 2,000
    // left the whole suite green, and it is the surface where drift actually
    // changes numbers — Assigned / P1 / Overdue are counted off this slice.
    expect(SDR_QUEUE_FETCH_LIMIT).toBe(DIRECTORY_FETCH_LIMIT);
  });

  it("clears the live workspace with headroom", () => {
    // 2,116 contacts as of the tattoo import — the number that made the old
    // 2,000 bound start dropping rows.
    expect(DIRECTORY_FETCH_LIMIT).toBeGreaterThan(2_116 * 2);
  });

  it("stays inside what the cgroup will actually let the process hold", () => {
    // Measured retained heap at 25,000 rows was ~592 MB across the object graphs
    // a single /crm/contacts render builds. The earlier version of this test
    // asserted against a hand-picked 250 MB, which passed at 10,922 rows — it
    // would have waved through a 2x raise, which is the exact failure it was
    // written after. Derive the budget instead.
    const headroomMb = serviceMemoryLimitMb("MemoryHigh") - OBSERVED_FLOOR_MB;
    const perRenderBudgetBytes = ((headroomMb / ASSUMED_CONCURRENT_RENDERS) * 1024 * 1024);

    expect(DIRECTORY_FETCH_LIMIT * MEASURED_RETAINED_BYTES_PER_ROW).toBeLessThan(perRenderBudgetBytes);
  });

  it("cannot reach the OOM kill even in the worst case it allows", () => {
    // MemoryHigh only throttles; MemoryMax is the kernel killing the process.
    // Concurrent renders share one heap, so they add.
    const worstCaseMb =
      OBSERVED_FLOOR_MB +
      (DIRECTORY_FETCH_LIMIT * MEASURED_RETAINED_BYTES_PER_ROW * ASSUMED_CONCURRENT_RENDERS) / (1024 * 1024);

    expect(worstCaseMb).toBeLessThan(serviceMemoryLimitMb("MemoryMax"));
  });
});

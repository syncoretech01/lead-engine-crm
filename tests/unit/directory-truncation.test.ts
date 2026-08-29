import { describe, expect, it } from "vitest";

import { CRM_CONTACT_DIRECTORY_LIMIT } from "@/lib/phase1/crm-contacts-read-model";
import { ASSIGNED_CONTACTS_FETCH_LIMIT } from "@/lib/phase1/assigned-contacts-read-model";
import { DIRECTORY_FETCH_LIMIT } from "@/lib/phase1/directory-bounds";

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
  });

  it("clears the live workspace with headroom", () => {
    // 2,116 contacts as of the tattoo import — the number that made the old
    // 2,000 bound start dropping rows.
    expect(DIRECTORY_FETCH_LIMIT).toBeGreaterThan(2_116 * 2);
  });

  it("stays inside what the deployed box can hold", () => {
    // Measured retained heap at 25,000 rows was ~592 MB across the contact and
    // assignment object graphs, on an instance whose web process already sits
    // near 800 MB of 1.8 GB after an import. Roughly 24 KB of retained heap per
    // row across both models, so the bound has to stay well under the point
    // where a single render exhausts the box. Raising it past this needs a
    // smaller per-row payload or real server-side pagination, not a bigger
    // number — hence a test, not just a comment.
    const measuredRetainedBytesPerRow = 24_000;
    const budgetBytes = 250 * 1024 * 1024;
    expect(DIRECTORY_FETCH_LIMIT * measuredRetainedBytesPerRow).toBeLessThan(budgetBytes);
  });
});

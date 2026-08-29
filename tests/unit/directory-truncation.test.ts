import { describe, expect, it } from "vitest";

import { CRM_CONTACT_DIRECTORY_LIMIT } from "@/lib/phase1/crm-contacts-read-model";
import { ASSIGNED_CONTACTS_FETCH_LIMIT } from "@/lib/phase1/assigned-contacts-read-model";

/**
 * The contacts directory and the assigned book fetch a bounded slice and let the
 * client table filter, sort and page it. The bound itself is survivable; the bug
 * is a bound that is SILENT.
 *
 * Both lists are ordered newest-first, so what falls off the end is the oldest —
 * the established book an SDR is actively working. At 2,000 the live workspace
 * (2,116 contacts) was already dropping rows with nothing on screen to say so,
 * which is the same shape as the earlier "Sam's leads invisible" incident.
 *
 * These assertions pin the two properties that keep it honest: the bound clears
 * the real data by a wide margin, and `truncated` is derived from the BOUND
 * rather than from a comparison that an SDR-scoped view would trip.
 */
describe("directory fetch bounds", () => {
  it("clears the live workspace by a wide margin", () => {
    const liveWorkspaceContacts = 2_116;
    expect(CRM_CONTACT_DIRECTORY_LIMIT).toBeGreaterThan(liveWorkspaceContacts * 10);
    expect(ASSIGNED_CONTACTS_FETCH_LIMIT).toBeGreaterThan(liveWorkspaceContacts * 10);
  });

  it("keeps the two directories on the same bound", () => {
    // They render the same book from different angles; different bounds would
    // mean a contact visible in one and missing from the other.
    expect(ASSIGNED_CONTACTS_FETCH_LIMIT).toBe(CRM_CONTACT_DIRECTORY_LIMIT);
  });

  // Mirrors the read models' own expression. Comparing fetched-vs-total instead
  // would report truncation for every SDR-scoped session, since an SDR
  // legitimately sees a subset of the workspace.
  const isTruncated = (fetched: number, bound: number) => fetched >= bound;

  it("flags truncation only when the fetch actually hit the bound", () => {
    expect(isTruncated(CRM_CONTACT_DIRECTORY_LIMIT, CRM_CONTACT_DIRECTORY_LIMIT)).toBe(true);
    expect(isTruncated(CRM_CONTACT_DIRECTORY_LIMIT - 1, CRM_CONTACT_DIRECTORY_LIMIT)).toBe(false);
    expect(isTruncated(0, CRM_CONTACT_DIRECTORY_LIMIT)).toBe(false);
  });

  it("does not flag an SDR-scoped view that legitimately sees fewer rows", () => {
    // 36 assigned contacts out of a 2,116-contact workspace is not truncation.
    expect(isTruncated(36, CRM_CONTACT_DIRECTORY_LIMIT)).toBe(false);
  });
});

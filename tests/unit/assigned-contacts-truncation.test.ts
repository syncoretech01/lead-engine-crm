import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNED_CONTACTS_FETCH_LIMIT,
  readAssignedContactsModel
} from "@/lib/phase1/assigned-contacts-read-model";
import type { Session } from "@/lib/phase1/types";

const prismaMocks = vi.hoisted(() => ({
  sdrAssignmentFindMany: vi.fn(),
  workspaceMemberFindMany: vi.fn(),
  trackedCallCount: vi.fn()
}));

vi.mock("@/lib/phase1/storage-driver", () => ({
  resolveStorageDriver: () => "prisma"
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sdrAssignment: { findMany: prismaMocks.sdrAssignmentFindMany },
    workspaceMember: { findMany: prismaMocks.workspaceMemberFindMany },
    trackedCall: { count: prismaMocks.trackedCallCount }
  }
}));

// The row mapper belongs to the SDR queue model and has its own tests; stubbing
// it keeps this file on the one thing it is asserting — whether a capped fetch
// is reported as capped.
vi.mock("@/lib/phase1/sdr-queue-read-model", () => ({
  sdrAssignmentRowInclude: {},
  mapSdrAssignmentRow: (assignment: { id: string }) => ({
    id: assignment.id,
    contactId: `contact-${assignment.id}`,
    companyId: `company-${assignment.id}`
  })
}));

const session = {
  role: "SDR",
  user: { id: "user-1", name: "Zack" }
} as unknown as Session;

function assignments(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `a-${index}` }));
}

describe("assigned contacts truncation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.workspaceMemberFindMany.mockResolvedValue([]);
    prismaMocks.trackedCallCount.mockResolvedValue(0);
  });

  it("reports truncated when the fetch comes back at the bound", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue(assignments(ASSIGNED_CONTACTS_FETCH_LIMIT));

    const model = await readAssignedContactsModel(session, "ws-1");

    expect(model?.truncated).toBe(true);
  });

  it("does not report truncated on a book that fits", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue(assignments(12));

    const model = await readAssignedContactsModel(session, "ws-1");

    expect(model?.truncated).toBe(false);
    expect(model?.rows).toHaveLength(12);
  });

  it("bounds the query at the shared directory limit", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue([]);

    await readAssignedContactsModel(session, "ws-1");

    // Without a `take` the query is unbounded, which is the OOM this bound
    // exists to prevent — assert the argument actually reaches Prisma.
    expect(prismaMocks.sdrAssignmentFindMany.mock.calls[0][0].take).toBe(ASSIGNED_CONTACTS_FETCH_LIMIT);
  });

  /**
   * The flag describes the DATABASE fetch, not the rendered list. On /sdr/focus
   * the rows are then narrowed to the current call cycle, so a book that filled
   * the bound can render a handful of rows — deriving truncation from `rows`
   * would call that "not truncated" and hide exactly the case that matters.
   */
  it("stays true when the call-plan filter shrinks the rendered rows", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue(assignments(ASSIGNED_CONTACTS_FETCH_LIMIT));

    const model = await readAssignedContactsModel(session, "ws-1", { callPlan: true });

    expect(model?.truncated).toBe(true);
    expect(model?.rows.length).toBeLessThan(ASSIGNED_CONTACTS_FETCH_LIMIT);
  });
});

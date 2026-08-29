import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRM_CONTACT_DIRECTORY_LIMIT,
  readFastCrmContactsModel
} from "@/lib/phase1/crm-contacts-read-model";
import type { Session } from "@/lib/phase1/types";

const prismaMocks = vi.hoisted(() => ({
  activityFindMany: vi.fn(),
  contactCount: vi.fn(),
  contactFindMany: vi.fn(),
  opportunityFindMany: vi.fn(),
  sdrAssignmentFindMany: vi.fn(),
  taskCount: vi.fn(),
  taskFindMany: vi.fn()
}));

vi.mock("@/lib/phase1/storage-driver", () => ({
  resolveStorageDriver: () => "prisma"
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activity: { findMany: prismaMocks.activityFindMany },
    contact: {
      count: prismaMocks.contactCount,
      findMany: prismaMocks.contactFindMany
    },
    opportunity: { findMany: prismaMocks.opportunityFindMany },
    sdrAssignment: { findMany: prismaMocks.sdrAssignmentFindMany },
    task: {
      count: prismaMocks.taskCount,
      findMany: prismaMocks.taskFindMany
    }
  }
}));

describe("fast CRM contacts read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.activityFindMany.mockResolvedValue([]);
    prismaMocks.opportunityFindMany.mockResolvedValue([]);
    prismaMocks.taskCount.mockResolvedValue(0);
    prismaMocks.taskFindMany.mockResolvedValue([]);
  });

  it("returns every SDR-scoped contact beyond 500 and reports the uncapped total", async () => {
    const workspaceId = "workspace-acme";
    const contactRows = Array.from({ length: 791 }, (_, index) => ({
      id: `contact-${index + 1}`,
      fullName: `Contact ${index + 1}`,
      title: null,
      email: `contact-${index + 1}@example.com`,
      phone: "+15551234567",
      companyId: `company-${index + 1}`,
      company: {
        name: `Company ${index + 1}`,
        rootDomain: `company-${index + 1}.example.com`
      },
      grade: "A",
      score: 90,
      priority: "P1",
      status: "Assigned",
      segment: null,
      owner: "Sam Carter",
      verification: null,
      enrichmentCoverage: null,
      confidence: 100,
      isSuppressed: false,
      notes: null
    }));
    const scopedContactIds = contactRows.map((contact) => contact.id);

    prismaMocks.sdrAssignmentFindMany.mockResolvedValue(
      scopedContactIds.map((contactId) => ({ contactId }))
    );
    prismaMocks.contactCount.mockResolvedValue(contactRows.length);
    prismaMocks.contactFindMany.mockImplementation(async (args) => {
      if (args.select?.company) {
        return contactRows.slice(0, args.take);
      }
      return [];
    });

    const session = {
      user: { id: "user-sam", name: "Sam Carter" },
      permissions: []
    } as unknown as Session;

    const result = await readFastCrmContactsModel(session, workspaceId);
    const directoryQuery = prismaMocks.contactFindMany.mock.calls.find(
      ([args]) => args.select?.company
    )?.[0];

    expect(directoryQuery).toMatchObject({
      where: { workspaceId, id: { in: scopedContactIds } },
      // Assert the constant, not a copy of its value: the bound moves when the
      // book grows, and a hardcoded number here just breaks on every change.
      take: CRM_CONTACT_DIRECTORY_LIMIT
    });
    expect(result?.contacts).toHaveLength(791);
    expect(result?.contacts.at(-1)?.id).toBe("contact-791");
    expect(result?.totalContacts).toBe(791);
  });
});

/**
 * `truncated` asserted against the READ MODEL, not against a copy of its
 * expression. A previous version of this coverage re-implemented
 * `fetched >= bound` inside the test file, which meant reverting the read model
 * to the buggy `contacts.length < totalContacts` — the very mistake the flag
 * exists to avoid, since it fires for every SDR-scoped session — left the suite
 * green.
 */
describe("fast CRM contacts read model — truncation flag", () => {
  const workspaceId = "workspace-acme";
  const session = { user: { id: "user-admin" }, permissions: ["view_all_records"] } as unknown as Session;

  function contactRows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `contact-${index + 1}`,
      fullName: `Contact ${index + 1}`,
      title: null,
      email: null,
      phone: null,
      companyId: null,
      company: null,
      grade: "A",
      score: 10,
      priority: "P3",
      status: "Assigned",
      segment: null,
      owner: null,
      verification: null,
      enrichmentCoverage: null,
      confidence: 50,
      isSuppressed: false,
      notes: null
    }));
  }

  function mockDirectory(fetched: number, total: number) {
    prismaMocks.contactCount.mockResolvedValue(total);
    prismaMocks.contactFindMany.mockImplementation(async (args) =>
      args.select?.company ? contactRows(Math.min(fetched, args.take)) : []
    );
  }

  it("flags truncation when the fetch comes back full", async () => {
    mockDirectory(CRM_CONTACT_DIRECTORY_LIMIT, CRM_CONTACT_DIRECTORY_LIMIT + 500);
    const result = await readFastCrmContactsModel(session, workspaceId);
    expect(result?.truncated).toBe(true);
  });

  it("does not flag truncation one row below the bound", async () => {
    mockDirectory(CRM_CONTACT_DIRECTORY_LIMIT - 1, CRM_CONTACT_DIRECTORY_LIMIT - 1);
    const result = await readFastCrmContactsModel(session, workspaceId);
    expect(result?.truncated).toBe(false);
  });

  // The regression the flag must not have: a scoped session sees a subset of the
  // workspace, which is normal and is NOT truncation.
  it("does not flag a scoped view that legitimately returns fewer rows than the workspace holds", async () => {
    mockDirectory(36, 2_116);
    const result = await readFastCrmContactsModel(session, workspaceId);
    expect(result?.contacts).toHaveLength(36);
    expect(result?.totalContacts).toBe(2_116);
    expect(result?.truncated).toBe(false);
  });
});

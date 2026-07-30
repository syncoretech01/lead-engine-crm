import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as decideRoute } from "@/app/api/approvals/[id]/decide/route";
import { POST as reviseRoute } from "@/app/api/approvals/[id]/revise/route";
import { decideApprovalWithSideEffects } from "@/lib/growth/approval-orchestration";
import { approvalNotificationEventId } from "@/lib/growth/approval-notifications";
import {
  createApproval,
  reviseApproval
} from "@/lib/growth/repositories/approval-repository";
import { createNicheBriefWithApproval } from "@/lib/growth/repositories/niche-brief-repository";

const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";
const require = createRequire(import.meta.url);
const briefDocument = JSON.parse(
  readFileSync(
    require.resolve("@syncore/contracts/fixtures/research/niche-brief-document.json"),
    "utf8"
  )
) as Record<string, unknown>;

const requestPayload = {
  niche: "Dump Truck Rentals",
  geography: "Texas",
  serviceToPitch: ["Meta Ads"],
  hypothesis: "Owner-operators lose inbound to a weak mobile quote flow.",
  exclusions: [],
  testSizeHint: 300,
  budgetHintCents: 8500
};

const createdWorkspaces = new Set<string>();
const createdUsers = new Set<string>();
let sequence = 0;

async function db() {
  return (await import("@/lib/prisma")).prisma;
}

async function seedResearch(t2: number | null = null) {
  sequence += 1;
  const prisma = await db();
  const workspaceId = `ws_notify_lifecycle_${Date.now()}_${sequence}`;
  await prisma.workspace.create({
    data: { id: workspaceId, name: `Notify lifecycle ${sequence}`, approvalThresholdT2Cents: t2 }
  });
  createdWorkspaces.add(workspaceId);
  const request = await prisma.nicheRequest.create({
    data: {
      workspaceId,
      createdBy: "usr_requester",
      sourceChannel: "slack",
      structuredPayload: requestPayload,
      status: "researching"
    }
  });
  const researchRun = await prisma.researchRun.create({
    data: {
      workspaceId,
      nicheRequestId: request.id,
      status: "completed",
      progress: 1,
      completedAt: new Date("2026-07-30T12:00:00.000Z")
    }
  });
  await prisma.nicheRequest.update({
    where: { id: request.id },
    data: { researchRunId: researchRun.id }
  });
  return { workspaceId, request, researchRun };
}

async function createChain(t2: number | null = null) {
  const seeded = await seedResearch(t2);
  const created = await createNicheBriefWithApproval({
    workspaceId: seeded.workspaceId,
    researchRunId: seeded.researchRun.id,
    document: briefDocument,
    requestedBy: "usr_requester"
  });
  return { ...seeded, ...created };
}

function envelope(row: { envelopeJson: unknown }) {
  return JSON.parse((row.envelopeJson as { body: string }).body) as {
    eventId: string;
    workspaceId: string;
    data: { approvalId?: string; payload: Record<string, unknown> };
  };
}

function machineRequest(input: {
  workspaceId: string;
  approvalId: string;
  actorId: string;
  token?: string | null;
  body: Record<string, unknown>;
  operation: "decide" | "revise";
}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-syncore-actor-id": input.actorId,
    "x-syncore-workspace-id": input.workspaceId
  };
  if (input.token !== null) {
    headers.authorization = `Bearer ${input.token ?? "integration-chat-token"}`;
  }
  return new Request(`http://localhost/api/approvals/${input.approvalId}/${input.operation}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input.body)
  });
}

describe.skipIf(!enabled)("approval notification lifecycle (real Postgres)", () => {
  beforeAll(() => {
    process.env.SYNCORE_STORAGE_DRIVER = "prisma";
    process.env.SYNCORE_CHAT_API_TOKEN = "integration-chat-token";
    process.env.SYNCORE_BOT_NOTIFY_SECRET = "integration-notify-secret";
    process.env.SYNCORE_BOT_NOTIFY_URL = "https://bot.example.test/notify";
  });

  afterEach(async () => {
    if (!enabled) return;
    const prisma = await db();
    if (createdWorkspaces.size > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: [...createdWorkspaces] } } });
      createdWorkspaces.clear();
    }
    if (createdUsers.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...createdUsers] } } });
      createdUsers.clear();
    }
  });

  afterAll(async () => {
    if (!enabled) return;
    await (await db()).$disconnect();
  });

  it("creates an actionable approval and its deterministic requested notification atomically", async () => {
    const created = await createChain(8500);
    const prisma = await db();
    const rows = await prisma.notifyOutbox.findMany({
      where: { approvalId: created.approval.id, kind: "APPROVAL_REQUESTED" }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventId).toBe(
      approvalNotificationEventId("approval-requested", created.approval.id)
    );
    expect(created.approval.creationKey).toBe(`niche-test:${created.researchRun.id}`);

    const body = envelope(rows[0]!);
    expect(body).toMatchObject({
      workspaceId: created.workspaceId,
      data: {
        approvalId: created.approval.id,
        payload: {
          approvalType: "NICHE_TEST",
          status: "pending",
          requiredApproverCount: 2,
          expiresAt: null,
          requestedBy: "usr_requester",
          recipientRouting: { workspaceId: created.workspaceId },
          display: {
            title: expect.any(String),
            summary: expect.any(String),
            estimatedCostCents: 8500
          }
        }
      }
    });
  });

  it("deduplicates concurrent creation, repeated requests, lost acknowledgements, and process replay", async () => {
    const seeded = await seedResearch();
    const input = {
      workspaceId: seeded.workspaceId,
      researchRunId: seeded.researchRun.id,
      document: briefDocument,
      requestedBy: "usr_requester"
    };
    const concurrent = await Promise.all([
      createNicheBriefWithApproval(input),
      createNicheBriefWithApproval(input)
    ]);
    const replay = await createNicheBriefWithApproval(input);
    expect(new Set([...concurrent, replay].map((item) => item.approval.id)).size).toBe(1);

    const prisma = await db();
    expect(await prisma.nicheBrief.count({ where: { researchRunId: seeded.researchRun.id } })).toBe(1);
    expect(await prisma.approval.count({
      where: { creationKey: `niche-test:${seeded.researchRun.id}` }
    })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: replay.approval.id, kind: "APPROVAL_REQUESTED" }
    })).toBe(1);
  });

  it("rolls back approval creation and its outbox row without leaving an orphan", async () => {
    const seeded = await seedResearch();
    await expect(
      createNicheBriefWithApproval(
        {
          workspaceId: seeded.workspaceId,
          researchRunId: seeded.researchRun.id,
          document: briefDocument,
          requestedBy: "usr_requester"
        },
        undefined,
        { beforeCommit: () => { throw new Error("injected creation rollback"); } }
      )
    ).rejects.toThrow("injected creation rollback");

    const prisma = await db();
    expect(await prisma.nicheBrief.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);
    expect(await prisma.approval.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);
    expect(await prisma.notifyOutbox.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);
  });

  it("retries creation after a serialization failure without changing its identities", async () => {
    const seeded = await seedResearch();
    let attempts = 0;
    const created = await createNicheBriefWithApproval(
      {
        workspaceId: seeded.workspaceId,
        researchRunId: seeded.researchRun.id,
        document: briefDocument,
        requestedBy: "usr_requester"
      },
      undefined,
      {
        beforeCommit: () => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("retry"), { code: "P2034" });
        }
      }
    );
    expect(attempts).toBe(2);
    const prisma = await db();
    expect(await prisma.approval.count({ where: { id: created.approval.id } })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { eventId: approvalNotificationEventId("approval-requested", created.approval.id) }
    })).toBe(1);
  });

  it("persists revision history and both revision notifications in one transaction", async () => {
    const created = await createChain();
    const originalPayload = created.approval.payloadJson;
    const originalHash = created.approval.payloadSha256;
    const replacementPayload = {
      ...(created.approval.payloadJson as Record<string, unknown>),
      title: "Approve the revised ICP"
    };
    const result = await reviseApproval({
      workspaceId: created.workspaceId,
      approvalId: created.approval.id,
      payload: replacementPayload,
      actorId: "usr_reviser",
      reason: "Narrow geography after operator review"
    });
    expect(result.outcome).toBe("revised");
    if (result.outcome !== "revised") return;

    const prisma = await db();
    const [original, replacement, brief] = await Promise.all([
      prisma.approval.findUniqueOrThrow({ where: { id: created.approval.id } }),
      prisma.approval.findUniqueOrThrow({ where: { id: result.created.id } }),
      prisma.nicheBrief.findUniqueOrThrow({ where: { id: created.brief.id } })
    ]);
    expect(original).toMatchObject({
      status: "superseded",
      payloadJson: originalPayload,
      payloadSha256: originalHash
    });
    expect(replacement).toMatchObject({
      status: "pending",
      supersedesApprovalId: original.id,
      revisionReason: "Narrow geography after operator review",
      requestedBy: "usr_reviser"
    });
    expect(brief.approvalId).toBe(replacement.id);
    expect(await prisma.notifyOutbox.count({
      where: { eventId: approvalNotificationEventId("approval-revised", original.id) }
    })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { eventId: approvalNotificationEventId("approval-requested", replacement.id) }
    })).toBe(1);
  });

  it("deduplicates concurrent and replayed revision requests", async () => {
    const created = await createChain();
    const input = {
      workspaceId: created.workspaceId,
      approvalId: created.approval.id,
      payload: {
        ...(created.approval.payloadJson as Record<string, unknown>),
        title: "Concurrent revised ICP"
      },
      actorId: "usr_reviser",
      reason: "Same retried request"
    };
    const concurrent = await Promise.all([reviseApproval(input), reviseApproval(input)]);
    const replay = await reviseApproval(input);
    const replacements = [...concurrent, replay].flatMap((item) =>
      item.outcome === "revised" || item.outcome === "already_revised" ? [item.created.id] : []
    );
    expect(new Set(replacements).size).toBe(1);

    const prisma = await db();
    expect(await prisma.approval.count({
      where: { supersedesApprovalId: created.approval.id }
    })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { eventId: approvalNotificationEventId("approval-revised", created.approval.id) }
    })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { eventId: approvalNotificationEventId("approval-requested", replacements[0]!) }
    })).toBe(1);
  });

  it("rolls back an injected revision failure without a partial chain or notification", async () => {
    const created = await createChain();
    await expect(
      reviseApproval(
        {
          workspaceId: created.workspaceId,
          approvalId: created.approval.id,
          payload: {
            ...(created.approval.payloadJson as Record<string, unknown>),
            title: "Rolled back revision"
          },
          actorId: "usr_reviser",
          reason: "Must roll back"
        },
        undefined,
        { beforeCommit: () => { throw new Error("injected revision rollback"); } }
      )
    ).rejects.toThrow("injected revision rollback");

    const prisma = await db();
    expect(await prisma.approval.findUniqueOrThrow({ where: { id: created.approval.id } })).toMatchObject({
      status: "pending",
      payloadSha256: created.approval.payloadSha256
    });
    expect(await prisma.approval.count({
      where: { supersedesApprovalId: created.approval.id }
    })).toBe(0);
    expect((await prisma.nicheBrief.findUniqueOrThrow({ where: { id: created.brief.id } })).approvalId)
      .toBe(created.approval.id);
    expect(await prisma.notifyOutbox.count({
      where: { workspaceId: created.workspaceId, kind: "APPROVAL_REVISED" }
    })).toBe(0);
    expect(await prisma.notifyOutbox.count({ where: { workspaceId: created.workspaceId } })).toBe(1);
  });

  it("rejects expired creation/revision without an actionable event", async () => {
    const seeded = await seedResearch();
    const now = new Date("2026-07-30T15:00:00.000Z");
    const payload = {
      type: "SUPPRESS_BULK" as const,
      title: "Expired approval",
      summary: "Must never become actionable.",
      recordCount: 1,
      reason: "test"
    };
    await expect(createApproval({
      workspaceId: seeded.workspaceId,
      payload,
      requestedBy: "usr_requester",
      idempotencyKey: `expired:${seeded.workspaceId}`,
      expiresAt: new Date("2026-07-30T14:00:00.000Z"),
      now
    })).rejects.toThrow("already expired");

    const created = await createNicheBriefWithApproval({
      workspaceId: seeded.workspaceId,
      researchRunId: seeded.researchRun.id,
      document: briefDocument,
      requestedBy: "usr_requester"
    });
    const prisma = await db();
    await prisma.approval.update({
      where: { id: created.approval.id },
      data: { expiresAt: new Date("2026-07-30T14:00:00.000Z") }
    });
    const revision = await reviseApproval({
      workspaceId: seeded.workspaceId,
      approvalId: created.approval.id,
      payload: created.approval.payloadJson,
      actorId: "usr_reviser",
      now
    });
    expect(revision.outcome).toBe("expired");
    expect(await prisma.approval.count({ where: { workspaceId: seeded.workspaceId } })).toBe(1);
    expect(await prisma.notifyOutbox.count({ where: { workspaceId: seeded.workspaceId } })).toBe(1);
  });

  it("keeps approved/declined final events single and emits none after only the first T2 decision", async () => {
    const declined = await createChain();
    const t2 = await createChain(8500);
    const prisma = await db();

    await decideApprovalWithSideEffects({
      workspaceId: declined.workspaceId,
      approvalId: declined.approval.id,
      decision: "decline",
      actorId: "usr_decliner"
    });
    await decideApprovalWithSideEffects({
      workspaceId: declined.workspaceId,
      approvalId: declined.approval.id,
      decision: "decline",
      actorId: "usr_decliner"
    });
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: declined.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(1);

    await decideApprovalWithSideEffects({
      workspaceId: t2.workspaceId,
      approvalId: t2.approval.id,
      decision: "approve",
      actorId: "usr_first"
    });
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: t2.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(0);
    await decideApprovalWithSideEffects({
      workspaceId: t2.workspaceId,
      approvalId: t2.approval.id,
      decision: "approve",
      actorId: "usr_second"
    });
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: t2.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(1);
  });

  it("rejects unauthenticated and cross-workspace machine calls without side effects, then replays an authorized revision", async () => {
    const created = await createChain();
    const other = await seedResearch();
    const prisma = await db();
    const actorId = `usr_notify_actor_${Date.now()}_${sequence}`;
    await prisma.user.create({
      data: { id: actorId, email: `${actorId}@example.test`, name: "Notify Actor" }
    });
    createdUsers.add(actorId);
    await prisma.workspaceMember.create({
      data: { workspaceId: created.workspaceId, userId: actorId, role: "MANAGER" }
    });

    const revisedPayload = {
      ...(created.approval.payloadJson as Record<string, unknown>),
      title: "Machine-revised ICP"
    };
    const before = await Promise.all([
      prisma.approval.count({ where: { workspaceId: created.workspaceId } }),
      prisma.campaign.count({ where: { workspaceId: created.workspaceId } }),
      prisma.notifyOutbox.count({ where: { workspaceId: created.workspaceId } })
    ]);
    const context = { params: Promise.resolve({ id: created.approval.id }) };
    const missing = await decideRoute(
      machineRequest({
        workspaceId: created.workspaceId,
        approvalId: created.approval.id,
        actorId,
        token: null,
        operation: "decide",
        body: { approvalId: created.approval.id, decision: "approve" }
      }),
      context
    );
    const invalid = await reviseRoute(
      machineRequest({
        workspaceId: created.workspaceId,
        approvalId: created.approval.id,
        actorId,
        token: "invalid-token",
        operation: "revise",
        body: { approvalId: created.approval.id, payload: revisedPayload }
      }),
      context
    );
    const cross = await decideRoute(
      machineRequest({
        workspaceId: other.workspaceId,
        approvalId: created.approval.id,
        actorId,
        operation: "decide",
        body: { approvalId: created.approval.id, decision: "approve" }
      }),
      context
    );
    expect([missing.status, invalid.status, cross.status]).toEqual([401, 401, 403]);
    expect(await Promise.all([
      prisma.approval.count({ where: { workspaceId: created.workspaceId } }),
      prisma.campaign.count({ where: { workspaceId: created.workspaceId } }),
      prisma.notifyOutbox.count({ where: { workspaceId: created.workspaceId } })
    ])).toEqual(before);

    const revisionRequest = () =>
      machineRequest({
        workspaceId: created.workspaceId,
        approvalId: created.approval.id,
        actorId,
        operation: "revise",
        body: {
          approvalId: created.approval.id,
          payload: revisedPayload,
          reason: "Machine retry"
        }
      });
    const first = await reviseRoute(revisionRequest(), context);
    const replay = await reviseRoute(revisionRequest(), context);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    const firstBody = await first.json() as { supersededByApprovalId: string };
    const replayBody = await replay.json() as { supersededByApprovalId: string };
    expect(replayBody.supersededByApprovalId).toBe(firstBody.supersededByApprovalId);
    expect(await prisma.approval.count({
      where: { supersedesApprovalId: created.approval.id }
    })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { eventId: approvalNotificationEventId("approval-revised", created.approval.id) }
    })).toBe(1);
  });
});

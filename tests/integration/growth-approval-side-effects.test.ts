import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as decideRoute } from "@/app/api/approvals/[id]/decide/route";
import {
  ApprovalApplicationError,
  decideApprovalWithSideEffects
} from "@/lib/growth/approval-orchestration";
import { hashApprovalPayload } from "@/lib/growth/approval-hash";
import { createApproval, reviseApproval } from "@/lib/growth/repositories/approval-repository";
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
let sequence = 0;

async function db() {
  return (await import("@/lib/prisma")).prisma;
}

async function createWorkspace(t2: number | null = null) {
  sequence += 1;
  const workspaceId = `ws_niche_apply_${Date.now()}_${sequence}`;
  await (await db()).workspace.create({
    data: { id: workspaceId, name: `Niche apply ${sequence}`, approvalThresholdT2Cents: t2 }
  });
  await (await db()).workspaceMember.create({
    data: { workspaceId, userId: "usr_slack", role: "MANAGER" }
  });
  createdWorkspaces.add(workspaceId);
  return workspaceId;
}

async function seedNiche(input: { workspaceId?: string; t2?: number | null } = {}) {
  const prisma = await db();
  const workspaceId = input.workspaceId ?? (await createWorkspace(input.t2 ?? null));
  const request = await prisma.nicheRequest.create({
    data: {
      workspaceId,
      createdBy: "usr_requester",
      sourceChannel: "slack",
      structuredPayload: requestPayload
    }
  });
  const completedAt = new Date("2026-07-29T12:00:00.000Z");
  const researchRun = await prisma.researchRun.create({
    data: {
      workspaceId,
      nicheRequestId: request.id,
      status: "completed",
      progress: 1,
      completedAt
    }
  });
  await prisma.nicheRequest.update({
    where: { id: request.id },
    data: { status: "researching", researchRunId: researchRun.id }
  });
  const { brief, approval } = await createNicheBriefWithApproval({
    workspaceId,
    researchRunId: researchRun.id,
    document: briefDocument,
    requestedBy: "usr_requester"
  });
  return { workspaceId, request, researchRun, brief, approval };
}

async function expectApplicationError(
  promise: Promise<unknown>,
  code: ApprovalApplicationError["code"]
) {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApprovalApplicationError);
    expect((error as ApprovalApplicationError).code).toBe(code);
  }
}

function decisionRequest(input: {
  workspaceId: string;
  approvalId: string;
  actorId: string;
}) {
  return new Request(`http://localhost/api/approvals/${input.approvalId}/decide`, {
    method: "POST",
    headers: {
      authorization: "Bearer integration-chat-token",
      "content-type": "application/json",
      "x-syncore-actor-id": input.actorId,
      "x-syncore-workspace-id": input.workspaceId
    },
    body: JSON.stringify({ approvalId: input.approvalId, decision: "approve" })
  });
}

describe.skipIf(!enabled)("NICHE_TEST approval side effects (real Postgres)", () => {
  beforeAll(async () => {
    process.env.SYNCORE_STORAGE_DRIVER = "prisma";
    process.env.SYNCORE_CHAT_API_TOKEN = "integration-chat-token";
    process.env.SYNCORE_BOT_NOTIFY_SECRET = "integration-notify-secret";
    process.env.SYNCORE_BOT_NOTIFY_URL = "https://bot.example.test/notify";
    await (await db()).user.upsert({
      where: { id: "usr_slack" },
      create: { id: "usr_slack", email: "usr-slack-approval@example.test", name: "Slack Approver" },
      update: {}
    });
  });

  afterEach(async () => {
    if (!enabled || createdWorkspaces.size === 0) return;
    await (await db()).workspace.deleteMany({ where: { id: { in: [...createdWorkspaces] } } });
    createdWorkspaces.clear();
  });

  afterAll(async () => {
    if (!enabled) return;
    const prisma = await db();
    await prisma.user.deleteMany({ where: { id: "usr_slack" } });
    await prisma.$disconnect();
  });

  it("atomically approves the brief, creates one related campaign and safe initial stages, and enqueues one final notification", async () => {
    const seeded = await seedNiche();
    const result = await decideApprovalWithSideEffects({
      workspaceId: seeded.workspaceId,
      approvalId: seeded.approval.id,
      decision: "approve",
      actorId: "usr_approver"
    });
    expect(result.outcome).toBe("decided");
    expect(result.campaignId).toBeTruthy();

    const prisma = await db();
    const [approval, brief, campaign, stages, outbox] = await Promise.all([
      prisma.approval.findUniqueOrThrow({ where: { id: seeded.approval.id } }),
      prisma.nicheBrief.findUniqueOrThrow({ where: { id: seeded.brief.id } }),
      prisma.campaign.findUniqueOrThrow({ where: { id: result.campaignId! } }),
      prisma.campaignStageRun.findMany({
        where: { campaignId: result.campaignId! },
        orderBy: { createdAt: "asc" }
      }),
      prisma.notifyOutbox.findMany({
        where: { approvalId: seeded.approval.id, kind: "APPROVAL_DECIDED" }
      })
    ]);

    expect(approval).toMatchObject({
      status: "approved",
      campaignId: campaign.id,
      decidedBy: "usr_approver"
    });
    expect(approval.sideEffectsAppliedAt).toBeInstanceOf(Date);
    expect(brief.status).toBe("approved");
    expect(campaign).toMatchObject({
      workspaceId: seeded.workspaceId,
      nicheBriefId: seeded.brief.id,
      originApprovalId: seeded.approval.id,
      budgetCapCents: 8500,
      status: "DRAFT"
    });
    expect(stages.map(({ stageType, status }) => ({ stageType, status }))).toEqual([
      { stageType: "RESEARCH", status: "COMPLETED" },
      { stageType: "HUB_SEARCH", status: "PENDING" }
    ]);
    expect(stages[0]?.completedAt).toEqual(seeded.researchRun.completedAt);
    expect(stages[1]?.estimatedRecords).toBe(
      (briefDocument.recommendedTestSize as number)
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      kind: "APPROVAL_DECIDED",
      approvalId: seeded.approval.id,
      campaignId: campaign.id
    });
    const envelope = JSON.parse(
      (outbox[0]!.envelopeJson as unknown as { body: string }).body
    ) as { data: { approvalId?: string; campaignId?: string; payload: Record<string, unknown> } };
    expect(envelope.data).toMatchObject({
      approvalId: seeded.approval.id,
      campaignId: campaign.id,
      payload: {
        approvalType: "NICHE_TEST",
        status: "approved",
        nicheRequestId: seeded.request.id,
        researchRunId: seeded.researchRun.id,
        nicheBriefId: seeded.brief.id,
        campaignId: campaign.id
      }
    });
  });

  it("replays an already-complete approval after process restart without duplicate campaign, stages, or outbox", async () => {
    const seeded = await seedNiche();
    const prisma = await db();
    await prisma.approval.update({
      where: { id: seeded.approval.id },
      data: { status: "approved", decidedBy: "usr_prior", decidedAt: new Date() }
    });

    const first = await decideApprovalWithSideEffects({
      workspaceId: seeded.workspaceId,
      approvalId: seeded.approval.id,
      decision: "approve",
      actorId: "usr_replay"
    });
    const replay = await decideApprovalWithSideEffects({
      workspaceId: seeded.workspaceId,
      approvalId: seeded.approval.id,
      decision: "approve",
      actorId: "usr_replay"
    });
    expect(first.outcome).toBe("already_final");
    expect(replay.campaignId).toBe(first.campaignId);
    expect(await prisma.campaign.count({ where: { originApprovalId: seeded.approval.id } })).toBe(1);
    expect(await prisma.campaignStageRun.count({ where: { campaignId: first.campaignId } })).toBe(2);
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: seeded.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(1);
  });

  it("treats repeated signed callback requests as one decision and one durable event", async () => {
    const seeded = await seedNiche();
    const context = { params: Promise.resolve({ id: seeded.approval.id }) };
    const first = await decideRoute(
      decisionRequest({
        workspaceId: seeded.workspaceId,
        approvalId: seeded.approval.id,
        actorId: "usr_slack"
      }),
      context
    );
    const replay = await decideRoute(
      decisionRequest({
        workspaceId: seeded.workspaceId,
        approvalId: seeded.approval.id,
        actorId: "usr_slack"
      }),
      context
    );
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await replay.json()).campaignId).toBe((await first.json()).campaignId);
    const prisma = await db();
    expect(await prisma.campaign.count({ where: { originApprovalId: seeded.approval.id } })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: seeded.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(1);
  });

  it("serializes concurrent final decisions with database locks and uniqueness constraints", async () => {
    const seeded = await seedNiche();
    const decisions = await Promise.all([
      decideApprovalWithSideEffects({
        workspaceId: seeded.workspaceId,
        approvalId: seeded.approval.id,
        decision: "approve",
        actorId: "usr_concurrent_a"
      }),
      decideApprovalWithSideEffects({
        workspaceId: seeded.workspaceId,
        approvalId: seeded.approval.id,
        decision: "approve",
        actorId: "usr_concurrent_b"
      })
    ]);
    expect(new Set(decisions.map((item) => item.campaignId)).size).toBe(1);
    const prisma = await db();
    expect(await prisma.campaign.count({ where: { originApprovalId: seeded.approval.id } })).toBe(1);
    expect(await prisma.campaignStageRun.count({ where: { campaignId: decisions[0]!.campaignId } })).toBe(2);
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: seeded.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(1);
  });

  it("retries a serialization conflict as a fresh transaction and still commits exactly once", async () => {
    const seeded = await seedNiche();
    let attempts = 0;
    const result = await decideApprovalWithSideEffects(
      {
        workspaceId: seeded.workspaceId,
        approvalId: seeded.approval.id,
        decision: "approve",
        actorId: "usr_retry"
      },
      {
        beforeCommit: () => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("injected serialization failure"), { code: "P2034" });
        }
      }
    );
    expect(attempts).toBe(2);
    const prisma = await db();
    expect(await prisma.campaign.count({ where: { originApprovalId: seeded.approval.id } })).toBe(1);
    expect(await prisma.campaignStageRun.count({ where: { campaignId: result.campaignId } })).toBe(2);
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: seeded.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(1);
  });

  it("enforces two distinct approvers before any campaign exists", async () => {
    const seeded = await seedNiche({ t2: 8500 });
    const prisma = await db();
    expect(await prisma.campaign.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);

    const first = await decideApprovalWithSideEffects({
      workspaceId: seeded.workspaceId,
      approvalId: seeded.approval.id,
      decision: "approve",
      actorId: "usr_first"
    });
    expect(first.outcome).toBe("awaiting_second_approver");
    expect(await prisma.campaign.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);

    const same = await decideApprovalWithSideEffects({
      workspaceId: seeded.workspaceId,
      approvalId: seeded.approval.id,
      decision: "approve",
      actorId: "usr_first"
    });
    expect(same.outcome).toBe("same_approver_twice");
    expect(await prisma.campaign.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);

    const second = await decideApprovalWithSideEffects({
      workspaceId: seeded.workspaceId,
      approvalId: seeded.approval.id,
      decision: "approve",
      actorId: "usr_second"
    });
    expect(second.outcome).toBe("decided");
    expect(await prisma.campaign.count({ where: { workspaceId: seeded.workspaceId } })).toBe(1);
    expect(await prisma.notifyOutbox.count({
      where: { workspaceId: seeded.workspaceId, kind: "APPROVAL_DECIDED" }
    })).toBe(1);
  });

  it("creates no campaign for pending, declined, or revised approvals", async () => {
    const pending = await seedNiche();
    const declined = await seedNiche();
    const revised = await seedNiche();
    await decideApprovalWithSideEffects({
      workspaceId: declined.workspaceId,
      approvalId: declined.approval.id,
      decision: "decline",
      actorId: "usr_decline"
    });
    const revision = await reviseApproval({
      workspaceId: revised.workspaceId,
      approvalId: revised.approval.id,
      payload: {
        ...(revised.approval.payloadJson as Record<string, unknown>),
        title: "Revised niche test"
      },
      actorId: "usr_reviser"
    });
    expect(revision.outcome).toBe("revised");

    const prisma = await db();
    for (const item of [pending, declined, revised]) {
      expect(await prisma.campaign.count({ where: { workspaceId: item.workspaceId } })).toBe(0);
    }
  });

  it("applies a final revised NICHE_TEST through the same brief and immutable approval chain", async () => {
    const seeded = await seedNiche();
    const revisedPayload = {
      ...(seeded.approval.payloadJson as Record<string, unknown>),
      title: "Approve revised ICP scope"
    };
    const revision = await reviseApproval({
      workspaceId: seeded.workspaceId,
      approvalId: seeded.approval.id,
      payload: revisedPayload,
      actorId: "usr_reviser"
    });
    expect(revision.outcome).toBe("revised");
    if (revision.outcome !== "revised") return;

    const prisma = await db();
    expect(await prisma.campaign.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);
    expect(
      (await prisma.nicheBrief.findUniqueOrThrow({ where: { id: seeded.brief.id } })).approvalId
    ).toBe(revision.created.id);

    const applied = await decideApprovalWithSideEffects({
      workspaceId: seeded.workspaceId,
      approvalId: revision.created.id,
      decision: "approve",
      actorId: "usr_revised_approver"
    });
    expect(applied.campaignId).toBeTruthy();
    expect(await prisma.campaign.count({ where: { workspaceId: seeded.workspaceId } })).toBe(1);
    expect(
      await prisma.approval.findUniqueOrThrow({ where: { id: seeded.approval.id } })
    ).toMatchObject({ status: "superseded", payloadSha256: seeded.approval.payloadSha256 });
  });

  it("creates no campaign for expired or superseded approvals", async () => {
    const expired = await seedNiche();
    const superseded = await seedNiche();
    const prisma = await db();
    await prisma.approval.update({
      where: { id: expired.approval.id },
      data: { expiresAt: new Date("2026-01-01T00:00:00.000Z") }
    });
    await prisma.approval.update({
      where: { id: superseded.approval.id },
      data: { status: "superseded" }
    });

    await expectApplicationError(
      decideApprovalWithSideEffects(
        {
          workspaceId: expired.workspaceId,
          approvalId: expired.approval.id,
          decision: "approve",
          actorId: "usr_late"
        },
        { now: new Date("2026-07-29T00:00:00.000Z") }
      ),
      "APPROVAL_EXPIRED"
    );
    const final = await decideApprovalWithSideEffects({
      workspaceId: superseded.workspaceId,
      approvalId: superseded.approval.id,
      decision: "approve",
      actorId: "usr_superseded"
    });
    expect(final.outcome).toBe("already_final");
    expect(await prisma.campaign.count({
      where: { workspaceId: { in: [expired.workspaceId, superseded.workspaceId] } }
    })).toBe(0);
  });

  it("rejects invalid Contracts payloads and invalid canonical hashes without changing the approval", async () => {
    const invalidPayload = await seedNiche();
    const invalidHash = await seedNiche();
    const prisma = await db();
    await prisma.approval.update({
      where: { id: invalidPayload.approval.id },
      data: { payloadJson: { type: "NICHE_TEST" } }
    });
    await prisma.approval.update({
      where: { id: invalidHash.approval.id },
      data: { payloadSha256: "0".repeat(64) }
    });
    await expectApplicationError(
      decideApprovalWithSideEffects({
        workspaceId: invalidPayload.workspaceId,
        approvalId: invalidPayload.approval.id,
        decision: "approve",
        actorId: "usr_bad_payload"
      }),
      "INVALID_APPROVAL_PAYLOAD"
    );
    await expectApplicationError(
      decideApprovalWithSideEffects({
        workspaceId: invalidHash.workspaceId,
        approvalId: invalidHash.approval.id,
        decision: "approve",
        actorId: "usr_bad_hash"
      }),
      "INVALID_APPROVAL_HASH"
    );
    expect(await prisma.approval.count({
      where: {
        id: { in: [invalidPayload.approval.id, invalidHash.approval.id] },
        status: "pending"
      }
    })).toBe(2);
    expect(await prisma.campaign.count({
      where: { workspaceId: { in: [invalidPayload.workspaceId, invalidHash.workspaceId] } }
    })).toBe(0);
  });

  it("rejects missing and cross-workspace linked records, and ignores non-NICHE_TEST side effects", async () => {
    const missingWorkspace = await createWorkspace();
    const missingPayload = {
      type: "NICHE_TEST" as const,
      title: "Missing brief",
      summary: "This payload points to a missing brief.",
      estimatedCostCents: 8500,
      nicheRequestId: "nr_missing",
      nicheBriefId: "nb_missing",
      brief: briefDocument
    };
    const missing = await createApproval({
      workspaceId: missingWorkspace,
      payload: missingPayload,
      requestedBy: "usr_requester",
      idempotencyKey: `missing-brief:${missingWorkspace}`
    });

    const foreign = await seedNiche();
    const localWorkspace = await createWorkspace();
    const cross = await createApproval({
      workspaceId: localWorkspace,
      payload: foreign.approval.payloadJson,
      requestedBy: "usr_requester",
      idempotencyKey: `cross-workspace:${localWorkspace}`
    });
    const other = await createApproval({
      workspaceId: localWorkspace,
      payload: {
        type: "SUPPRESS_BULK",
        title: "Suppress bounced records",
        summary: "No campaign should be created for this gate.",
        recordCount: 12,
        reason: "hard bounce"
      },
      requestedBy: "usr_requester",
      idempotencyKey: `non-niche:${localWorkspace}`
    });

    await expectApplicationError(
      decideApprovalWithSideEffects({
        workspaceId: missingWorkspace,
        approvalId: missing.id,
        decision: "approve",
        actorId: "usr_missing"
      }),
      "MISSING_NICHE_BRIEF"
    );
    await expectApplicationError(
      decideApprovalWithSideEffects({
        workspaceId: localWorkspace,
        approvalId: cross.id,
        decision: "approve",
        actorId: "usr_cross"
      }),
      "CROSS_WORKSPACE_APPROVAL_CHAIN"
    );
    const otherResult = await decideApprovalWithSideEffects({
      workspaceId: localWorkspace,
      approvalId: other.id,
      decision: "approve",
      actorId: "usr_other"
    });
    expect(otherResult.outcome).toBe("decided");
    const prisma = await db();
    expect(await prisma.campaign.count({
      where: { workspaceId: { in: [missingWorkspace, localWorkspace] } }
    })).toBe(0);
  });

  it("rolls back the decision, brief, campaign, stages, and outbox after an injected pre-commit failure", async () => {
    const seeded = await seedNiche();
    await expect(
      decideApprovalWithSideEffects(
        {
          workspaceId: seeded.workspaceId,
          approvalId: seeded.approval.id,
          decision: "approve",
          actorId: "usr_failure"
        },
        { beforeCommit: () => { throw new Error("injected before commit"); } }
      )
    ).rejects.toThrow("injected before commit");

    const prisma = await db();
    expect(await prisma.approval.findUniqueOrThrow({ where: { id: seeded.approval.id } })).toMatchObject({
      status: "pending",
      campaignId: null,
      sideEffectsAppliedAt: null
    });
    expect((await prisma.nicheBrief.findUniqueOrThrow({ where: { id: seeded.brief.id } })).status).toBe(
      "pending_approval"
    );
    expect(await prisma.campaign.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);
    expect(await prisma.campaignStageRun.count({ where: { workspaceId: seeded.workspaceId } })).toBe(0);
    expect(await prisma.notifyOutbox.count({
      where: { workspaceId: seeded.workspaceId, kind: "APPROVAL_DECIDED" }
    })).toBe(0);
    expect(await prisma.notifyOutbox.count({
      where: { workspaceId: seeded.workspaceId, kind: "APPROVAL_REQUESTED" }
    })).toBe(1);
  });

  it("survives a legacy projection cleanup because all new records remain Prisma-native", async () => {
    const { createSeedState } = await import("@/lib/phase1/seed");
    const { syncNormalizedProjectionToPrisma } = await import("@/lib/phase1/persistence-projection");
    const prisma = await db();
    const state = createSeedState();
    await syncNormalizedProjectionToPrisma(state, prisma as never);
    const workspaceId = state.workspaces[0]!.id;
    const seeded = await seedNiche({ workspaceId });
    const applied = await decideApprovalWithSideEffects({
      workspaceId,
      approvalId: seeded.approval.id,
      decision: "approve",
      actorId: "usr_projection"
    });

    await syncNormalizedProjectionToPrisma(state, prisma as never);
    expect(await prisma.approval.count({ where: { id: seeded.approval.id } })).toBe(1);
    expect(await prisma.nicheBrief.count({ where: { id: seeded.brief.id } })).toBe(1);
    expect(await prisma.campaign.count({ where: { id: applied.campaignId } })).toBe(1);
    expect(await prisma.campaignStageRun.count({ where: { campaignId: applied.campaignId } })).toBe(2);
    expect(await prisma.notifyOutbox.count({
      where: { approvalId: seeded.approval.id, kind: "APPROVAL_DECIDED" }
    })).toBe(1);

    // Do not delete the shared seeded workspace; remove only this native chain.
    await prisma.notifyOutbox.deleteMany({ where: { approvalId: seeded.approval.id } });
    await prisma.campaign.deleteMany({ where: { id: applied.campaignId } });
    await prisma.nicheRequest.deleteMany({ where: { id: seeded.request.id } });
  });
});

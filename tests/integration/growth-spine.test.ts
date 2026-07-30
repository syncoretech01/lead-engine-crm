import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApproval,
  decideApproval,
  reviseApproval
} from "@/lib/growth/repositories/approval-repository";
import {
  confirmNicheRequest,
  createNicheRequest,
  listNicheRequests
} from "@/lib/growth/repositories/niche-request-repository";
import {
  claimNextResearchRun,
  completeResearchRun,
  enqueueResearchRun
} from "@/lib/growth/repositories/research-run-repository";
import {
  ResearchNotCompleteError,
  createNicheBriefWithApproval,
  markNicheBriefApproved
} from "@/lib/growth/repositories/niche-brief-repository";
import {
  createCampaign,
  createStageRun,
  listStageRuns,
  transitionStageRun
} from "@/lib/growth/repositories/campaign-repository";
import { IllegalStageRunTransitionError } from "@/lib/growth/stage-run-transitions";

/**
 * The CRM-1 spine against real Postgres.
 *
 * The unit lane drives these repositories through an in-memory stand-in, which
 * proves the logic but not the schema. This proves the schema: required FKs,
 * enum values, composite indexes, cascade behaviour and — the one that matters
 * most — that `workspaceId` in every `where` actually isolates tenants.
 *
 * Only runs when SYNCORE_RUN_DB_INTEGRATION=1 (CI `integration` job /
 * docker-compose.dev.yml), so the unit lane still needs no database.
 */
const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";

const require = createRequire(import.meta.url);
const briefDocument = JSON.parse(
  readFileSync(
    require.resolve("@syncore/contracts/fixtures/research/niche-brief-document.json"),
    "utf8"
  )
) as Record<string, unknown>;

const payload = {
  niche: "Dump Truck Rentals",
  geography: "Texas",
  serviceToPitch: ["Meta Ads"],
  hypothesis: "Owner-operators lose inbound to a weak mobile quote flow.",
  exclusions: [],
  testSizeHint: 300,
  budgetHintCents: 8500
};

const ids = { a: `ws_growth_a_${Date.now()}`, b: `ws_growth_b_${Date.now()}` };

async function db() {
  return (await import("@/lib/prisma")).prisma;
}

/**
 * Drive one request all the way to an approved brief.
 *
 * ⚠️ `claimNextResearchRun` is deliberately GLOBAL — it claims the oldest queued
 * run across all workspaces, because the Console Agent is one local machine
 * serving the operator, not a per-tenant worker. That makes the queue shared
 * state, so a test that leaves a run queued changes what the next test claims.
 * Every helper below therefore consumes exactly the run it enqueues, and the
 * rejection test cleans up after itself.
 */
async function seedApprovedBrief(workspaceId: string) {
  const request = await createNicheRequest({
    workspaceId,
    createdBy: "usr_1",
    sourceChannel: "slack",
    structuredPayload: payload
  });
  await confirmNicheRequest({ workspaceId, nicheRequestId: request.id });
  const run = await enqueueResearchRun({ workspaceId, nicheRequestId: request.id });

  const claimed = await claimNextResearchRun({ consoleAgentId: "agent_1" });
  if (claimed?.id !== run.id) {
    throw new Error(
      `Queue leak: claimed ${claimed?.id ?? "nothing"} but enqueued ${run.id}. ` +
        "A previous test left a queued run behind."
    );
  }

  await completeResearchRun({ workspaceId, researchRunId: run.id, warnings: [] });
  const { brief, approval } = await createNicheBriefWithApproval({
    workspaceId,
    researchRunId: run.id,
    document: briefDocument,
    requestedBy: "usr_1"
  });
  return { request, run, brief, approval };
}

/** An approved brief plus the campaign it justifies. */
async function seedCampaign(workspaceId: string) {
  const seeded = await seedApprovedBrief(workspaceId);
  await markNicheBriefApproved({ workspaceId, nicheBriefId: seeded.brief.id });
  const campaign = await createCampaign({
    workspaceId,
    nicheBriefId: seeded.brief.id,
    createdBy: "usr_1",
    budgetCapCents: 8500
  });
  return { ...seeded, campaign };
}

describe.skipIf(!enabled)("growth spine (real Postgres)", () => {
  beforeAll(() => {
    process.env.SYNCORE_BOT_NOTIFY_SECRET = "integration-notify-secret";
    process.env.SYNCORE_BOT_NOTIFY_URL = "https://bot.example.test/notify";
  });

  afterAll(async () => {
    if (!enabled) return;
    const prisma = await db();
    // Cascades clear every Growth OS row for these workspaces.
    await prisma.workspace.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
  });

  it("sets up two workspaces", async () => {
    const prisma = await db();
    for (const id of [ids.a, ids.b]) {
      await prisma.workspace.upsert({
        where: { id },
        create: { id, name: `Growth test ${id}`, approvalThresholdT2Cents: null },
        update: {}
      });
    }
    expect(await prisma.workspace.count({ where: { id: { in: [ids.a, ids.b] } } })).toBe(2);
  });

  it("refuses a brief before its research run completes", async () => {
    const request = await createNicheRequest({
      workspaceId: ids.a,
      createdBy: "usr_1",
      sourceChannel: "slack",
      structuredPayload: payload
    });
    await confirmNicheRequest({ workspaceId: ids.a, nicheRequestId: request.id });
    const run = await enqueueResearchRun({ workspaceId: ids.a, nicheRequestId: request.id });

    // queued — not completed
    await expect(
      createNicheBriefWithApproval({
        workspaceId: ids.a,
        researchRunId: run.id,
        document: briefDocument,
        requestedBy: "usr_1"
      })
    ).rejects.toThrow(ResearchNotCompleteError);

    // ...and crucially no NICHE_TEST approval was created as a side effect.
    const prisma = await db();
    expect(
      await prisma.approval.count({ where: { workspaceId: ids.a, type: "NICHE_TEST" } })
    ).toBe(0);
    expect(await prisma.nicheBrief.count({ where: { workspaceId: ids.a } })).toBe(0);

    // Consume the run: the claim queue is global, so leaving this queued would
    // change what the next test claims. (This is how the suite first went red.)
    await prisma.researchRun.delete({ where: { id: run.id } });
    await prisma.nicheRequest.delete({ where: { id: request.id } });
  });

  it("runs the full spine: request → research → brief → approval → campaign → stage run", async () => {
    const prisma = await db();

    const request = await createNicheRequest({
      workspaceId: ids.a,
      createdBy: "usr_1",
      sourceChannel: "slack",
      structuredPayload: payload
    });
    expect(request.status).toBe("draft");

    expect(await confirmNicheRequest({ workspaceId: ids.a, nicheRequestId: request.id })).toBe(true);

    const run = await enqueueResearchRun({ workspaceId: ids.a, nicheRequestId: request.id });
    expect(run.status).toBe("queued");
    expect(
      (await prisma.nicheRequest.findUnique({ where: { id: request.id } }))?.status
    ).toBe("researching");

    const claimed = await claimNextResearchRun({ consoleAgentId: "agent_1" });
    expect(claimed?.status).toBe("running");
    // The claim is global FIFO; assert we got OUR run rather than a leftover.
    expect(claimed?.id).toBe(run.id);

    expect(
      await completeResearchRun({
        workspaceId: ids.a,
        researchRunId: run.id,
        warnings: []
      })
    ).toBe(true);

    const { brief, approval } = await createNicheBriefWithApproval({
      workspaceId: ids.a,
      researchRunId: run.id,
      document: briefDocument,
      requestedBy: "usr_1"
    });

    expect(brief.status).toBe("pending_approval");
    expect(brief.researchRunId).toBe(run.id);
    expect(approval.type).toBe("NICHE_TEST");
    expect(approval.status).toBe("pending");
    expect(approval.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    // The request only reaches `briefed` once a brief actually exists.
    expect((await prisma.nicheRequest.findUnique({ where: { id: request.id } }))?.status).toBe(
      "briefed"
    );

    const decided = await decideApproval({
      workspaceId: ids.a,
      approvalId: approval.id,
      decision: "approve",
      actorId: "usr_2"
    });
    expect(decided.outcome).toBe("decided");

    expect(await markNicheBriefApproved({ workspaceId: ids.a, nicheBriefId: brief.id })).toBe(true);

    const campaign = await createCampaign({
      workspaceId: ids.a,
      nicheBriefId: brief.id,
      createdBy: "usr_1",
      budgetCapCents: 8500
    });
    expect(campaign.status).toBe("DRAFT");
    expect(campaign.spendWarnThresholdPct).toBe(80);
    expect(campaign.overrunTolerancePct).toBe(20);

    const stage = await createStageRun({
      workspaceId: ids.a,
      campaignId: campaign.id,
      stageType: "HUB_SEARCH"
    });
    expect(stage.status).toBe("PENDING");

    // A free stage goes straight to RUNNING — no gate (see stage-run-transitions).
    const running = await transitionStageRun({
      workspaceId: ids.a,
      stageRunId: stage.id,
      to: "RUNNING"
    });
    expect(running?.status).toBe("RUNNING");
    expect(running?.startedAt).toBeInstanceOf(Date);

    const done = await transitionStageRun({
      workspaceId: ids.a,
      stageRunId: stage.id,
      to: "COMPLETED",
      outputRecords: 250
    });
    expect(done?.status).toBe("COMPLETED");
    expect(done?.outputRecords).toBe(250);
  });

  it("refuses a campaign from an unapproved brief", async () => {
    // Seeded, but deliberately NOT approved.
    const { brief } = await seedApprovedBrief(ids.a);

    await expect(
      createCampaign({
        workspaceId: ids.a,
        nicheBriefId: brief.id,
        createdBy: "usr_1",
        budgetCapCents: 100
      })
    ).rejects.toThrow(/approved brief/);
  });

  it("rejects an illegal stage transition at the repository layer", async () => {
    const prisma = await db();
    const { campaign } = await seedCampaign(ids.a);
    const stage = await createStageRun({
      workspaceId: ids.a,
      campaignId: campaign.id,
      stageType: "SCAN"
    });

    await expect(
      transitionStageRun({ workspaceId: ids.a, stageRunId: stage.id, to: "COMPLETED" })
    ).rejects.toThrow(IllegalStageRunTransitionError);

    // ...and the row is untouched.
    expect((await prisma.campaignStageRun.findUnique({ where: { id: stage.id } }))?.status).toBe(
      "PENDING"
    );
  });

  it("produces a revision chain with a fresh hash", async () => {
    const prisma = await db();
    const payloadV1 = {
      type: "SUPPRESS_BULK" as const,
      title: "Suppress a bounced batch",
      summary: "412 addresses bounced on the last send.",
      recordCount: 412,
      reason: "hard bounce"
    };
    const original = await createApproval({
      workspaceId: ids.a,
      payload: payloadV1,
      requestedBy: "usr_1",
      idempotencyKey: `growth-spine-revision:${ids.a}`
    });

    const revised = await reviseApproval({
      workspaceId: ids.a,
      approvalId: original.id,
      payload: { ...payloadV1, recordCount: 400, summary: "400 after re-check." },
      actorId: "usr_2"
    });

    expect(revised.outcome).toBe("revised");
    if (revised.outcome !== "revised") return;
    expect(revised.superseded.status).toBe("superseded");
    expect(revised.created.supersedesApprovalId).toBe(original.id);
    expect(revised.created.payloadSha256).not.toBe(original.payloadSha256);

    // The chain is navigable in both directions through the self-relation.
    const withSuccessor = await prisma.approval.findUnique({
      where: { id: original.id },
      include: { supersededBy: true }
    });
    expect(withSuccessor?.supersededBy?.id).toBe(revised.created.id);
  });

  it("isolates tenants — a two-workspace roundtrip returns zero cross-tenant rows", async () => {
    const prisma = await db();

    const requestB = await createNicheRequest({
      workspaceId: ids.b,
      createdBy: "usr_b",
      sourceChannel: "slack",
      structuredPayload: payload
    });

    // Workspace A's listing never sees B's row, and vice versa.
    const listA = await listNicheRequests({ workspaceId: ids.a, pageSize: 200 });
    const listB = await listNicheRequests({ workspaceId: ids.b, pageSize: 200 });
    expect(listA.rows.map((r) => r.id)).not.toContain(requestB.id);
    expect(listB.rows.map((r) => r.id)).toEqual([requestB.id]);

    // Cross-tenant writes do not reach across either.
    expect(
      await confirmNicheRequest({ workspaceId: ids.a, nicheRequestId: requestB.id })
    ).toBe(false);

    const approvalA = await prisma.approval.findFirst({ where: { workspaceId: ids.a } });
    expect(
      (
        await decideApproval({
          workspaceId: ids.b,
          approvalId: approvalA!.id,
          decision: "approve",
          actorId: "usr_b"
        })
      ).outcome
    ).toBe("not_found");

    // The blunt version of the same claim: every Growth OS table, scoped to B,
    // contains nothing belonging to A.
    for (const [table, count] of [
      ["nicheBrief", await prisma.nicheBrief.count({ where: { workspaceId: ids.b } })],
      ["campaign", await prisma.campaign.count({ where: { workspaceId: ids.b } })],
      ["campaignStageRun", await prisma.campaignStageRun.count({ where: { workspaceId: ids.b } })],
      ["approval", await prisma.approval.count({ where: { workspaceId: ids.b } })]
    ] as const) {
      expect(count, `${table} leaked into workspace B`).toBe(0);
    }
  });

  it("paginates rather than capping", async () => {
    const prisma = await db();
    const { campaign } = await seedCampaign(ids.a);
    for (let i = 0; i < 5; i += 1) {
      await createStageRun({
        workspaceId: ids.a,
        campaignId: campaign.id,
        stageType: "TIERING"
      });
    }

    const first = await listStageRuns({
      workspaceId: ids.a,
      campaignId: campaign.id,
      pageSize: 2
    });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listStageRuns({
      workspaceId: ids.a,
      campaignId: campaign.id,
      pageSize: 2,
      cursor: first.nextCursor!
    });
    expect(second.rows).toHaveLength(2);
    // Pages do not overlap.
    expect(second.rows.map((r) => r.id)).not.toEqual(first.rows.map((r) => r.id));

    // Walking to the end yields a null cursor rather than a silent truncation.
    let cursor: string | null = null;
    let seen = 0;
    do {
      const page: { rows: { id: string }[]; nextCursor: string | null } = await listStageRuns({
        workspaceId: ids.a,
        campaignId: campaign.id,
        pageSize: 3,
        cursor: cursor ?? undefined
      });
      seen += page.rows.length;
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toBe(
      await prisma.campaignStageRun.count({
        where: { workspaceId: ids.a, campaignId: campaign.id }
      })
    );
  });
});


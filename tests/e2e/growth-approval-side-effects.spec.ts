import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashApprovalPayload } from "../../lib/growth/approval-hash";

const prisma = new PrismaClient();
const workspaceId = `ws_growth_e2e_apply_${Date.now()}`;
const requestId = `nr_growth_e2e_apply_${Date.now()}`;
const researchRunId = `rr_growth_e2e_apply_${Date.now()}`;
const nicheBriefId = `nb_growth_e2e_apply_${Date.now()}`;
const approvalId = `apr_growth_e2e_apply_${Date.now()}`;

const brief = {
  version: "1.0",
  niche: "Dump Truck Rentals",
  geography: "Texas",
  buyerRole: "Owner-operator",
  mainPains: ["Weak mobile quote flow"],
  serviceFit: "Lead capture optimization",
  recommendedOffer: "Meta Ads plus landing-page audit",
  outreachAngles: ["Recover missed mobile quote requests"],
  auditType: "lead-capture",
  priorityScore: 82,
  decision: "TEST" as const,
  recommendedTestSize: 300,
  estimatedCostCents: 8500,
  sources: [],
  consoleProjectId: "dump-truck-rentals-texas-20260729-120000",
  generatedAt: "2026-07-29T12:00:00.000Z"
};

const approvalPayload = {
  type: "NICHE_TEST" as const,
  title: "Approve ICP: Dump Truck Rentals / Texas",
  summary: "Research scored this niche 82/100 and recommends a 300-company test.",
  estimatedCostCents: 8500,
  nicheRequestId: requestId,
  nicheBriefId,
  brief
};

test.describe("Growth OS — NICHE_TEST approval application", () => {
  test.beforeAll(async () => {
    await prisma.$transaction([
      prisma.workspace.create({ data: { id: workspaceId, name: "Growth approval E2E" } }),
      prisma.nicheRequest.create({
        data: {
          id: requestId,
          workspaceId,
          createdBy: "usr_e2e_requester",
          sourceChannel: "slack",
          status: "briefed",
          researchRunId,
          structuredPayload: {
            niche: "Dump Truck Rentals",
            geography: "Texas",
            serviceToPitch: ["Meta Ads"],
            hypothesis: "Weak mobile quote flow",
            exclusions: [],
            testSizeHint: 300,
            budgetHintCents: 8500
          }
        }
      })
    ]);
    await prisma.researchRun.create({
      data: {
        id: researchRunId,
        workspaceId,
        nicheRequestId: requestId,
        nicheBriefId,
        status: "completed",
        progress: 1,
        completedAt: new Date("2026-07-29T12:00:00.000Z")
      }
    });
    await prisma.approval.create({
      data: {
        id: approvalId,
        workspaceId,
        type: "NICHE_TEST",
        payloadJson: approvalPayload,
        payloadSha256: hashApprovalPayload(approvalPayload),
        status: "pending",
        requestedBy: "usr_e2e_requester"
      }
    });
    await prisma.nicheBrief.create({
      data: {
        id: nicheBriefId,
        workspaceId,
        nicheRequestId: requestId,
        researchRunId,
        approvalId,
        document: brief,
        status: "pending_approval"
      }
    });
  });

  test.afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.$disconnect();
  });

  test("a repeated signed decision request creates one campaign and one outbox event", async ({
    request
  }) => {
    const headers = {
      authorization: `Bearer ${process.env.SYNCORE_CHAT_API_TOKEN}`,
      "x-syncore-actor-id": "usr_e2e_approver",
      "x-syncore-workspace-id": workspaceId
    };
    const data = { approvalId, decision: "approve" };
    const first = await request.post(`/api/approvals/${approvalId}/decide`, { headers, data });
    const replay = await request.post(`/api/approvals/${approvalId}/decide`, { headers, data });
    const firstBody = (await first.json()) as { campaignId?: string; status: string };
    const replayBody = (await replay.json()) as { campaignId?: string; status: string };
    expect(first.status(), JSON.stringify(firstBody)).toBe(200);
    expect(replay.status(), JSON.stringify(replayBody)).toBe(200);
    expect(firstBody).toMatchObject({ status: "approved" });
    expect(replayBody.campaignId).toBe(firstBody.campaignId);

    expect(await prisma.campaign.count({ where: { originApprovalId: approvalId } })).toBe(1);
    expect(await prisma.campaignStageRun.findMany({
      where: { campaignId: firstBody.campaignId },
      select: { stageType: true, status: true },
      orderBy: { createdAt: "asc" }
    })).toEqual([
      { stageType: "RESEARCH", status: "COMPLETED" },
      { stageType: "HUB_SEARCH", status: "PENDING" }
    ]);
    expect(await prisma.notifyOutbox.count({ where: { approvalId } })).toBe(1);
  });
});

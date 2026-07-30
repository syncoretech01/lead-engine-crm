import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FinancialEventKind, type PrismaClient } from "@prisma/client";
import {
  FinancialLedgerValidationError,
  FinancialReplayConflictError,
  MixedFinancialCurrencyError,
  calculateCampaignFinancialTotals,
  calculateCostActionTotals,
  calculateStageFinancialTotals,
  recordActual,
  recordAdjustment,
  recordAuthorization,
  recordEstimate,
  recordReversal,
  type FinancialEventCommand
} from "@/lib/growth/repositories/financial-ledger-repository";
import {
  campaignSpendCents,
  listCostEntries,
  stageRunSpendCents
} from "@/lib/growth/read-models/cost-ledger";

const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";
const token = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const ids = {
  workspaceA: `ws_fin_a_${token}`,
  workspaceB: `ws_fin_b_${token}`,
  workspacePage: `ws_fin_page_${token}`
};

let sequence = 0;
let prisma: PrismaClient;
let campaignA: string;
let campaignA2: string;
let stageA: string;
let stageA2: string;
let approvalA: string;
let researchA: string;
let campaignB: string;
let stageB: string;
let approvalB: string;
let researchB: string;
let providerJobA: string;
let providerRunA: string;
let evidenceA: string;
let providerJobB: string;
let providerRunB: string;
let evidenceB: string;

async function seedGrowthGraph(workspaceId: string, suffix: string) {
  const request = await prisma.nicheRequest.create({
    data: {
      id: `nreq_${suffix}_${token}`,
      workspaceId,
      createdBy: "ledger-test",
      sourceChannel: "dashboard",
      structuredPayload: {},
      status: "briefed"
    }
  });
  const run = await prisma.researchRun.create({
    data: {
      id: `rrun_${suffix}_${token}`,
      workspaceId,
      nicheRequestId: request.id,
      status: "completed",
      progress: 1,
      completedAt: new Date()
    }
  });
  const brief = await prisma.nicheBrief.create({
    data: {
      id: `brief_${suffix}_${token}`,
      workspaceId,
      nicheRequestId: request.id,
      researchRunId: run.id,
      document: {},
      status: "approved"
    }
  });
  const campaign = await prisma.campaign.create({
    data: {
      id: `campaign_${suffix}_${token}`,
      workspaceId,
      nicheBriefId: brief.id,
      budgetCapCents: 100_000,
      createdBy: "ledger-test"
    }
  });
  const stage = await prisma.campaignStageRun.create({
    data: {
      id: `stage_${suffix}_${token}`,
      workspaceId,
      campaignId: campaign.id,
      stageType: "HUB_SEARCH"
    }
  });
  const approval = await prisma.approval.create({
    data: {
      id: `approval_${suffix}_${token}`,
      workspaceId,
      campaignId: campaign.id,
      stageRunId: stage.id,
      type: "PROVIDER_RUN",
      payloadJson: {},
      payloadSha256: "a".repeat(64),
      requestedBy: "ledger-test"
    }
  });
  return { run, campaign, stage, approval };
}

async function seedProviderGraph(workspaceId: string, suffix: string) {
  const connection = await prisma.providerConnection.create({
    data: {
      id: `connection_${suffix}_${token}`,
      workspaceId,
      providerId: "apollo",
      displayName: "Apollo test",
      status: "Connected",
      categories: ["data"],
      capabilities: ["search"],
      scopes: [],
      allowedOperations: ["search"]
    }
  });
  const job = await prisma.providerJob.create({
    data: {
      id: `provider_job_${suffix}_${token}`,
      workspaceId,
      providerConnectionId: connection.id,
      providerId: "apollo",
      operation: "search",
      status: "completed",
      idempotencyKey: `provider-job-${suffix}-${token}`,
      requestHash: "b".repeat(64),
      inputSummary: {},
      queuedAt: new Date()
    }
  });
  const run = await prisma.providerJobRun.create({
    data: {
      id: `provider_run_${suffix}_${token}`,
      workspaceId,
      providerJobId: job.id,
      providerConnectionId: connection.id,
      providerId: "apollo",
      operation: "search",
      status: "completed",
      idempotencyKey: `provider-run-${suffix}-${token}`,
      providerRequestId: `request-${suffix}-${token}`
    }
  });
  const evidence = await prisma.providerUsageLedger.create({
    data: {
      id: `provider_evidence_${suffix}_${token}`,
      workspaceId,
      provider: "apollo",
      operation: "search",
      providerJobId: job.id,
      providerJobRunId: run.id,
      unitsUsed: 1,
      unitCostCents: 25,
      totalCostCents: 25,
      currency: "USD",
      amountKind: "Actual",
      rawProviderMetadata: { providerRequestId: run.providerRequestId }
    }
  });
  return { job, run, evidence };
}

function command(overrides: Partial<FinancialEventCommand> = {}): FinancialEventCommand {
  sequence += 1;
  const identity = `financial-${token}-${sequence}`;
  return {
    workspaceId: ids.workspaceA,
    campaignId: campaignA,
    stageRunId: stageA,
    approvalId: approvalA,
    researchRunId: researchA,
    service: "research_console",
    action: "research",
    costActionKey: identity,
    idempotencyKey: identity,
    sourceSystem: "growth-financial-integration",
    sourceEventId: identity,
    occurredAt: new Date(),
    currency: "USD",
    amountCents: 10,
    metadata: { correlationId: identity },
    ...overrides
  };
}

describe.skipIf(!enabled)("Growth financial ledger foundation (real PostgreSQL)", () => {
  beforeAll(async () => {
    prisma = (await import("@/lib/prisma")).prisma;
    await prisma.workspace.createMany({
      data: [
        { id: ids.workspaceA, name: "Financial A" },
        { id: ids.workspaceB, name: "Financial B" },
        { id: ids.workspacePage, name: "Financial pagination" }
      ]
    });
    const a = await seedGrowthGraph(ids.workspaceA, "a");
    campaignA = a.campaign.id;
    stageA = a.stage.id;
    approvalA = a.approval.id;
    researchA = a.run.id;
    const a2 = await seedGrowthGraph(ids.workspaceA, "a2");
    campaignA2 = a2.campaign.id;
    stageA2 = a2.stage.id;
    const b = await seedGrowthGraph(ids.workspaceB, "b");
    campaignB = b.campaign.id;
    stageB = b.stage.id;
    approvalB = b.approval.id;
    researchB = b.run.id;
    const providerA = await seedProviderGraph(ids.workspaceA, "a");
    providerJobA = providerA.job.id;
    providerRunA = providerA.run.id;
    evidenceA = providerA.evidence.id;
    const providerB = await seedProviderGraph(ids.workspaceB, "b");
    providerJobB = providerB.job.id;
    providerRunB = providerB.run.id;
    evidenceB = providerB.evidence.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.workspace.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it("records estimates, authorizations, partial actuals, adjustments, and reversals as separate facts", async () => {
    const action = `flow-${token}`;
    const estimate = await recordEstimate(command({ costActionKey: action, amountCents: 100 }), prisma);
    const authorization = await recordAuthorization(
      {
        ...command({
        costActionKey: action,
        amountCents: 90
        }),
        authorizationSource: "approval",
        authorizationId: approvalA
      },
      prisma
    );
    const sourceEventId = `partial-${token}`;
    const actualOne = await recordActual(
      command({ costActionKey: action, sourceEventId, sourceLineId: "line-1", amountCents: 40 }),
      prisma
    );
    const actualTwo = await recordActual(
      command({ costActionKey: action, sourceEventId, sourceLineId: "line-2", amountCents: 20 }),
      prisma
    );
    expect([estimate.eventKind, authorization.eventKind, actualOne.eventKind, actualTwo.eventKind]).toEqual([
      "ESTIMATE",
      "AUTHORIZATION",
      "ACTUAL",
      "ACTUAL"
    ]);
    expect((await calculateCostActionTotals({ workspaceId: ids.workspaceA, costActionKey: action }, prisma))).toEqual({
      currency: "USD",
      estimatedCents: 100,
      authorizedCents: 90,
      actualCents: 60
    });

    const adjustment = await recordAdjustment(
      {
        workspaceId: ids.workspaceA,
        idempotencyKey: `adjust-${token}`,
        sourceSystem: "growth-financial-integration",
        sourceEventId: `adjust-${token}`,
        occurredAt: new Date(),
        adjustsCostEntryId: actualOne.id,
        amountCents: -5
      },
      prisma
    );
    const reversal = await recordReversal(
      {
        workspaceId: ids.workspaceA,
        idempotencyKey: `reverse-${token}`,
        sourceSystem: "growth-financial-integration",
        sourceEventId: `reverse-${token}`,
        occurredAt: new Date(),
        reversesCostEntryId: actualTwo.id
      },
      prisma
    );
    expect(adjustment.eventKind).toBe("ADJUSTMENT");
    expect(reversal.eventKind).toBe("REVERSAL");
    expect((await calculateCostActionTotals({ workspaceId: ids.workspaceA, costActionKey: action }, prisma)).actualCents).toBe(35);
    expect((await calculateCampaignFinancialTotals({ workspaceId: ids.workspaceA, campaignId: campaignA }, prisma)).actualCents).toBe(35);
    expect((await calculateStageFinancialTotals({ workspaceId: ids.workspaceA, stageRunId: stageA }, prisma)).actualCents).toBe(35);
    expect(await campaignSpendCents({ workspaceId: ids.workspaceA, campaignId: campaignA }, prisma)).toBe(35);
    expect(await stageRunSpendCents({ workspaceId: ids.workspaceA, stageRunId: stageA }, prisma)).toBe(35);
    const cache = await prisma.campaignStageRun.findUnique({ where: { id: stageA } });
    expect(cache?.actualCostCents).toBe(0);
  });

  it("returns identical command and source replays, including process/worker/lost-ack retries", async () => {
    const original = command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: `replay-${token}` });
    const first = await recordActual(original, prisma);
    const commandReplay = await recordActual(original, prisma);
    const sourceReplay = await recordActual(
      { ...original, idempotencyKey: `${original.idempotencyKey}-new-transport` },
      prisma
    );
    expect(commandReplay.id).toBe(first.id);
    expect(sourceReplay.id).toBe(first.id);
    expect(await prisma.costEntry.count({ where: { costActionKey: original.costActionKey } })).toBe(1);
  });

  it("rejects conflicting command/source reuse and cannot rewrite one event kind as another", async () => {
    const original = command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: `conflict-${token}` });
    await recordEstimate(original, prisma);
    await expect(recordEstimate({ ...original, amountCents: 999 }, prisma)).rejects.toBeInstanceOf(FinancialReplayConflictError);
    await expect(recordActual(original, prisma)).rejects.toBeInstanceOf(FinancialReplayConflictError);
    const sourceConflict = command({
      campaignId: campaignA2,
      stageRunId: stageA2,
      costActionKey: `source-conflict-${token}`,
      sourceEventId: original.sourceEventId,
      amountCents: 77
    });
    await expect(recordEstimate(sourceConflict, prisma)).rejects.toBeInstanceOf(FinancialReplayConflictError);
  });

  it("serializes concurrent identical and conflicting writes", async () => {
    const identical = command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: `concurrent-${token}` });
    const same = await Promise.all(Array.from({ length: 8 }, () => recordActual(identical, prisma)));
    expect(new Set(same.map((row) => row.id)).size).toBe(1);
    expect(await prisma.costEntry.count({ where: { costActionKey: identical.costActionKey } })).toBe(1);

    const conflict = command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: `concurrent-conflict-${token}` });
    const outcomes = await Promise.allSettled([
      recordActual(conflict, prisma),
      recordActual({ ...conflict, amountCents: conflict.amountCents + 1 }, prisma)
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(await prisma.costEntry.count({ where: { costActionKey: conflict.costActionKey } })).toBe(1);
  });

  it("retries serialization failures and rolls back injected failures without partial events", async () => {
    const retry = command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: `tx-retry-${token}` });
    let attempts = 0;
    const retried = await recordActual(retry, prisma, {
      beforeCommit: () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("retry"), { code: "P2034" });
      }
    });
    expect(retried.eventKind).toBe("ACTUAL");
    expect(attempts).toBe(2);
    expect(await prisma.costEntry.count({ where: { costActionKey: retry.costActionKey } })).toBe(1);

    const rollback = command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: `rollback-${token}` });
    await expect(
      recordActual(rollback, prisma, { beforeCommit: () => { throw new Error("injected rollback"); } })
    ).rejects.toThrow("injected rollback");
    expect(await prisma.costEntry.count({ where: { costActionKey: rollback.costActionKey } })).toBe(0);

    const outer = command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: `outer-rollback-${token}` });
    await expect(
      prisma.$transaction(async (tx) => {
        await recordActual(outer, tx);
        throw new Error("outer transaction rollback");
      })
    ).rejects.toThrow("outer transaction rollback");
    expect(await prisma.costEntry.count({ where: { costActionKey: outer.costActionKey } })).toBe(0);
  });

  it("prevents duplicate reversal and preserves the original facts", async () => {
    const target = await recordActual(command({ campaignId: campaignA2, stageRunId: stageA2 }), prisma);
    const correction = {
      workspaceId: ids.workspaceA,
      idempotencyKey: `one-reversal-${token}`,
      sourceSystem: "growth-financial-integration",
      sourceEventId: `one-reversal-${token}`,
      occurredAt: new Date(),
      reversesCostEntryId: target.id
    };
    const first = await recordReversal(correction, prisma);
    expect((await recordReversal(correction, prisma)).id).toBe(first.id);
    await expect(
      recordReversal({ ...correction, idempotencyKey: `${correction.idempotencyKey}-2`, sourceEventId: `${correction.sourceEventId}-2` }, prisma)
    ).rejects.toBeTruthy();
    expect(await prisma.costEntry.count({ where: { reversesCostEntryId: target.id } })).toBe(1);
    expect((await prisma.costEntry.findUnique({ where: { id: target.id } }))?.eventKind).toBe("ACTUAL");
  });

  it("rejects incomplete, unsafe, negative-normal, and fictitious identity inputs", async () => {
    await expect(recordActual(command({ service: undefined, provider: undefined }), prisma)).rejects.toBeInstanceOf(FinancialLedgerValidationError);
    await expect(recordActual(command({ provider: "apollo", service: "fake-provider-service" }), prisma)).rejects.toBeInstanceOf(FinancialLedgerValidationError);
    await expect(recordActual(command({ amountCents: -1 }), prisma)).rejects.toBeInstanceOf(FinancialLedgerValidationError);
    await expect(recordActual(command({ currency: "usd" }), prisma)).rejects.toBeInstanceOf(FinancialLedgerValidationError);
    await expect(recordActual(command({ metadata: { bearerToken: "secret" } }), prisma)).rejects.toBeInstanceOf(FinancialLedgerValidationError);
    const serviceEvent = await recordActual(command({ service: "million_verifier", provider: undefined }), prisma);
    expect(serviceEvent.service).toBe("million_verifier");
    expect(serviceEvent.provider).toBeNull();
  });

  it("rejects every cross-workspace or mismatched native and operational link", async () => {
    const invalid = [
      command({ campaignId: campaignB, stageRunId: undefined }),
      command({ campaignId: campaignA2, stageRunId: stageA }),
      command({ approvalId: approvalB }),
      command({ researchRunId: researchB }),
      command({ provider: "apollo", service: undefined, providerJobId: providerJobB, providerJobRunId: providerRunB }),
      command({ provider: "apollo", service: undefined, providerJobId: providerJobA, providerJobRunId: providerRunB }),
      command({ provider: "apollo", service: undefined, providerJobId: providerJobA, providerJobRunId: providerRunA, providerUsageLedgerId: evidenceB })
    ];
    for (const event of invalid) {
      await expect(recordActual(event, prisma)).rejects.toBeInstanceOf(FinancialLedgerValidationError);
    }

    const foreignTarget = await recordActual(
      command({
        workspaceId: ids.workspaceB,
        campaignId: campaignB,
        stageRunId: stageB,
        approvalId: approvalB,
        researchRunId: researchB,
        costActionKey: `foreign-target-${token}`
      }),
      prisma
    );
    await expect(
      recordAdjustment(
        {
          workspaceId: ids.workspaceA,
          idempotencyKey: `cross-adjust-${token}`,
          sourceSystem: "growth-financial-integration",
          sourceEventId: `cross-adjust-${token}`,
          occurredAt: new Date(),
          adjustsCostEntryId: foreignTarget.id,
          amountCents: -1
        },
        prisma
      )
    ).rejects.toBeInstanceOf(FinancialLedgerValidationError);

    await expect(
      prisma.costEntry.create({
        data: {
          workspaceId: ids.workspaceA,
          campaignId: campaignB,
          provider: null,
          service: "direct-constraint-test",
          action: "constraint",
          costActionKey: `constraint-${token}`,
          idempotencyKey: `constraint-${token}`,
          sourceSystem: "constraint-test",
          sourceEventId: `constraint-${token}`,
          contentSha256: "c".repeat(64),
          eventKind: "ACTUAL",
          occurredAt: new Date(),
          currency: "USD",
          amountCents: 1,
          status: "RECORDED",
          reconciliationStatus: "PENDING"
        }
      })
    ).rejects.toBeTruthy();
  });

  it("links provider evidence once, never mutates it, and never double-counts it", async () => {
    const before = await prisma.providerUsageLedger.findUnique({ where: { id: evidenceA } });
    const action = `provider-actual-${token}`;
    const actual = await recordActual(
      command({
        campaignId: campaignA2,
        stageRunId: stageA2,
        approvalId: undefined,
        researchRunId: undefined,
        provider: "apollo",
        service: undefined,
        action: "search",
        costActionKey: action,
        amountCents: 25,
        providerJobId: providerJobA,
        providerJobRunId: providerRunA,
        providerUsageLedgerId: evidenceA
      }),
      prisma
    );
    expect(actual.providerUsageLedgerId).toBe(evidenceA);
    expect(await prisma.providerUsageLedger.findUnique({ where: { id: evidenceA } })).toEqual(before);
    expect((await calculateCostActionTotals({ workspaceId: ids.workspaceA, costActionKey: action }, prisma)).actualCents).toBe(25);

    await expect(
      recordActual(
        command({
          campaignId: campaignA2,
          stageRunId: stageA2,
          provider: "apollo",
          service: undefined,
          providerJobId: providerJobA,
          providerJobRunId: providerRunA,
          providerUsageLedgerId: evidenceA
        }),
        prisma
      )
    ).rejects.toBeTruthy();
  });

  it("rejects mixed-currency aggregation instead of silently summing", async () => {
    const action = `mixed-${token}`;
    await recordActual(command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: action, currency: "USD" }), prisma);
    await recordActual(command({ campaignId: campaignA2, stageRunId: stageA2, costActionKey: action, currency: "EUR" }), prisma);
    await expect(calculateCostActionTotals({ workspaceId: ids.workspaceA, costActionKey: action }, prisma)).rejects.toBeInstanceOf(MixedFinancialCurrencyError);
  });

  it("uses a stable composite cursor for equal timestamps and labels evidence clearly", async () => {
    const timestamp = new Date("2026-07-30T12:00:00.000Z");
    const evidenceIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const id = `page_evidence_${index}_${token}`;
      evidenceIds.push(id);
      await prisma.providerUsageLedger.create({
        data: {
          id,
          workspaceId: ids.workspacePage,
          provider: "pagination-provider",
          operation: "page",
          amountKind: "Actual",
          rawProviderMetadata: {},
          createdAt: timestamp
        }
      });
    }
    for (let index = 0; index < 5; index += 1) {
      await prisma.costEntry.create({
        data: {
          id: `page_cost_${index}_${token}`,
          workspaceId: ids.workspacePage,
          provider: null,
          service: "pagination-service",
          action: "page",
          costActionKey: `page-action-${index}-${token}`,
          idempotencyKey: `page-command-${index}-${token}`,
          sourceSystem: "pagination-test",
          sourceEventId: `page-source-${index}-${token}`,
          contentSha256: "d".repeat(64),
          eventKind: "ACTUAL",
          occurredAt: timestamp,
          createdAt: timestamp,
          currency: "USD",
          amountCents: 1,
          totalCents: 1,
          status: "RECORDED",
          reconciliationStatus: "PENDING",
          ...(index === 0 ? { providerUsageLedgerId: evidenceIds[0] } : {})
        }
      });
    }

    const seen: Array<Awaited<ReturnType<typeof listCostEntries>>["rows"][number]> = [];
    let cursor: string | undefined;
    do {
      const page = await listCostEntries({ workspaceId: ids.workspacePage, pageSize: 2, cursor }, prisma);
      seen.push(...page.rows);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(8);
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(8);
    expect(seen.slice(0, 5).every((entry) => entry.sourceGeneration === 2)).toBe(true);
    const evidence = seen.filter((entry) => entry.source === "legacy_operational_evidence");
    expect(evidence).toHaveLength(3);
    expect(evidence.every((entry) => !entry.isAuthoritativeFinancial && entry.financialEffectCents === null)).toBe(true);
    expect(seen.filter((entry) => entry.isAuthoritativeFinancial).reduce((sum, entry) => sum + (entry.financialEffectCents ?? 0), 0)).toBe(5);
  });

  it("leaves CostEntry intact when the legacy projection cleans ProviderUsageLedger", async () => {
    const before = await prisma.costEntry.count({ where: { workspaceId: ids.workspacePage } });
    expect(before).toBe(5);
    const { createSeedState } = await import("@/lib/phase1/seed");
    const { syncNormalizedProjectionToPrisma } = await import("@/lib/phase1/persistence-projection");
    const state = createSeedState();
    state.workspaces = [{ ...state.workspaces[0]!, id: ids.workspacePage }];
    state.providerUsageLedger = [];
    await syncNormalizedProjectionToPrisma(
      state,
      prisma as unknown as Parameters<typeof syncNormalizedProjectionToPrisma>[1],
      { tables: ["providerUsageLedger"] }
    );
    expect(await prisma.providerUsageLedger.count({ where: { workspaceId: ids.workspacePage } })).toBe(0);
    expect(await prisma.costEntry.count({ where: { workspaceId: ids.workspacePage } })).toBe(before);
  });
});

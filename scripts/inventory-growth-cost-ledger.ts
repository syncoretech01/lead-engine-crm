import { Prisma, PrismaClient } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

const args = new Set(process.argv.slice(2));
const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const environment = argumentValue("--environment") ?? "local";
const asJson = args.has("--json");

if (!/^(local|test|staging|production)$/.test(environment)) {
  console.error("--environment must be local, test, staging, or production.");
  process.exit(64);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Its value is never printed.");
  process.exit(64);
}

const prisma = new PrismaClient();

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

async function rows<T extends JsonRecord>(tx: Prisma.TransactionClient, sql: string): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql);
}

const countValue = (result: JsonRecord[], field = "count"): number => Number(result[0]?.[field] ?? 0);

async function inventory(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

  const foundationColumns = await rows<{ column_name: string }>(
    tx,
    `SELECT "column_name"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'CostEntry'
        AND column_name IN ('eventKind', 'currency', 'idempotencyKey', 'sourceSystem',
                            'sourceEventId', 'sourceLineId', 'providerUsageLedgerId',
                            'providerJobId', 'providerJobRunId')`
  );
  const columns = new Set(foundationColumns.map((row) => row.column_name));
  const foundationApplied = columns.has("eventKind");

  const [
    costTotal,
    costByWorkspace,
    costByStatus,
    costByProviderAction,
    costDuplicateLegacyReferences,
    costMissingCoreAttribution,
    costOrphanWorkspace,
    costOrphanCampaign,
    costOrphanStage,
    costCrossCampaign,
    costCrossStage,
    costSuspiciousMetadata,
    costTimestamps,
    providerTotal,
    providerByWorkspace,
    providerByProviderOperation,
    providerCurrencies,
    providerDuplicateRuns,
    providerDuplicateJobs,
    providerOrphanJobs,
    providerOrphanRuns,
    providerCrossWorkspaceJobs,
    providerCrossWorkspaceRuns,
    providerNoReference,
    providerTimestamps
  ] = await Promise.all([
    rows(tx, `SELECT count(*)::bigint AS count FROM "CostEntry"`),
    rows(tx, `SELECT "workspaceId", count(*)::bigint AS count FROM "CostEntry" GROUP BY "workspaceId" ORDER BY "workspaceId"`),
    rows(tx, `SELECT "status", count(*)::bigint AS count FROM "CostEntry" GROUP BY "status" ORDER BY "status"`),
    rows(tx, `SELECT coalesce("provider", '<none>') AS provider, "action", count(*)::bigint AS count FROM "CostEntry" GROUP BY 1, 2 ORDER BY 1, 2`),
    rows(tx, `SELECT "workspaceId", "referenceType", "referenceId", count(*)::bigint AS count FROM "CostEntry" WHERE "referenceType" IS NOT NULL AND "referenceId" IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1 ORDER BY 1, 2, 3`),
    rows(tx, `SELECT
      count(*) FILTER (WHERE "workspaceId" IS NULL)::bigint AS "missingWorkspace",
      count(*) FILTER (WHERE "campaignId" IS NULL)::bigint AS "missingCampaign",
      count(*) FILTER (WHERE "stageRunId" IS NULL)::bigint AS "missingStageRun",
      count(*) FILTER (WHERE "referenceType" IS NULL OR "referenceId" IS NULL)::bigint AS "missingLegacyReference"
      FROM "CostEntry"`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "CostEntry" c LEFT JOIN "Workspace" w ON w.id = c."workspaceId" WHERE w.id IS NULL`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "CostEntry" c LEFT JOIN "Campaign" p ON p.id = c."campaignId" WHERE c."campaignId" IS NOT NULL AND p.id IS NULL`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "CostEntry" c LEFT JOIN "CampaignStageRun" s ON s.id = c."stageRunId" WHERE c."stageRunId" IS NOT NULL AND s.id IS NULL`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "CostEntry" c JOIN "Campaign" p ON p.id = c."campaignId" WHERE p."workspaceId" <> c."workspaceId"`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "CostEntry" c JOIN "CampaignStageRun" s ON s.id = c."stageRunId" WHERE s."workspaceId" <> c."workspaceId" OR (c."campaignId" IS NOT NULL AND s."campaignId" <> c."campaignId")`),
    rows(tx, `SELECT count(*)::bigint AS count, coalesce(max(octet_length("metadata"::text)), 0)::bigint AS "maxBytes" FROM "CostEntry" WHERE octet_length("metadata"::text) > 65536`),
    rows(tx, `SELECT min("createdAt") AS earliest, max("createdAt") AS latest FROM "CostEntry"`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "ProviderUsageLedger"`),
    rows(tx, `SELECT "workspaceId", count(*)::bigint AS count FROM "ProviderUsageLedger" GROUP BY "workspaceId" ORDER BY "workspaceId"`),
    rows(tx, `SELECT "provider", "operation", count(*)::bigint AS count FROM "ProviderUsageLedger" GROUP BY 1, 2 ORDER BY 1, 2`),
    rows(tx, `SELECT coalesce(nullif(btrim("currency"), ''), '<missing>') AS currency, count(*)::bigint AS count FROM "ProviderUsageLedger" GROUP BY 1 ORDER BY 1`),
    rows(tx, `SELECT "workspaceId", "providerJobRunId", "amountKind", count(*)::bigint AS count FROM "ProviderUsageLedger" WHERE "providerJobRunId" IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1 ORDER BY 1, 2, 3`),
    rows(tx, `SELECT "workspaceId", "providerJobId", "amountKind", count(*)::bigint AS count FROM "ProviderUsageLedger" WHERE "providerJobId" IS NOT NULL AND "providerJobRunId" IS NULL GROUP BY 1, 2, 3 HAVING count(*) > 1 ORDER BY 1, 2, 3`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "ProviderUsageLedger" l LEFT JOIN "ProviderJob" j ON j.id = l."providerJobId" WHERE l."providerJobId" IS NOT NULL AND j.id IS NULL`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "ProviderUsageLedger" l LEFT JOIN "ProviderJobRun" r ON r.id = l."providerJobRunId" WHERE l."providerJobRunId" IS NOT NULL AND r.id IS NULL`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "ProviderUsageLedger" l JOIN "ProviderJob" j ON j.id = l."providerJobId" WHERE j."workspaceId" <> l."workspaceId"`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "ProviderUsageLedger" l JOIN "ProviderJobRun" r ON r.id = l."providerJobRunId" WHERE r."workspaceId" <> l."workspaceId"`),
    rows(tx, `SELECT count(*)::bigint AS count FROM "ProviderUsageLedger" WHERE "jobId" IS NULL AND "providerJobId" IS NULL AND "providerJobRunId" IS NULL`),
    rows(tx, `SELECT min("createdAt") AS earliest, max("createdAt") AS latest FROM "ProviderUsageLedger"`)
  ]);

  const costFoundation = foundationApplied
    ? {
        currencies: await rows(tx, `SELECT coalesce(nullif(btrim("currency"), ''), '<missing>') AS currency, count(*)::bigint AS count FROM "CostEntry" GROUP BY 1 ORDER BY 1`),
        eventKinds: await rows(tx, `SELECT coalesce("eventKind"::text, '<historical>') AS "eventKind", count(*)::bigint AS count FROM "CostEntry" GROUP BY 1 ORDER BY 1`),
        byServiceAction: await rows(tx, `SELECT coalesce("service", '<none>') AS service, "action", count(*)::bigint AS count FROM "CostEntry" GROUP BY 1, 2 ORDER BY 1, 2`),
        missingAttribution: await rows(tx, `SELECT
          count(*) FILTER (WHERE "eventKind" IS NOT NULL AND "campaignId" IS NULL)::bigint AS "campaignId",
          count(*) FILTER (WHERE "eventKind" IS NOT NULL AND "stageRunId" IS NULL)::bigint AS "stageRunId",
          count(*) FILTER (WHERE "eventKind" IS NOT NULL AND "approvalId" IS NULL)::bigint AS "approvalId",
          count(*) FILTER (WHERE "eventKind" IS NOT NULL AND "researchRunId" IS NULL)::bigint AS "researchRunId",
          count(*) FILTER (WHERE "eventKind" IS NOT NULL AND "providerJobId" IS NULL)::bigint AS "providerJobId",
          count(*) FILTER (WHERE "eventKind" IS NOT NULL AND "providerJobRunId" IS NULL)::bigint AS "providerJobRunId",
          count(*) FILTER (WHERE "eventKind" IS not null AND "providerUsageLedgerId" IS NULL)::bigint AS "providerUsageLedgerId",
          count(*) FILTER (WHERE "eventKind" IS NOT NULL AND "authorizationId" IS NULL)::bigint AS "authorizationId"
          FROM "CostEntry"`),
        missingNativeFields: await rows(tx, `SELECT count(*)::bigint AS count FROM "CostEntry" WHERE "eventKind" IS NOT NULL AND ("costActionKey" IS NULL OR "idempotencyKey" IS NULL OR "sourceSystem" IS NULL OR "sourceEventId" IS NULL OR "occurredAt" IS NULL OR "currency" IS NULL OR "amountCents" IS NULL)`),
        relationHazards: await rows(tx, `SELECT
          count(*) FILTER (WHERE c."approvalId" IS NOT NULL AND a.id IS NULL)::bigint AS "orphanApproval",
          count(*) FILTER (WHERE c."researchRunId" IS NOT NULL AND rr.id IS NULL)::bigint AS "orphanResearchRun",
          count(*) FILTER (WHERE c."providerJobId" IS NOT NULL AND pj.id IS NULL)::bigint AS "orphanProviderJob",
          count(*) FILTER (WHERE c."providerJobRunId" IS NOT NULL AND pjr.id IS NULL)::bigint AS "orphanProviderJobRun",
          count(*) FILTER (WHERE c."providerUsageLedgerId" IS NOT NULL AND pul.id IS NULL)::bigint AS "missingProjectedEvidence",
          count(*) FILTER (WHERE a.id IS NOT NULL AND a."workspaceId" <> c."workspaceId")::bigint AS "crossWorkspaceApproval",
          count(*) FILTER (WHERE rr.id IS NOT NULL AND rr."workspaceId" <> c."workspaceId")::bigint AS "crossWorkspaceResearchRun",
          count(*) FILTER (WHERE pj.id IS NOT NULL AND pj."workspaceId" <> c."workspaceId")::bigint AS "crossWorkspaceProviderJob",
          count(*) FILTER (WHERE pjr.id IS NOT NULL AND pjr."workspaceId" <> c."workspaceId")::bigint AS "crossWorkspaceProviderJobRun",
          count(*) FILTER (WHERE pul.id IS NOT NULL AND pul."workspaceId" <> c."workspaceId")::bigint AS "crossWorkspaceEvidence"
          FROM "CostEntry" c
          LEFT JOIN "Approval" a ON a.id = c."approvalId"
          LEFT JOIN "ResearchRun" rr ON rr.id = c."researchRunId"
          LEFT JOIN "ProviderJob" pj ON pj.id = c."providerJobId"
          LEFT JOIN "ProviderJobRun" pjr ON pjr.id = c."providerJobRunId"
          LEFT JOIN "ProviderUsageLedger" pul ON pul.id = c."providerUsageLedgerId"`),
        duplicateCommands: await rows(tx, `SELECT "workspaceId", "idempotencyKey", count(*)::bigint AS count FROM "CostEntry" WHERE "idempotencyKey" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2`),
        duplicateSources: await rows(tx, `SELECT "workspaceId", "sourceSystem", "sourceEventId", "eventKind"::text, coalesce("sourceLineId", '<none>') AS "sourceLineId", count(*)::bigint AS count FROM "CostEntry" WHERE "sourceSystem" IS NOT NULL AND "sourceEventId" IS NOT NULL GROUP BY 1, 2, 3, 4, 5 HAVING count(*) > 1 ORDER BY 1, 2, 3, 4, 5`)
      }
    : {
        currencies: [],
        eventKinds: [],
        byServiceAction: [],
        missingAttribution: [{}],
        missingNativeFields: [{ count: BigInt(0) }],
        relationHazards: [{}],
        duplicateCommands: [],
        duplicateSources: [],
        note: "Foundation columns are not deployed; existing CostEntry rows have no authoritative currency or event identity."
      };

  const crossStore = foundationApplied
    ? {
        explicitEvidenceLinks: await rows(tx, `SELECT c.id AS "costEntryId", l.id AS "providerUsageLedgerId", c."workspaceId" FROM "CostEntry" c JOIN "ProviderUsageLedger" l ON l.id = c."providerUsageLedgerId" ORDER BY c.id LIMIT 100`),
        authoritativeRunMatches: await rows(tx, `SELECT c.id AS "costEntryId", l.id AS "providerUsageLedgerId", c."workspaceId", c."providerJobRunId" FROM "CostEntry" c JOIN "ProviderUsageLedger" l ON l."workspaceId" = c."workspaceId" AND l."providerJobRunId" = c."providerJobRunId" WHERE c."providerJobRunId" IS NOT NULL ORDER BY c.id, l.id LIMIT 100`)
      }
    : {
        explicitEvidenceLinks: [],
        authoritativeRunMatches: [],
        note: "No foundation identifiers exist yet; no relationship was inferred from legacy metadata."
      };

  const hazards: string[] = [];
  if (countValue(costOrphanWorkspace)) hazards.push("CostEntry has orphaned Workspace references.");
  if (countValue(costOrphanCampaign)) hazards.push("CostEntry has orphaned Campaign references.");
  if (countValue(costOrphanStage)) hazards.push("CostEntry has orphaned CampaignStageRun references.");
  if (countValue(costCrossCampaign)) hazards.push("CostEntry has cross-workspace Campaign references.");
  if (countValue(costCrossStage)) hazards.push("CostEntry has cross-workspace or cross-Campaign stage references.");
  if (countValue(costFoundation.missingNativeFields)) hazards.push("Native financial events have incomplete mandatory fields.");
  const relationHazards: JsonRecord = costFoundation.relationHazards[0] ?? {};
  const operationalMissing = new Set(["orphanProviderJob", "orphanProviderJobRun", "missingProjectedEvidence"]);
  for (const [name, value] of Object.entries(relationHazards)) {
    if (Number(value) > 0 && !operationalMissing.has(name)) {
      hazards.push(`CostEntry relation hazard ${name}: ${Number(value)}.`);
    }
  }
  if (costFoundation.duplicateCommands.length) hazards.push("Duplicate command identities exist.");
  if (costFoundation.duplicateSources.length) hazards.push("Duplicate source-event identities exist.");
  const warnings: string[] = [];
  for (const name of operationalMissing) {
    const count = Number(relationHazards[name] ?? 0);
    if (count > 0) warnings.push(`CostEntry operational reference ${name}: ${count}.`);
  }
  if (costDuplicateLegacyReferences.length) warnings.push("Historical CostEntry reference duplicates require review.");
  if (countValue(costSuspiciousMetadata)) warnings.push("CostEntry contains metadata larger than 64 KiB.");
  if (countValue(providerOrphanJobs)) warnings.push("ProviderUsageLedger has orphaned ProviderJob references.");
  if (countValue(providerOrphanRuns)) warnings.push("ProviderUsageLedger has orphaned ProviderJobRun references.");
  if (countValue(providerCrossWorkspaceJobs)) warnings.push("ProviderUsageLedger has cross-workspace ProviderJob references.");
  if (countValue(providerCrossWorkspaceRuns)) warnings.push("ProviderUsageLedger has cross-workspace ProviderJobRun references.");

  return {
    toolVersion: 1,
    environment,
    readOnly: true,
    foundationApplied,
    generatedAt: new Date().toISOString(),
    costEntry: {
      totalRows: countValue(costTotal),
      byWorkspace: costByWorkspace,
      byStatus: costByStatus,
      byProviderAction: costByProviderAction,
      byServiceAction: costFoundation.byServiceAction,
      missingAttribution: {
        historical: costMissingCoreAttribution[0] ?? {},
        native: costFoundation.missingAttribution[0] ?? {}
      },
      currencies: costFoundation.currencies,
      eventKinds: costFoundation.eventKinds,
      duplicateCommands: costFoundation.duplicateCommands,
      duplicateSources: costFoundation.duplicateSources,
      duplicateLegacyReferences: costDuplicateLegacyReferences,
      relationHazards,
      orphanWorkspace: countValue(costOrphanWorkspace),
      orphanCampaign: countValue(costOrphanCampaign),
      orphanStageRun: countValue(costOrphanStage),
      crossWorkspaceCampaign: countValue(costCrossCampaign),
      crossWorkspaceOrCampaignStageRun: countValue(costCrossStage),
      suspiciousMetadata: costSuspiciousMetadata[0] ?? {},
      timestamps: costTimestamps[0] ?? {}
    },
    providerUsageLedger: {
      totalRows: countValue(providerTotal),
      byWorkspace: providerByWorkspace,
      byProviderOperation: providerByProviderOperation,
      currencies: providerCurrencies,
      duplicateProviderRunCandidates: providerDuplicateRuns,
      duplicateProviderJobCandidates: providerDuplicateJobs,
      orphanProviderJobs: countValue(providerOrphanJobs),
      orphanProviderJobRuns: countValue(providerOrphanRuns),
      crossWorkspaceProviderJobs: countValue(providerCrossWorkspaceJobs),
      crossWorkspaceProviderJobRuns: countValue(providerCrossWorkspaceRuns),
      rowsWithoutOperationalReference: countValue(providerNoReference),
      timestamps: providerTimestamps[0] ?? {}
    },
    crossStore,
    warnings,
    hazards,
    safeToProceed: hazards.length === 0
  };
}

async function main() {
  try {
    const report = await prisma.$transaction((tx) => inventory(tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
    const output = jsonSafe(report) as ReturnType<typeof jsonSafe>;
    if (asJson) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      const result = output as {
        foundationApplied: boolean;
        costEntry: { totalRows: number };
        providerUsageLedger: { totalRows: number };
        warnings: string[];
        hazards: string[];
        safeToProceed: boolean;
      };
      console.log(`Growth cost-ledger inventory (${environment}, read-only)`);
      console.log(`Foundation applied: ${result.foundationApplied}`);
      console.log(`CostEntry rows: ${result.costEntry.totalRows}`);
      console.log(`ProviderUsageLedger rows: ${result.providerUsageLedger.totalRows}`);
      console.log(`Warnings: ${result.warnings.length}`);
      for (const warning of result.warnings) console.log(`- ${warning}`);
      console.log(`Structural hazards: ${result.hazards.length}`);
      for (const hazard of result.hazards) console.log(`- ${hazard}`);
      console.log(`Safe to proceed: ${result.safeToProceed}`);
    }
    if (!report.safeToProceed) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

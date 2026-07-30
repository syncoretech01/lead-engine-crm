import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const migrationName = "20260730190000_growth_os_cost_entry_foundation";
const databaseUrl = process.env.DATABASE_URL;

if (process.env.SYNCORE_RUN_DB_INTEGRATION !== "1" || !databaseUrl) {
  console.error("This migration test requires SYNCORE_RUN_DB_INTEGRATION=1 and DATABASE_URL.");
  process.exit(64);
}

const base = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  console.error("Refusing to create test databases on a non-local PostgreSQL host.");
  process.exit(64);
}

const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
const prismaCli = resolve("node_modules/prisma/build/index.js");
const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
const tempRoot = mkdtempSync(join(tmpdir(), "syncore-ledger-migration-"));

function databaseName(label: string): string {
  return `ledger_${label}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function urlFor(name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

function migrate(url: string, schema: string) {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], {
    cwd: resolve("."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit"
  });
}

function ledgerInventory(url: string): { foundationApplied: boolean; costEntry: { totalRows: number }; providerUsageLedger: { totalRows: number } } {
  const output = execFileSync(
    process.execPath,
    [tsxCli, resolve("scripts/inventory-growth-cost-ledger.ts"), "--environment", "test", "--json"],
    {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8"
    }
  );
  return JSON.parse(output) as {
    foundationApplied: boolean;
    costEntry: { totalRows: number };
    providerUsageLedger: { totalRows: number };
  };
}

function makePreFoundationPrismaDir(): string {
  const target = join(tempRoot, "prisma");
  mkdirSync(join(target, "migrations"), { recursive: true });
  cpSync(resolve("prisma/schema.prisma"), join(target, "schema.prisma"), { recursive: false });
  cpSync(resolve("prisma/migrations/migration_lock.toml"), join(target, "migrations/migration_lock.toml"), {
    recursive: false
  });
  for (const name of readdirSync(resolve("prisma/migrations"))) {
    if (name === "migration_lock.toml" || name === migrationName) continue;
    cpSync(resolve("prisma/migrations", name), join(target, "migrations", name), { recursive: true });
  }
  return join(target, "schema.prisma");
}

async function createDatabase(name: string) {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
}

async function dropDatabase(name: string) {
  await admin.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
  );
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
}

async function main() {
  const empty = databaseName("empty");
  const historical = databaseName("historical");
  try {
    await createDatabase(empty);
    migrate(urlFor(empty), resolve("prisma/schema.prisma"));
    const emptyDb = new PrismaClient({ datasourceUrl: urlFor(empty) });
    const enumExists = await emptyDb.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pg_type WHERE typname = 'FinancialEventKind'`
    );
    if (Number(enumExists[0]?.count ?? 0) !== 1) throw new Error("Empty-database migration missed FinancialEventKind.");
    await emptyDb.$disconnect();

    await createDatabase(historical);
    const preFoundationSchema = makePreFoundationPrismaDir();
    migrate(urlFor(historical), preFoundationSchema);
    const historicalDb = new PrismaClient({ datasourceUrl: urlFor(historical) });
    await historicalDb.$executeRawUnsafe(`INSERT INTO "Workspace" ("id", "name", "seats", "approvalThresholdT1Cents", "createdAt", "updatedAt") VALUES ('ws_ledger_migration', 'Ledger migration fixture', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
    await historicalDb.$executeRawUnsafe(`INSERT INTO "CostEntry" ("id", "workspaceId", "provider", "action", "unit", "status", "metadata", "createdAt") VALUES ('cost_legacy_fixture', 'ws_ledger_migration', 'legacy-provider', 'legacy-action', 'record', 'recorded', '{}'::jsonb, CURRENT_TIMESTAMP)`);
    await historicalDb.$executeRawUnsafe(`INSERT INTO "ProviderUsageLedger" ("id", "workspaceId", "provider", "operation", "amountKind", "rawProviderMetadata", "createdAt") VALUES ('usage_legacy_fixture', 'ws_ledger_migration', 'legacy-provider', 'legacy-operation', 'Actual', '{}'::jsonb, CURRENT_TIMESTAMP)`);
    await historicalDb.$disconnect();

    const beforeInventory = ledgerInventory(urlFor(historical));
    if (beforeInventory.foundationApplied || beforeInventory.costEntry.totalRows !== 1 || beforeInventory.providerUsageLedger.totalRows !== 1) {
      throw new Error("Pre-foundation read-only inventory did not preserve/report representative rows.");
    }

    migrate(urlFor(historical), resolve("prisma/schema.prisma"));
    const migrated = new PrismaClient({ datasourceUrl: urlFor(historical) });
    const [costRows, usageRows, compatibility] = await Promise.all([
      migrated.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM "CostEntry" WHERE id = 'cost_legacy_fixture'`),
      migrated.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM "ProviderUsageLedger" WHERE id = 'usage_legacy_fixture'`),
      migrated.$queryRawUnsafe<Array<{ eventKind: string | null; currency: string | null; idempotencyKey: string | null }>>(
        `SELECT "eventKind"::text AS "eventKind", "currency", "idempotencyKey" FROM "CostEntry" WHERE id = 'cost_legacy_fixture'`
      )
    ]);
    if (Number(costRows[0]?.count ?? 0) !== 1 || Number(usageRows[0]?.count ?? 0) !== 1) {
      throw new Error("Representative historical rows were not preserved.");
    }
    if (compatibility[0]?.eventKind !== null || compatibility[0]?.currency !== null || compatibility[0]?.idempotencyKey !== null) {
      throw new Error("Historical CostEntry compatibility fields were guessed instead of remaining null.");
    }
    await migrated.$disconnect();
    const afterInventory = ledgerInventory(urlFor(historical));
    if (!afterInventory.foundationApplied || afterInventory.costEntry.totalRows !== 1 || afterInventory.providerUsageLedger.totalRows !== 1) {
      throw new Error("Post-foundation read-only inventory did not preserve/report representative rows.");
    }
    console.log("Growth cost-ledger migration test passed: empty database and representative historical rows.");
  } finally {
    await dropDatabase(empty);
    await dropDatabase(historical);
    await admin.$disconnect();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

void main();

import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState, ExportRecord } from "@/lib/phase1/types";

type PrismaExportReadRow = {
  id: string;
  workspaceId: string;
  leadJobId: string | null;
  name: string;
  exportType: string;
  filterSnapshot: unknown;
  columns: string[];
  recordCount: number;
  createdById: string | null;
  createdAt: Date | string;
};

type ExportFilterSnapshot = {
  exportRuleId?: unknown;
  recordIds?: unknown;
  blockedCount?: unknown;
  status?: unknown;
};

export async function exportReadRowsForWorkspace(
  state: AppState,
  workspaceId: string
): Promise<ExportRecord[]> {
  const snapshotRows = exportReadRowsFromState(state, workspaceId);

  if (resolveStorageDriver() !== "prisma") {
    return snapshotRows;
  }

  try {
    const normalizedRows = await readNormalizedExportRowsFromPrisma(workspaceId);

    if (snapshotRows.length > 0 && normalizedRows.length === 0) {
      return snapshotRows;
    }

    return normalizedRows;
  } catch (error) {
    console.warn("Falling back to snapshot export rows after normalized Prisma read failed.", error);
    return snapshotRows;
  }
}

export async function exportRecordForWorkspace(
  state: AppState,
  workspaceId: string,
  id: string
): Promise<ExportRecord | undefined> {
  const rows = await exportReadRowsForWorkspace(state, workspaceId);
  return rows.find((record) => record.id === id);
}

export function exportReadRowsFromState(state: AppState, workspaceId: string): ExportRecord[] {
  return state.exports
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function stateWithExportReadRows(
  state: AppState,
  workspaceId: string,
  rows: ExportRecord[]
): AppState {
  return {
    ...state,
    exports: [
      ...state.exports.filter((record) => record.workspaceId !== workspaceId),
      ...rows
    ]
  };
}

async function readNormalizedExportRowsFromPrisma(workspaceId: string): Promise<ExportRecord[]> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.export.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      workspaceId: true,
      leadJobId: true,
      name: true,
      exportType: true,
      filterSnapshot: true,
      columns: true,
      recordCount: true,
      createdById: true,
      createdAt: true
    }
  });

  return rows.map((row) => exportRecordFromPrisma(row));
}

function exportRecordFromPrisma(row: PrismaExportReadRow): ExportRecord {
  const snapshot = filterSnapshot(row.filterSnapshot);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    leadJobId: row.leadJobId ?? undefined,
    exportRuleId: stringValue(snapshot.exportRuleId),
    name: row.name,
    type: exportTypeValue(row.exportType),
    columns: row.columns,
    recordIds: stringArray(snapshot.recordIds),
    recordCount: row.recordCount,
    blockedCount: numberValue(snapshot.blockedCount),
    createdById: row.createdById ?? "system",
    createdAt: isoString(row.createdAt),
    status: exportStatusValue(snapshot.status)
  };
}

function filterSnapshot(value: unknown): ExportFilterSnapshot {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ExportFilterSnapshot : {};
}

function exportTypeValue(value: string): ExportRecord["type"] {
  if (
    value === "companies" ||
    value === "contacts" ||
    value === "verified_email_leads" ||
    value === "phone_leads" ||
    value === "sdr_assignments"
  ) {
    return value;
  }

  return "contacts";
}

function exportStatusValue(value: unknown): ExportRecord["status"] {
  return value === "Draft" ? "Draft" : "Ready";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

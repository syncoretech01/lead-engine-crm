import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  AppState,
  AuditLog,
  DataSubjectRequest,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  SuppressionRecord
} from "@/lib/phase1/types";

export type ComplianceReadRows = {
  suppressionRecords: SuppressionRecord[];
  dataSubjectRequests: DataSubjectRequest[];
  auditLogs: AuditLog[];
};

type PrismaSuppressionReadRow = {
  id: string;
  workspaceId: string;
  type: string;
  email: string | null;
  phone: string | null;
  domain: string | null;
  reason: string;
  source: string;
  createdAt: Date | string;
};

type PrismaDataSubjectRequestReadRow = {
  id: string;
  workspaceId: string;
  requestType: string;
  status: string;
  email: string | null;
  phone: string | null;
  contactId: string | null;
  requestedAt: Date | string;
  dueAt: Date | string;
  verifiedAt: Date | string | null;
  completedAt: Date | string | null;
  handledById: string | null;
  notes: string;
  evidence: string | null;
};

type PrismaAuditLogReadRow = {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  objectType: string;
  objectId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: Date | string;
};

export async function complianceReadRowsForWorkspace(
  state: AppState,
  workspaceId: string
): Promise<ComplianceReadRows> {
  const snapshotRows = complianceReadRowsFromState(state, workspaceId);

  if (resolveStorageDriver() !== "prisma") {
    return snapshotRows;
  }

  try {
    const normalizedRows = await readNormalizedComplianceRowsFromPrisma(workspaceId);
    const snapshotHasRows =
      snapshotRows.suppressionRecords.length > 0 ||
      snapshotRows.dataSubjectRequests.length > 0 ||
      snapshotRows.auditLogs.length > 0;
    const normalizedHasRows =
      normalizedRows.suppressionRecords.length > 0 ||
      normalizedRows.dataSubjectRequests.length > 0 ||
      normalizedRows.auditLogs.length > 0;

    if (snapshotHasRows && !normalizedHasRows) {
      return snapshotRows;
    }

    return normalizedRows;
  } catch (error) {
    console.warn("Falling back to snapshot compliance rows after normalized Prisma read failed.", error);
    return snapshotRows;
  }
}

export function complianceReadRowsFromState(state: AppState, workspaceId: string): ComplianceReadRows {
  return {
    suppressionRecords: state.suppressionRecords.filter((record) => record.workspaceId === workspaceId),
    dataSubjectRequests: state.dataSubjectRequests.filter((request) => request.workspaceId === workspaceId),
    auditLogs: state.auditLogs.filter((log) => log.workspaceId === workspaceId)
  };
}

export function stateWithComplianceReadRows(
  state: AppState,
  workspaceId: string,
  rows: ComplianceReadRows
): AppState {
  return {
    ...state,
    suppressionRecords: [
      ...state.suppressionRecords.filter((record) => record.workspaceId !== workspaceId),
      ...rows.suppressionRecords
    ],
    dataSubjectRequests: [
      ...state.dataSubjectRequests.filter((request) => request.workspaceId !== workspaceId),
      ...rows.dataSubjectRequests
    ],
    auditLogs: [
      ...state.auditLogs.filter((log) => log.workspaceId !== workspaceId),
      ...rows.auditLogs
    ]
  };
}

async function readNormalizedComplianceRowsFromPrisma(workspaceId: string): Promise<ComplianceReadRows> {
  const { prisma } = await import("@/lib/prisma");
  const [suppressionRows, dataSubjectRequestRows, auditLogRows] = await Promise.all([
    prisma.suppressionRecord.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        type: true,
        email: true,
        phone: true,
        domain: true,
        reason: true,
        source: true,
        createdAt: true
      }
    }),
    prisma.dataSubjectRequest.findMany({
      where: { workspaceId },
      orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        requestType: true,
        status: true,
        email: true,
        phone: true,
        contactId: true,
        requestedAt: true,
        dueAt: true,
        verifiedAt: true,
        completedAt: true,
        handledById: true,
        notes: true,
        evidence: true
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        actorUserId: true,
        objectType: true,
        objectId: true,
        action: true,
        oldValue: true,
        newValue: true,
        reason: true,
        createdAt: true
      }
    })
  ]);

  return {
    suppressionRecords: suppressionRows.map((row) => suppressionRecordFromPrisma(row)),
    dataSubjectRequests: dataSubjectRequestFromPrismaRows(dataSubjectRequestRows),
    auditLogs: auditLogRows.map((row) => auditLogFromPrisma(row))
  };
}

function suppressionRecordFromPrisma(row: PrismaSuppressionReadRow): SuppressionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: suppressionTypeValue(row.type),
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    domain: row.domain ?? undefined,
    reason: row.reason,
    source: row.source,
    createdAt: isoString(row.createdAt)
  };
}

function dataSubjectRequestFromPrismaRows(rows: PrismaDataSubjectRequestReadRow[]): DataSubjectRequest[] {
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    requestType: dataSubjectRequestTypeValue(row.requestType),
    status: dataSubjectRequestStatusValue(row.status),
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    contactId: row.contactId ?? undefined,
    requestedAt: isoString(row.requestedAt),
    dueAt: isoString(row.dueAt),
    verifiedAt: optionalIsoString(row.verifiedAt),
    completedAt: optionalIsoString(row.completedAt),
    handledById: row.handledById ?? undefined,
    notes: row.notes,
    evidence: row.evidence ?? undefined
  }));
}

function auditLogFromPrisma(row: PrismaAuditLogReadRow): AuditLog {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorUserId: row.actorUserId ?? "system",
    objectType: row.objectType,
    objectId: row.objectId,
    action: row.action,
    oldValue: row.oldValue ?? undefined,
    newValue: row.newValue ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: isoString(row.createdAt)
  };
}

function suppressionTypeValue(value: string): SuppressionRecord["type"] {
  const map: Record<string, SuppressionRecord["type"]> = {
    UNSUBSCRIBE: "Unsubscribe",
    HARD_BOUNCE: "Hard bounce",
    DO_NOT_CALL: "Do not call",
    EXISTING_CUSTOMER: "Existing customer",
    COMPETITOR: "Competitor",
    SPAM_COMPLAINT: "Spam complaint",
    SMS_OPT_OUT: "SMS opt-out",
    DELETION_REQUEST: "Deletion request"
  };

  return map[value] ?? "Unsubscribe";
}

function dataSubjectRequestTypeValue(value: string): DataSubjectRequestType {
  if (
    value === "Access" ||
    value === "Deletion" ||
    value === "Suppression" ||
    value === "Correction" ||
    value === "Export"
  ) {
    return value;
  }

  return "Access";
}

function dataSubjectRequestStatusValue(value: string): DataSubjectRequestStatus {
  if (value === "Open" || value === "Verified" || value === "Completed" || value === "Rejected") {
    return value;
  }

  return "Open";
}

function isoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return isoString(value);
}

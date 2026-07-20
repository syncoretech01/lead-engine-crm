import { sdrDailyReportMetrics } from "@/lib/phase1/sdr-daily-report";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState, SdrDailyReport, Session } from "@/lib/phase1/types";

export type SdrDailyReportRow = SdrDailyReport & { sdrName: string };

const MAX_REPORTS = 500;

export async function readFastSdrDailyReports(
  _session: Session,
  workspaceId: string
): Promise<SdrDailyReportRow[] | undefined> {
  if (resolveStorageDriver() !== "prisma") return undefined;
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.sdrDailyReport.findMany({
    where: { workspaceId },
    orderBy: [{ reportDate: "desc" }, { sdr: { name: "asc" } }],
    take: MAX_REPORTS,
    include: { sdr: { select: { name: true } } }
  });
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    sdrUserId: row.sdrUserId,
    sdrName: row.sdr.name,
    reportDate: row.reportDate,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    timezone: "Asia/Karachi",
    cutoffHour: 4,
    metrics: sdrDailyReportMetrics(row.metrics),
    generatedAt: row.generatedAt.toISOString()
  }));
}

export function sdrDailyReportsFromState(state: AppState, workspaceId: string): SdrDailyReportRow[] {
  const names = new Map(state.users.map((user) => [user.id, user.name]));
  return state.sdrDailyReports
    .filter((report) => report.workspaceId === workspaceId)
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || (names.get(a.sdrUserId) ?? "").localeCompare(names.get(b.sdrUserId) ?? ""))
    .slice(0, MAX_REPORTS)
    .map((report) => ({ ...report, metrics: sdrDailyReportMetrics(report.metrics), sdrName: names.get(report.sdrUserId) ?? "Unknown SDR" }));
}

export function latestSdrDailyReports(rows: SdrDailyReportRow[], sdrUserIds: string[]): SdrDailyReportRow[] {
  const latest = new Map<string, SdrDailyReportRow>();
  for (const row of rows) {
    if (!latest.has(row.sdrUserId)) latest.set(row.sdrUserId, row);
  }
  return sdrUserIds.map((id) => latest.get(id)).filter((row): row is SdrDailyReportRow => Boolean(row));
}

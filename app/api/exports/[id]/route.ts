import { exportCsvForRecord } from "@/lib/phase1/exporting";
import { assertPermission } from "@/lib/phase1/auth";
import { exportRecordForWorkspace } from "@/lib/phase1/export-read-path";
import { getSession, readState } from "@/lib/phase1/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "export_csv");
  const exportRecord = await exportRecordForWorkspace(state, session.workspace.id, id);

  if (!exportRecord) {
    return new Response("Export not found", { status: 404 });
  }

  const csv = exportCsvForRecord(state, exportRecord);
  const fileName = `${exportRecord.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

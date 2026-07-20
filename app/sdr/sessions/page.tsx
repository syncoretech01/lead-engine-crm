import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import {
  readFastSdrSessionHistory,
  sdrSessionHistoryFromState
} from "@/lib/phase1/sdr-session-history-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

export default async function SdrSessionHistoryPage({
  searchParams
}: {
  searchParams: Promise<{ sdr?: string }>;
}) {
  const sp = await searchParams;
  const context = await getWorkspaceSessionContext("manage_sdr");
  const { session, workspaceId } = context;
  const fast = await readFastSdrSessionHistory(session, workspaceId, { sdrId: sp.sdr });
  const model = fast ?? sdrSessionHistoryFromState(
    (await getWorkspaceContext("manage_sdr")).state,
    session,
    workspaceId,
    { sdrId: sp.sdr }
  );
  const rows = model.rows;
  const timeZone = session.user.timezone || undefined;
  const totals = rows.reduce(
    (sum, row) => ({
      calls: sum.calls + row.totalCalls,
      connected: sum.connected + row.connectedCalls,
      talk: sum.talk + row.totalTalkTimeSeconds
    }),
    { calls: 0, connected: 0, talk: 0 }
  );

  return (
    <div className="min-h-full px-5 py-6 md:px-8">
      <PageHeader
        kicker="SDR · Calling"
        title="Session history"
        copy="Saved end-of-session reports with call outcomes, follow-ups, suppressions, and total talk time."
        actions={
          <Link href="/sdr/focus?start=1" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Start calling
          </Link>
        }
      />

      {session.role !== "SDR" && model.roster.length ? (
        <form className="mb-4 flex max-w-sm items-center gap-2" method="get">
          <label htmlFor="sdr" className="text-sm font-medium text-muted-foreground">SDR</label>
          <select id="sdr" name="sdr" defaultValue={sp.sdr ?? ""} className="h-9 flex-1 rounded-lg border bg-background px-3 text-sm">
            <option value="">All SDRs</option>
            {model.roster.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
          <button type="submit" className="h-9 rounded-lg border bg-background px-3 text-sm font-semibold hover:bg-muted">Apply</button>
        </form>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Saved sessions" value={rows.length.toLocaleString()} />
        <SummaryCard label="Calls" value={totals.calls.toLocaleString()} />
        <SummaryCard label="Connected" value={totals.connected.toLocaleString()} />
        <SummaryCard label="Talk time" value={formatDuration(totals.talk)} />
      </div>

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold text-foreground">Completed sessions</h2>
          <p className="mt-1 text-sm text-muted-foreground">Most recent 100 reports</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="border-b bg-muted/35 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Session</th>
                {session.role !== "SDR" ? <th className="px-4 py-3 font-semibold">SDR</th> : null}
                <th className="px-4 py-3 text-right font-semibold">Calls</th>
                <th className="px-4 py-3 text-right font-semibold">Connected</th>
                <th className="px-4 py-3 text-right font-semibold">Voicemail</th>
                <th className="px-4 py-3 text-right font-semibold">Unanswered</th>
                <th className="px-4 py-3 text-right font-semibold">Suppressed</th>
                <th className="px-4 py-3 text-right font-semibold">Follow-ups</th>
                <th className="px-5 py-3 text-right font-semibold">Talk time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-foreground">{formatDate(row.startedAt, timeZone)}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">Session length {formatDuration(row.activeDurationSeconds)}</div>
                  </td>
                  {session.role !== "SDR" ? <td className="px-4 py-3.5 font-medium">{row.sdrName}</td> : null}
                  <NumberCell value={row.totalCalls} />
                  <NumberCell value={row.connectedCalls} />
                  <NumberCell value={row.voicemailCalls} />
                  <NumberCell value={row.unansweredCalls} />
                  <NumberCell value={row.suppressedContacts} />
                  <NumberCell value={row.followUpContacts} />
                  <td className="px-5 py-3.5 text-right font-mono font-semibold tabular-nums">{formatDuration(row.totalTalkTimeSeconds)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr><td colSpan={session.role === "SDR" ? 8 : 9} className="px-5 py-14 text-center text-muted-foreground">No completed calling sessions yet. End a Focus session to save its first report.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-card px-4 py-4 shadow-sm"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div></div>;
}

function NumberCell({ value }: { value: number }) {
  return <td className="px-4 py-3.5 text-right font-medium tabular-nums">{value}</td>;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {})
  });
}

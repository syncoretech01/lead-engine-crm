"use client";

import * as React from "react";
import Link from "next/link";
import { readLiveSdrSessionsAction } from "@/app/actions";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  classifyLiveSdrSession,
  countLiveSdrSessions,
  type LiveSdrSessionRow,
  type LiveSdrSessionState,
  type LiveSdrSessionsModel
} from "@/lib/phase1/sdr-live-sessions-read-model";

const POLL_MS = 30_000;

/**
 * "Live now" — which SDRs have a calling session open right now.
 *
 * Server-rendered from the same read model it polls, so the first paint is
 * already correct and a manager with JavaScript disabled still sees the state as
 * of page load. The poll only refreshes while the tab is visible: a dashboard
 * left open on a second monitor overnight should not keep hitting the database.
 */
export function LiveSessionsPanel({ initial }: { initial: LiveSdrSessionsModel }) {
  const [model, setModel] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  // Anchored to the server clock until the browser takes over, so the first
  // client render matches the server's and relative labels never flip on hydrate.
  const [now, setNow] = React.useState(() => Date.parse(initial.generatedAt));

  // A fresh server render (navigation, revalidate) wins over the polled copy.
  // Adjusting state during render rather than in an effect avoids the extra
  // commit — this is the "derive state from props" escape hatch, not a sync.
  const [seed, setSeed] = React.useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setModel(initial);
  }

  React.useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (document.visibilityState !== "visible") return;
      const result = await readLiveSdrSessionsAction();
      if (cancelled) return;
      if (result.ok) {
        setModel(result.model);
        setError(null);
      } else {
        setError(result.error);
      }
    }

    // Catching up on return to the tab matters more than polling behind it.
    const onVisible = () => void refresh();
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const liveCount = countLiveSdrSessions(model.rows, now);
  const stale = model.rows.filter((row) => classifyLiveSdrSession(row, now) === "stale").length;

  return (
    <Panel
      title="Live now"
      subtitle="SDR calling sessions open right now. Refreshes every 30 seconds while this tab is open."
      action={
        <StatusBadge
          label={liveCount ? `${liveCount} on the phones` : "Nobody calling"}
          tone={liveCount ? "success" : "default"}
        />
      }
      flush
      fill
    >
      {error ? (
        <p className="p-5 text-xs text-muted-foreground">
          Live sessions could not be refreshed: {error} Showing the last reading.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SDR</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Session</TableHead>
            <TableHead>Calls</TableHead>
            <TableHead>Talk time</TableHead>
            <TableHead>Last wrap-up</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.rows.map((row) => {
            const state = classifyLiveSdrSession(row, now);
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {state === "live" ? <LivePulse /> : null}
                    <span className="font-medium text-foreground">{row.sdrName}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge label={stateLabel[state]} tone={stateTone[state]} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="text-foreground">{formatElapsed(now - Date.parse(row.startedAt))}</span>
                  <span className="block text-xs">open</span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="text-foreground">{row.totalCalls}</span>
                  <span className="block text-xs">
                    {row.connectedCalls} connected · {row.voicemailCalls} VM · {row.unansweredCalls} unanswered
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="text-foreground">{formatElapsed(row.totalTalkTimeSeconds * 1000)}</span>
                  <span className="block text-xs">{row.followUpContacts} follow-ups set</span>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatAgo(now - Date.parse(row.lastActivityAt))}</TableCell>
              </TableRow>
            );
          })}
          {model.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No calling session is open. Sessions appear here as soon as an SDR starts calling in{" "}
                <Link href="/sdr/focus" className="underline">
                  Focus
                </Link>
                .
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      {stale ? (
        <p className="border-t p-5 text-xs text-muted-foreground">
          {stale === 1 ? "1 session has" : `${stale} sessions have`} been silent for over 90 minutes. A session stays open
          until the SDR ends it, so these are most likely closed tabs rather than reps on a call — they are not counted
          above.
        </p>
      ) : null}
    </Panel>
  );
}

const stateLabel: Record<LiveSdrSessionState, string> = {
  live: "On the phones",
  idle: "Quiet",
  stale: "Never ended"
};

const stateTone: Record<LiveSdrSessionState, "success" | "warning" | "default"> = {
  live: "success",
  idle: "warning",
  stale: "default"
};

function LivePulse() {
  return (
    <span aria-hidden="true" className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--teal-700)] opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--teal-700)]" />
    </span>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function formatAgo(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m ago` : `${Math.floor(hours / 24)}d ago`;
}


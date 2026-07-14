"use client";

import Link from "next/link";

import { useFocusSession } from "@/components/crm/cockpit/focus/use-focus-session";

// Client islands for the (server-rendered) My Day page: the session-gated Resume
// button and the session-sourced "Today's progress" rows. Both read the
// client-only localStorage session via useFocusSession.

export function MyDayResume() {
  const session = useFocusSession();
  if (!session.active) return null;
  return (
    <Link
      href="/sdr/focus"
      className="flex h-[38px] items-center gap-2 rounded-[9px] border border-co-teal-border bg-co-teal-bg px-4 text-[13px] font-bold text-co-teal-text transition-colors hover:bg-co-teal-bg-strong"
    >
      Resume session · {session.completedCount}/{session.total || "—"}
    </Link>
  );
}

export function MyDayProgress() {
  const session = useFocusSession();
  const rows: Array<{ label: string; value: number; teal?: boolean }> = [
    { label: "Calls completed", value: session.completedCount },
    { label: "Connected calls", value: session.connected, teal: true },
    { label: "Follow-ups created", value: session.followUps },
    { label: "Opportunities created", value: session.opps }
  ];
  return (
    <>
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between border-b border-co-divider py-1.5 last:border-0"
        >
          <span className="text-[12px] text-co-text-3">{row.label}</span>
          <span className={`text-[13px] font-extrabold tabular-nums ${row.teal ? "text-co-teal-text" : "text-co-ink"}`}>
            {row.value}
          </span>
        </div>
      ))}
      {!session.active ? (
        <p className="mt-1.5 text-[10.5px] text-co-muted-2">Counts accrue once you start a calling session.</p>
      ) : null}
    </>
  );
}

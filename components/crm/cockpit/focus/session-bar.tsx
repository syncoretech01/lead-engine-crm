"use client";

import { Pause, Play, Square } from "lucide-react";

import type { FocusSession } from "@/components/crm/cockpit/focus/use-focus-session";

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

// The Focus session bar (SDR Cockpit §4) — a 38px white strip shown while a
// calling session runs: pulsing dot, position, progress, live counts, elapsed
// clock, and Pause/Resume + End controls.
export function SessionBar({
  session,
  position,
  total
}: {
  session: FocusSession;
  position: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((session.completedCount / total) * 100)) : 0;

  return (
    <div className="flex h-[38px] shrink-0 items-center gap-3 border-b border-co-border bg-co-surface px-4 text-[12px]">
      <span className="flex items-center gap-1.5">
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-co-teal opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-co-teal" />
        </span>
        <span className="font-extrabold text-co-ink">Session</span>
      </span>

      <span className="whitespace-nowrap text-co-text-3">
        Lead {position} of {total}
      </span>

      <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-co-sunken-2 md:block" aria-hidden="true">
        <div className="h-full rounded-full bg-co-teal transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>

      <div className="hidden items-center gap-3 text-co-text-3 lg:flex">
        <Count label="Completed" value={session.completedCount} />
        <Count label="Connected" value={session.connected} />
        <Count label="Follow-ups" value={session.followUps} />
        <Count label="Opps" value={session.opps} />
      </div>

      <span className="ml-auto whitespace-nowrap font-mono tabular-nums text-co-text-3">
        {formatElapsed(session.elapsedMs)}
      </span>

      {session.running ? (
        <BarButton onClick={session.pause} icon={<Pause className="size-3.5" aria-hidden="true" />} label="Pause" />
      ) : (
        <BarButton onClick={session.resume} icon={<Play className="size-3.5" aria-hidden="true" />} label="Resume" />
      )}
      <BarButton onClick={session.end} icon={<Square className="size-3.5" aria-hidden="true" />} label="End" danger />
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-extrabold tabular-nums text-co-ink">{value}</span> {label}
    </span>
  );
}

function BarButton({
  onClick,
  icon,
  label,
  danger
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition-colors ${
        danger
          ? "border-co-control bg-co-surface text-co-red-text hover:bg-co-red-bg-soft"
          : "border-co-control bg-co-surface text-co-text-3 hover:bg-co-sunken"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

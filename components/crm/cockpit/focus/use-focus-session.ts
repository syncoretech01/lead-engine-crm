"use client";

import * as React from "react";

// The SDR "calling session" is a purely client-side UI concept layered over the
// existing queue order — there is no backend session model (SDR Cockpit §State
// Management). It survives refresh via localStorage so "Resume session" works.
const KEY = "syncore.sdr.session.v1";

type SdrSessionState = {
  id: string;
  startedAt: number;
  pausedAt: number | null; // timestamp while paused, null while running
  pausedMs: number; // accumulated paused duration
  total: number; // queue size at session start (the N in "n/N")
  completed: string[]; // lead ids completed this session
  connected: number;
  voicemail: number;
  unanswered: number;
  suppressed: number;
  followUps: number;
  opps: number;
  totalTalkTimeSeconds: number;
};

export type WrapupSummary = {
  outcome: string;
  connected: boolean;
  followUp: boolean;
  suppressed: boolean;
  opp: boolean;
  talkTimeSeconds: number;
};

export type FocusSession = {
  active: boolean;
  running: boolean;
  id: string;
  startedAt: string;
  elapsedMs: number;
  total: number;
  completedCount: number;
  connected: number;
  voicemail: number;
  unanswered: number;
  suppressed: number;
  followUps: number;
  opps: number;
  totalTalkTimeSeconds: number;
  start: (total?: number) => void;
  pause: () => void;
  resume: () => void;
  end: () => void;
  recordComplete: (leadId: string, summary: WrapupSummary) => void;
};

// The persisted session is external state (localStorage), read via
// useSyncExternalStore so there's no hydration mismatch and no setState-in-effect.
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeRaw(value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value);
  } catch {
    // best effort — a private-mode localStorage failure just loses persistence
  }
  // `storage` events only fire in OTHER tabs, so notify this tab's subscribers too.
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function mutate(next: SdrSessionState | null) {
  writeRaw(next ? JSON.stringify(next) : null);
}

export function useFocusSession(): FocusSession {
  const raw = React.useSyncExternalStore(subscribe, readRaw, () => null);
  const state = React.useMemo<SdrSessionState | null>(() => {
    if (!raw) return null;
    try {
      return parse(raw);
    } catch {
      return null;
    }
  }, [raw]);

  // Track "now" in state, refreshed once a second while the session runs, so the
  // elapsed clock never calls Date.now() during render (purity) and the effect
  // body never calls setState synchronously (the timers do, asynchronously).
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    if (!state || state.pausedAt !== null) return;
    const tick = () => setNow(Date.now());
    const seed = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(seed);
      window.clearInterval(timer);
    };
  }, [state]);

  const start = React.useCallback((total = 0) => {
    if (readRaw()) return; // already running — never restart mid-session
    mutate({
      id: window.crypto?.randomUUID?.() ?? `session-${Date.now()}`,
      startedAt: Date.now(),
      pausedAt: null,
      pausedMs: 0,
      total,
      completed: [],
      connected: 0,
      voicemail: 0,
      unanswered: 0,
      suppressed: 0,
      followUps: 0,
      opps: 0,
      totalTalkTimeSeconds: 0
    });
  }, []);

  const pause = React.useCallback(() => {
    const current = parse(readRaw());
    if (!current || current.pausedAt !== null) return;
    mutate({ ...current, pausedAt: Date.now() });
  }, []);

  const resume = React.useCallback(() => {
    const current = parse(readRaw());
    if (!current || current.pausedAt === null) return;
    mutate({ ...current, pausedMs: current.pausedMs + (Date.now() - current.pausedAt), pausedAt: null });
  }, []);

  const end = React.useCallback(() => {
    mutate(null);
  }, []);

  const recordComplete = React.useCallback((leadId: string, summary: WrapupSummary) => {
    const current = parse(readRaw());
    if (!current) return;
    if (current.completed.includes(leadId)) return;
    mutate({
      ...current,
      completed: [...current.completed, leadId],
      connected: current.connected + (summary.connected ? 1 : 0),
      voicemail: current.voicemail + (summary.outcome === "Voicemail" ? 1 : 0),
      unanswered: current.unanswered + (["No answer", "Busy", "Wrong number"].includes(summary.outcome) ? 1 : 0),
      suppressed: current.suppressed + (summary.suppressed ? 1 : 0),
      followUps: current.followUps + (summary.followUp ? 1 : 0),
      opps: current.opps + (summary.opp ? 1 : 0),
      totalTalkTimeSeconds: current.totalTalkTimeSeconds + Math.max(0, Math.round(summary.talkTimeSeconds))
    });
  }, []);

  const running = state !== null && state.pausedAt === null;
  const elapsedMs = state ? Math.max(0, (state.pausedAt ?? now) - state.startedAt - state.pausedMs) : 0;

  return {
    active: state !== null,
    running,
    id: state?.id ?? "",
    startedAt: state ? new Date(state.startedAt).toISOString() : "",
    elapsedMs,
    total: state?.total ?? 0,
    completedCount: state?.completed.length ?? 0,
    connected: state?.connected ?? 0,
    voicemail: state?.voicemail ?? 0,
    unanswered: state?.unanswered ?? 0,
    suppressed: state?.suppressed ?? 0,
    followUps: state?.followUps ?? 0,
    opps: state?.opps ?? 0,
    totalTalkTimeSeconds: state?.totalTalkTimeSeconds ?? 0,
    start,
    pause,
    resume,
    end,
    recordComplete
  };
}

function parse(raw: string | null): SdrSessionState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SdrSessionState>;
    if (!Number.isFinite(parsed.startedAt)) return null;
    const startedAt = parsed.startedAt as number;
    return {
      id: typeof parsed.id === "string" && parsed.id ? parsed.id : `legacy-${startedAt}`,
      startedAt,
      pausedAt: typeof parsed.pausedAt === "number" ? parsed.pausedAt : null,
      pausedMs: finiteCount(parsed.pausedMs),
      total: finiteCount(parsed.total),
      completed: Array.isArray(parsed.completed) ? parsed.completed.filter((id): id is string => typeof id === "string") : [],
      connected: finiteCount(parsed.connected),
      voicemail: finiteCount(parsed.voicemail),
      unanswered: finiteCount(parsed.unanswered),
      suppressed: finiteCount(parsed.suppressed),
      followUps: finiteCount(parsed.followUps),
      opps: finiteCount(parsed.opps),
      totalTalkTimeSeconds: finiteCount(parsed.totalTalkTimeSeconds)
    };
  } catch {
    return null;
  }
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

"use client";

import * as React from "react";
import { Play } from "lucide-react";

import { cn } from "@/lib/utils";

// Inline audio player for a call recording. Streams the (private) recording via
// the authenticated /api/recordings/[id] route added in Milestone C — until a
// recording exists this component is never rendered by the call log.
export function RecordingPlayer({ callId, className }: { callId: string; className?: string }) {
  const [playing, setPlaying] = React.useState(false);

  if (playing) {
    return (
      <audio
        controls
        autoPlay
        preload="none"
        src={`/api/recordings/${callId}`}
        className={cn("h-8 w-48 max-w-full", className)}
      >
        <track kind="captions" />
      </audio>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className={cn(
        "text-[var(--syn-primary)] hover:bg-[var(--blue-50)] inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs font-medium transition-colors",
        className
      )}
      aria-label="Play call recording"
    >
      <Play className="size-3.5" aria-hidden="true" />
      Play
    </button>
  );
}

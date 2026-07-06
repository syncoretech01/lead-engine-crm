"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarClock,
  CircleDot,
  Mail,
  MessageSquare,
  PhoneCall,
  StickyNote,
  TrendingUp
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { dayKey, formatAbsolute, formatRelative } from "@/lib/format-relative";

export type TimelineKind = "call" | "note" | "email" | "sms" | "task" | "status" | "meeting";

export type TimelineItem = {
  id: string;
  kind: TimelineKind;
  title: string;
  body?: string;
  actor?: string;
  occurredAt: string; // ISO
  href?: string;
};

const KIND_META: Record<TimelineKind, { icon: LucideIcon; label: string; className: string }> = {
  call: { icon: PhoneCall, label: "Calls", className: "text-[var(--syn-primary)]" },
  note: { icon: StickyNote, label: "Notes", className: "text-[var(--fg2)]" },
  email: { icon: Mail, label: "Emails", className: "text-[var(--teal-700)]" },
  sms: { icon: MessageSquare, label: "SMS", className: "text-[var(--teal-700)]" },
  task: { icon: CalendarClock, label: "Tasks", className: "text-[#b45309] dark:text-[#ffc95c]" },
  status: { icon: TrendingUp, label: "Status", className: "text-[var(--syn-primary)]" },
  meeting: { icon: CircleDot, label: "Meetings", className: "text-[var(--syn-primary)]" }
};

export function ActivityTimeline({ items }: { items: TimelineItem[] }) {
  const [active, setActive] = React.useState<TimelineKind | "all">("all");

  const kindsPresent = React.useMemo(() => {
    const set = new Set<TimelineKind>();
    for (const item of items) set.add(item.kind);
    return [...set];
  }, [items]);

  const filtered = active === "all" ? items : items.filter((item) => item.kind === active);

  const groups = React.useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of filtered) {
      const key = dayKey(item.occurredAt);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  if (items.length === 0) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <FilterChip label="All" active={active === "all"} onClick={() => setActive("all")} />
        {kindsPresent.map((kind) => (
          <FilterChip
            key={kind}
            label={KIND_META[kind].label}
            active={active === kind}
            onClick={() => setActive(kind)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {groups.map(([day, dayItems]) => (
          <div key={day} className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</div>
            <ol className="flex flex-col gap-3">
              {dayItems.map((item) => {
                const meta = KIND_META[item.kind];
                const Icon = meta.icon;
                return (
                  <li key={item.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={cn("flex size-7 items-center justify-center rounded-full bg-muted", meta.className)}>
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          {item.href ? (
                            <Link href={item.href} className="hover:underline">
                              {item.title}
                            </Link>
                          ) : (
                            item.title
                          )}
                        </p>
                        <time
                          className="shrink-0 text-xs text-muted-foreground"
                          dateTime={item.occurredAt}
                          title={formatAbsolute(item.occurredAt)}
                          // Relative time is computed from Date.now(), so the SSR
                          // string can differ from the client's by a bucket
                          // ("59m ago" vs "1h ago"). This is the canonical
                          // suppressHydrationWarning case for timestamps.
                          suppressHydrationWarning
                        >
                          {formatRelative(item.occurredAt)}
                        </time>
                      </div>
                      {item.body ? (
                        <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                      ) : null}
                      {item.actor ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.actor}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  );
}

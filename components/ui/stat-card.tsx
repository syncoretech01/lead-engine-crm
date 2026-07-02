import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type StatTone = "default" | "info" | "success" | "warning" | "danger";

// Tinted icon chip per tone (Flexio stat-card signature).
const iconToneClasses: Record<StatTone, string> = {
  default: "bg-[var(--ink-100)] text-[var(--fg2)]",
  info: "bg-[var(--blue-50)] text-[var(--syn-primary)]",
  success: "bg-[var(--teal-50)] text-[var(--teal-700)]",
  warning: "bg-[#fff4e5] text-[#b45309]",
  danger: "bg-[#fdecec] text-[var(--ui-destructive)]"
};

export function ToneIcon({
  icon: Icon,
  tone = "info",
  className
}: {
  icon: LucideIcon;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg",
        iconToneClasses[tone],
        className
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = "info",
  className
}: {
  icon: LucideIcon;
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-3 rounded-xl border p-5 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <ToneIcon icon={Icon} tone={tone} />
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

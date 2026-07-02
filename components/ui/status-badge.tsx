import * as React from "react";

import { statusTone } from "@/components/status-pill";
import { cn } from "@/lib/utils";

export type BadgeTone = "default" | "info" | "success" | "warning" | "danger";

// Flexio-style soft pills: light tinted background + saturated text, fully
// rounded. Colors reference the legacy palette tokens so they stay on-brand.
const toneClasses: Record<BadgeTone, string> = {
  default: "bg-[var(--ink-100)] text-[var(--fg2)]",
  info: "bg-[var(--blue-50)] text-[var(--syn-primary)]",
  success: "bg-[var(--teal-50)] text-[var(--teal-700)]",
  warning: "bg-[#fff4e5] text-[#b45309]",
  danger: "bg-[#fdecec] text-[var(--ui-destructive)]"
};

export function StatusBadge({
  label,
  tone,
  className
}: {
  label: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  const resolved: BadgeTone =
    (tone ?? (typeof label === "string" ? statusTone(label) : undefined)) ?? "default";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClasses[resolved],
        className
      )}
    >
      {label}
    </span>
  );
}

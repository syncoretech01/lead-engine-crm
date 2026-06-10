import type { LucideIcon } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { StatusPill } from "@/components/status-pill";

type MetricCardProps = {
  label: string;
  value: number;
  suffix?: string;
  currency?: boolean;
  note: string;
  tone?: "success" | "info" | "warning" | "danger";
  icon: LucideIcon;
};

export function MetricCard({
  label,
  value,
  suffix,
  currency,
  note,
  tone = "info",
  icon: Icon
}: MetricCardProps) {
  const formatted = currency ? formatCurrency(value) : `${formatNumber(value)}${suffix ?? ""}`;

  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <StatusPill label={tone} tone={tone} />
      </div>
      <div className="metric-value gradient-text">{formatted}</div>
      <div className="workspace-row">
        <span className="metric-note">{note}</span>
        <Icon size={20} aria-hidden="true" />
      </div>
    </article>
  );
}

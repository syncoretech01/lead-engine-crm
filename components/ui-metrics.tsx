import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type MetricTone = "info" | "success" | "warning" | "danger" | "default";

type MetricCardBaseProps = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  note: ReactNode;
  tone?: MetricTone;
};

export function StatCard({ icon: Icon, label, value, note, tone = "info" }: MetricCardBaseProps) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-label">
        <span className="stat-icon">
          <Icon size={15} aria-hidden="true" />
        </span>
        {label}
      </div>
      <strong className="stat-value">{formatMetricValue(value)}</strong>
      <span className="stat-note">{note}</span>
    </article>
  );
}

export function LaneCard({ icon: Icon, label, value, note, tone = "info" }: MetricCardBaseProps) {
  return (
    <article className={`ops-stage-card ${tone}`}>
      <span className="ops-stage-icon">
        <Icon size={17} aria-hidden="true" />
      </span>
      <div>
        <strong>{formatMetricValue(value)}</strong>
        <span>{label}</span>
        <p>{note}</p>
      </div>
    </article>
  );
}

function formatMetricValue(value: ReactNode) {
  return typeof value === "number" ? new Intl.NumberFormat("en-US").format(value) : value;
}

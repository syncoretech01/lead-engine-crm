import { cn } from "@/lib/utils";

type StatusPillProps = {
  label: string;
  tone?: "default" | "success" | "info" | "warning" | "danger";
};

export function StatusPill({ label, tone = "default" }: StatusPillProps) {
  return <span className={cn("pill", tone !== "default" && tone)}>{label}</span>;
}

export function statusTone(label: string): StatusPillProps["tone"] {
  const normalized = label.toLowerCase();

  if (
    normalized.includes("active") ||
    normalized.includes("ready") ||
    normalized.includes("completed") ||
    normalized.includes("closed won") ||
    normalized.includes("connected") ||
    normalized.includes("interested") ||
    normalized.includes("meeting booked") ||
    normalized.includes("qualified") ||
    normalized.includes("won") ||
    normalized.includes("operational") ||
    normalized.includes("on track")
  ) {
    return "success";
  }

  if (
    normalized.includes("mock") ||
    normalized.includes("running") ||
    normalized.includes("open") ||
    normalized.includes("assigned") ||
    normalized.includes("working") ||
    normalized.includes("contacted") ||
    normalized.includes("replied") ||
    normalized.includes("opened") ||
    normalized.includes("delivered") ||
    normalized.includes("sent") ||
    normalized.includes("clicked") ||
    normalized.includes("prospecting") ||
    normalized.includes("discovery") ||
    normalized.includes("exported") ||
    normalized.includes("nurture")
  ) {
    return "info";
  }

  if (normalized.includes("replied") || normalized.includes("proposal")) {
    return "success";
  }

  if (
    normalized.includes("paused") ||
    normalized.includes("review") ||
    normalized.includes("needs") ||
    normalized.includes("queued") ||
    normalized.includes("retry") ||
    normalized.includes("draft") ||
    normalized.includes("overdue") ||
    normalized.includes("due soon") ||
    normalized.includes("needs review") ||
    normalized.includes("soft")
  ) {
    return "warning";
  }

  if (
    normalized.includes("suppressed") ||
    normalized.includes("failed") ||
    normalized.includes("blocked") ||
    normalized.includes("hold") ||
    normalized.includes("lost") ||
    normalized.includes("invalid") ||
    normalized.includes("unsubscribed") ||
    normalized.includes("disqualified") ||
    normalized.includes("bounced") ||
    normalized.includes("spam") ||
    normalized.includes("opt-out") ||
    normalized.includes("failed")
  ) {
    return "danger";
  }

  return "default";
}

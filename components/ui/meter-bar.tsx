/**
 * Thin horizontal meter (e.g. opportunity probability, score). Blue fill on a
 * light track; clamps to 0-100 and shows the rounded value by default.
 */
export function MeterBar({ value, showValue = true }: { value: number; showValue?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-100)]">
        <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
      {showValue ? <span className="text-muted-foreground text-xs tabular-nums">{pct}%</span> : null}
    </div>
  );
}

"use client";

import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";

type FilterChipsProps<TData> = {
  table: Table<TData>;
  columnId: string;
  options: { value: string; label: string }[];
  /** Show a per-option count from the faceted row model. */
  showCounts?: boolean;
};

/**
 * Single-select faceted filter rendered as chips (e.g. call outcomes). Toggling
 * a chip sets/clears the column filter; "All" clears it. Filtering happens
 * client-side via the table's column filter — no server round-trip.
 */
export function DataTableFilterChips<TData>({
  table,
  columnId,
  options,
  showCounts
}: FilterChipsProps<TData>) {
  const column = table.getColumn(columnId);
  if (!column) return null;

  const active = (column.getFilterValue() as string | undefined) ?? "";
  const counts = showCounts ? column.getFacetedUniqueValues() : null;

  const chip = (value: string, label: string, count?: number) => {
    const isActive = active === value || (value === "" && !active);
    return (
      <button
        key={value || "__all"}
        type="button"
        onClick={() => column.setFilterValue(value || undefined)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
          isActive
            ? "border-primary bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted"
        )}
      >
        {label}
        {typeof count === "number" ? <span className="tabular-nums opacity-60">{count}</span> : null}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chip("", "All")}
      {options.map((option) => chip(option.value, option.label, counts?.get(option.value)))}
    </div>
  );
}

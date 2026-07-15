"use client";

import * as React from "react";

// Shared cockpit list primitives — the dense bordered table, tinted badge pills,
// page header, search + filter chips. Every records page composes these so the
// SDR Cockpit list surfaces stay pixel-consistent. Styled with the --co-* tokens.

export type CoTone = "teal" | "amber" | "red" | "info" | "sky" | "neutral";

const toneClass: Record<CoTone, string> = {
  teal: "bg-co-teal-bg text-co-teal-text",
  amber: "bg-co-amber-bg text-co-amber-text",
  red: "bg-co-red-bg text-co-red-text",
  info: "bg-co-accent-bg text-co-blue-dark",
  sky: "bg-co-p3-bg text-co-p3-text",
  neutral: "bg-co-sunken text-co-text-3 ring-1 ring-inset ring-co-border"
};

export function CoPill({ tone = "neutral", children }: { tone?: CoTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[10px] font-bold ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

export const coHeadCell = "px-4 py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted";
export const coBodyCell = "px-4 py-2.5 align-middle text-[12.5px] text-co-ink";

export function CoTableShell({ minWidth = 860, children }: { minWidth?: number; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-co-border bg-co-surface">
      <table className="w-full border-collapse" style={{ minWidth: `${minWidth}px` }}>
        {children}
      </table>
    </div>
  );
}

export function CoListHeader({
  title,
  subline,
  children
}: {
  title: string;
  subline: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[17px] font-extrabold tracking-tight text-co-ink">{title}</h1>
        <p className="mt-0.5 text-[12.5px] text-co-text-3">{subline}</p>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2.5">{children}</div> : null}
    </div>
  );
}

export function CoSearch({
  value,
  onChange,
  placeholder,
  label
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      className="h-9 w-[220px] rounded-lg border border-co-control bg-co-surface px-3 text-[12.5px] text-co-ink placeholder:text-co-muted-2"
    />
  );
}

export function CoChips<T extends string>({
  options,
  value,
  onChange
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {options.map((chip) => {
        const active = value === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            aria-pressed={active}
            className={`h-8 rounded-full px-3 text-[12px] font-bold transition-colors ${
              active ? "bg-co-blue text-white" : "border border-co-control bg-co-surface text-co-text-3 hover:bg-co-sunken"
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

export function CoEmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center text-[12.5px] text-co-muted">
        {message}
      </td>
    </tr>
  );
}

import type { ReactNode } from "react";

type PageHeaderProps = {
  kicker: string;
  title: string;
  copy: string;
  actions?: ReactNode;
};

// Shared page title block used across ~30 pages. Same props as before; Tailwind
// internals at a compact Attio/Linear scale (title 2xl, not 32px). Action forms
// use `display: contents` so a wrapping <form> doesn't break the flex row.
export function PageHeader({ kicker, title, copy, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">{kicker}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy}</p>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end [&_form]:contents">{actions}</div>
      ) : null}
    </header>
  );
}

import * as React from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Flexio "panel": a white card with a bordered header (title + optional subtitle
 * + right-aligned action) and a body. Pass `flush` for full-bleed bodies (tables)
 * where the cell padding provides the inset.
 */
export function Panel({
  title,
  subtitle,
  action,
  children,
  flush = false,
  className
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden p-0", className)}>
      <div className="flex items-start justify-between gap-3 border-b p-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={flush ? "" : "p-5"}>{children}</div>
    </Card>
  );
}

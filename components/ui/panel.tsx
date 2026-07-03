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
  fill = false,
  className
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  /** Fill the parent's height and scroll the body — used inside GridStack tiles. */
  fill?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden p-0", fill && "h-full", className)}>
      <div className="flex items-start justify-between gap-3 border-b p-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn(flush ? "" : "p-5", fill && "min-h-0 flex-1 overflow-auto")}>{children}</div>
    </Card>
  );
}

import * as React from "react";

import { cn } from "@/lib/utils";

/** A keyboard-key hint (e.g. ⌘K). Extracted from the app-shell search button. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export { Kbd };

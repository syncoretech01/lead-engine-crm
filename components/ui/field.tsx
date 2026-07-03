import { cn } from "@/lib/utils";

/**
 * Shared styling for native <input>/<select>/<textarea> in reskinned forms
 * (until a full shadcn form-field migration). Bordered, rounded, blue focus ring
 * — matches the Flexio inputs. Apply via `className={fieldClass}`.
 */
export const fieldClass =
  "h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

/** Multiline variant (auto height) for <textarea>. */
export const fieldTextareaClass = cn(fieldClass, "h-auto min-h-20 py-2");

/** Small muted label above a field. */
export const fieldLabelClass = "text-xs font-medium text-muted-foreground";

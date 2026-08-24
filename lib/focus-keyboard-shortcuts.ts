type FocusShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "metaKey" | "shiftKey"
>;

/** Focus uses bare single-key shortcuts. Modified keys belong to the browser/OS. */
export function allowsFocusKeyboardShortcut(event: FocusShortcutEvent) {
  return !(
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  );
}

/**
 * Bare keys that pick a call outcome, keyed by lowercase key.
 *
 * Each value must match an entry in the wrap-up's `OUTCOMES` list verbatim — the
 * dock both dispatches and draws its keycaps from this table, so a typo here
 * shows up as a missing keycap rather than as a key that silently does nothing.
 * `S` is reserved for save & next, so an outcome starting with S needs a
 * different letter.
 */
export const FOCUS_WRAPUP_OUTCOME_KEYS: Record<string, string> = {
  v: "Voicemail",
  h: "Hang Up"
};

/** The wrap-up actions a keypress can stand in for. */
export type FocusWrapupShortcut = { kind: "save-and-next" } | { kind: "outcome"; outcome: string };

/**
 * Which wrap-up action a keypress means, if any.
 *
 * ⌘/Ctrl+Enter stays live while the SDR is typing, because that is exactly when
 * it is reached for — the note is written, the call is done, save. The bare keys
 * (`S` save & next, plus the outcome keys above) never fire from inside a field
 * or over a text selection, so typing "save the deck" into the note cannot save
 * the wrap-up.
 */
export function focusWrapupShortcut(
  event: FocusShortcutEvent & Pick<KeyboardEvent, "key">,
  context: { editing: boolean }
): FocusWrapupShortcut | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === "Enter") {
    return { kind: "save-and-next" };
  }
  if (context.editing || !allowsFocusKeyboardShortcut(event)) return null;
  const key = event.key.toLowerCase();
  if (key === "s") return { kind: "save-and-next" };
  const outcome = FOCUS_WRAPUP_OUTCOME_KEYS[key];
  return outcome ? { kind: "outcome", outcome } : null;
}

/** The keycap to draw on an outcome chip, if that outcome has a shortcut. */
export function focusWrapupOutcomeKey(outcome: string): string | null {
  const entry = Object.entries(FOCUS_WRAPUP_OUTCOME_KEYS).find(([, value]) => value === outcome);
  return entry ? entry[0].toUpperCase() : null;
}

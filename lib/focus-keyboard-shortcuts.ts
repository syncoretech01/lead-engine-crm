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

/** The wrap-up actions a keypress can stand in for. */
export type FocusWrapupShortcut = "save-and-next" | "voicemail";

/**
 * Which wrap-up action a keypress means, if any.
 *
 * ⌘/Ctrl+Enter stays live while the SDR is typing, because that is exactly when
 * it is reached for — the note is written, the call is done, save. The bare keys
 * (`V` voicemail, `S` save & next) never fire from inside a field or over a text
 * selection, so typing "save the deck" into the note cannot save the wrap-up.
 */
export function focusWrapupShortcut(
  event: FocusShortcutEvent & Pick<KeyboardEvent, "key">,
  context: { editing: boolean }
): FocusWrapupShortcut | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === "Enter") {
    return "save-and-next";
  }
  if (context.editing || !allowsFocusKeyboardShortcut(event)) return null;
  const key = event.key.toLowerCase();
  if (key === "v") return "voicemail";
  if (key === "s") return "save-and-next";
  return null;
}

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

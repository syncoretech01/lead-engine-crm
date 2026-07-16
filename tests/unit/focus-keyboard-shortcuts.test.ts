import { describe, expect, it } from "vitest";

import { allowsFocusKeyboardShortcut } from "@/lib/focus-keyboard-shortcuts";

function event(overrides: Partial<Parameters<typeof allowsFocusKeyboardShortcut>[0]> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    shiftKey: false,
    ...overrides
  };
}

describe("Focus keyboard shortcuts", () => {
  it("allows an unmodified shortcut key", () => {
    expect(allowsFocusKeyboardShortcut(event())).toBe(true);
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { defaultPrevented: true },
    { isComposing: true }
  ])("does not hijack a modified, handled, or composing key: %o", (modifier) => {
    expect(allowsFocusKeyboardShortcut(event(modifier))).toBe(false);
  });
});

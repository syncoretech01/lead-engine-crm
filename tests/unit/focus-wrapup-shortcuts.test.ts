import { describe, expect, it } from "vitest";

import { focusWrapupShortcut } from "@/lib/focus-keyboard-shortcuts";

type Event = Parameters<typeof focusWrapupShortcut>[0];

function key(overrides: Partial<Event> & { key: string }): Event {
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

describe("Focus call wrap-up shortcuts", () => {
  it("maps bare V to the voicemail outcome", () => {
    expect(focusWrapupShortcut(key({ key: "v" }), { editing: false })).toBe("voicemail");
    expect(focusWrapupShortcut(key({ key: "V" }), { editing: false })).toBe("voicemail");
  });

  it("maps bare S to save & next lead", () => {
    expect(focusWrapupShortcut(key({ key: "s" }), { editing: false })).toBe("save-and-next");
  });

  it("keeps ⌘/Ctrl+Enter saving while the SDR is typing the note", () => {
    expect(focusWrapupShortcut(key({ key: "Enter", metaKey: true }), { editing: true })).toBe("save-and-next");
    expect(focusWrapupShortcut(key({ key: "Enter", ctrlKey: true }), { editing: true })).toBe("save-and-next");
  });

  // The failure this guards: typing "voicemail, will retry" into the note must
  // not silently change the outcome or save the wrap-up mid-sentence.
  it("ignores the bare keys while a field has focus", () => {
    expect(focusWrapupShortcut(key({ key: "v" }), { editing: true })).toBeNull();
    expect(focusWrapupShortcut(key({ key: "s" }), { editing: true })).toBeNull();
  });

  it("leaves browser and OS shortcuts alone", () => {
    expect(focusWrapupShortcut(key({ key: "s", metaKey: true }), { editing: false })).toBeNull();
    expect(focusWrapupShortcut(key({ key: "v", ctrlKey: true }), { editing: false })).toBeNull();
    expect(focusWrapupShortcut(key({ key: "s", altKey: true }), { editing: false })).toBeNull();
    expect(focusWrapupShortcut(key({ key: "Enter", metaKey: true, shiftKey: true }), { editing: false })).toBeNull();
  });

  it("ignores handled and IME-composing keypresses", () => {
    expect(focusWrapupShortcut(key({ key: "v", defaultPrevented: true }), { editing: false })).toBeNull();
    expect(focusWrapupShortcut(key({ key: "s", isComposing: true }), { editing: false })).toBeNull();
    expect(focusWrapupShortcut(key({ key: "Enter", metaKey: true, isComposing: true }), { editing: true })).toBeNull();
  });

  it("means nothing for every other key", () => {
    expect(focusWrapupShortcut(key({ key: "Enter" }), { editing: false })).toBeNull();
    expect(focusWrapupShortcut(key({ key: "c" }), { editing: false })).toBeNull();
  });
});

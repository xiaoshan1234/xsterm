import { describe, expect, it } from "vitest";
import { chordFromKeyboardEvent, codeToLabel, formatChord, matchesChord } from "./keyChord";
import type { KeyChord } from "./keyChord";

function keyEvent(init: {
  code: string;
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    code: init.code,
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent;
}

describe("keyChord", () => {
  it("reads physical code and modifiers from a keyboard event", () => {
    const chord = chordFromKeyboardEvent(
      keyEvent({ code: "KeyW", key: "W", ctrlKey: true, shiftKey: true }),
    );
    expect(chord).toEqual({ code: "KeyW", ctrl: true, shift: true, alt: false, meta: false });
  });

  it("falls back to the logical key when code is empty", () => {
    const chord = chordFromKeyboardEvent(keyEvent({ code: "", key: "w", ctrlKey: true }));
    expect(chord.code).toBe("KeyW");
  });

  it("matches chords only when every modifier agrees", () => {
    const base: KeyChord = { code: "KeyC", ctrl: true, shift: true, alt: false, meta: false };
    expect(matchesChord(base, { ...base })).toBe(true);
    expect(matchesChord(base, { ...base, shift: false })).toBe(false);
  });

  it("formats chords and labels physical codes", () => {
    const chord: KeyChord = { code: "KeyW", ctrl: true, shift: true, alt: false, meta: false };
    expect(formatChord(chord)).toBe("Ctrl+Shift+W");
    expect(codeToLabel("Backslash")).toBe("\\");
    expect(codeToLabel("ArrowUp")).toBe("Up");
    expect(codeToLabel("Digit1")).toBe("1");
  });
});

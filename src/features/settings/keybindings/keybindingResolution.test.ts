import { describe, expect, it } from "vitest";
import {
  findConflictingChords,
  findMatchingKeybinding,
  resolveKeybindings,
  sanitizeKeybindingOverrides,
} from "./keybindingResolution";
import type { KeybindingEntry } from "./keybindingContracts";

function chord(
  code: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
) {
  return {
    code,
    ctrl: modifiers.ctrl ?? false,
    shift: modifiers.shift ?? false,
    alt: modifiers.alt ?? false,
    meta: modifiers.meta ?? false,
  };
}

describe("keybindingResolution", () => {
  it("resolves defaults when no overrides exist", () => {
    const bindings = resolveKeybindings([]);
    expect(bindings).toHaveLength(21);
    expect(bindings.every((binding) => binding.enabled)).toBe(true);
  });

  it("merges a user override over the default for the same action", () => {
    const bindings = resolveKeybindings([
      {
        actionId: "app.closePane",
        chords: [chord("KeyQ", { ctrl: true, shift: true })],
        enabled: false,
      },
    ]);
    const closePane = bindings.find((binding) => binding.actionId === "app.closePane");
    expect(closePane).toEqual({
      actionId: "app.closePane",
      chords: [chord("KeyQ", { ctrl: true, shift: true })],
      enabled: false,
    });
  });

  it("matches a binding only in its own context", () => {
    const bindings = resolveKeybindings([]);
    const closePaneChord = chord("KeyW", { ctrl: true, shift: true });
    expect(findMatchingKeybinding(bindings, closePaneChord, "app")?.actionId).toBe("app.closePane");
    expect(findMatchingKeybinding(bindings, closePaneChord, "terminal")).toBeUndefined();
  });

  it("detects two actions sharing the same chord in one context", () => {
    const bindings: KeybindingEntry[] = [
      {
        actionId: "app.closePane",
        chords: [chord("KeyW", { ctrl: true, shift: true })],
        enabled: true,
      },
      {
        actionId: "app.newSession",
        chords: [chord("KeyW", { ctrl: true, shift: true })],
        enabled: true,
      },
    ];
    expect(findConflictingChords(bindings).size).toBe(1);
  });

  it("drops unknown actions and empty chord lists when sanitizing", () => {
    const sanitized = sanitizeKeybindingOverrides([
      {
        actionId: "app.closePane",
        chords: [chord("KeyW", { ctrl: true, shift: true })],
        enabled: true,
      },
      {
        actionId: "unknown.action",
        chords: [chord("KeyZ")],
        enabled: true,
      } as unknown as KeybindingEntry,
      {
        actionId: "app.toggleLogs",
        chords: [],
        enabled: true,
      },
    ]);
    expect(sanitized.map((binding) => binding.actionId)).toEqual(["app.closePane"]);
  });
});

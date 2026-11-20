import type { KeyChord } from "../../../shared/keyboard";
import type { KeybindingAction, KeybindingEntry } from "./keybindingContracts";

function chord(code: string, modifiers: Partial<Omit<KeyChord, "code">> = {}): KeyChord {
  return { code, ctrl: false, shift: false, alt: false, meta: false, ...modifiers };
}

export const KEYBINDING_ACTIONS: readonly KeybindingAction[] = [
  {
    id: "app.newSession",
    label: "New session",
    context: "app",
    defaultChords: [chord("KeyN", { ctrl: true, shift: true })],
  },
  {
    id: "app.closePane",
    label: "Close pane",
    context: "app",
    defaultChords: [chord("KeyW", { ctrl: true, shift: true })],
  },
  {
    id: "app.toggleLogs",
    label: "Toggle logs",
    context: "app",
    defaultChords: [chord("KeyL", { ctrl: true, shift: true })],
  },
  {
    id: "app.nextPane",
    label: "Next pane",
    context: "app",
    defaultChords: [chord("Tab", { ctrl: true })],
  },
  {
    id: "app.prevPane",
    label: "Previous pane",
    context: "app",
    defaultChords: [chord("Tab", { ctrl: true, shift: true })],
  },
  {
    id: "app.splitVertical",
    label: "Split pane vertically",
    context: "app",
    defaultChords: [chord("Backslash", { ctrl: true, shift: true })],
  },
  {
    id: "app.splitHorizontal",
    label: "Split pane horizontally",
    context: "app",
    defaultChords: [chord("Slash", { ctrl: true, shift: true })],
  },
  {
    id: "terminal.copy",
    label: "Copy",
    context: "terminal",
    defaultChords: [
      chord("KeyC", { ctrl: true, shift: true }),
      chord("Insert", { ctrl: true }),
      chord("KeyC", { meta: true }),
    ],
  },
  {
    id: "terminal.paste",
    label: "Paste",
    context: "terminal",
    defaultChords: [chord("KeyV", { ctrl: true, shift: true })],
  },
  {
    id: "terminal.selectAll",
    label: "Select all",
    context: "terminal",
    defaultChords: [chord("KeyA", { ctrl: true, shift: true })],
  },
  {
    id: "terminal.clear",
    label: "Clear",
    context: "terminal",
    defaultChords: [chord("KeyK", { ctrl: true, shift: true })],
  },
];

export function getDefaultKeybindings(): KeybindingEntry[] {
  return KEYBINDING_ACTIONS.map((action) => ({
    actionId: action.id,
    chords: [...action.defaultChords],
    enabled: true,
  }));
}

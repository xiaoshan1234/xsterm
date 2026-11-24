import type { KeyChord } from "../../../shared/keyboard";

export type KeybindingContextName = "app" | "terminal";

export type AppKeybindingActionId =
  | "app.newSession"
  | "app.closePane"
  | "app.toggleLogs"
  | "app.nextPane"
  | "app.prevPane"
  | "app.splitVertical"
  | "app.splitHorizontal"
  | "app.nextWindow"
  | "app.prevWindow"
  | "app.openWindow"
  | "app.closeWindow"
  | "app.toggleToolPanel"
  | "app.nextToolPanel"
  | "app.prevToolPanel";

export type TerminalKeybindingActionId =
  | "terminal.copy"
  | "terminal.paste"
  | "terminal.selectAll"
  | "terminal.clear"
  | "bookmark.toggle"
  | "bookmark.next"
  | "bookmark.prev";

export type KeybindingActionId = AppKeybindingActionId | TerminalKeybindingActionId;

export interface KeybindingAction {
  id: KeybindingActionId;
  label: string;
  context: KeybindingContextName;
  defaultChords: KeyChord[];
}

export interface KeybindingEntry {
  actionId: KeybindingActionId;
  chords: KeyChord[];
  enabled: boolean;
}

export interface KeybindingsConfig {
  version: 1;
  overrides: KeybindingEntry[];
}

import type { KeybindingActionId, KeybindingEntry } from "./keybindings/keybindingContracts";

export interface SessionPreferencesContextType {
  globalLocalEcho: boolean;
  setGlobalLocalEcho: (enabled: boolean) => void;
  keybindings: KeybindingEntry[];
  updateKeybinding: (actionId: KeybindingActionId, entry: KeybindingEntry) => void;
  resetKeybinding: (actionId: KeybindingActionId) => void;
  resetAllKeybindings: () => void;
}

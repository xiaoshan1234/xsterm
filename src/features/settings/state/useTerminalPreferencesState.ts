import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { resolveKeybindings } from "../keybindings/keybindingResolution";
import type { KeybindingActionId, KeybindingEntry } from "../keybindings/keybindingContracts";

export interface TerminalPreferencesState {
  globalLocalEcho: boolean;
  setGlobalLocalEcho: Dispatch<SetStateAction<boolean>>;
  sessionLocalEchoOverrides: Map<number, boolean>;
  getEffectiveLocalEcho: (terminalId: number) => boolean;
  keybindingsOverrides: KeybindingEntry[];
  setKeybindingsOverrides: Dispatch<SetStateAction<KeybindingEntry[]>>;
  keybindings: KeybindingEntry[];
  updateKeybinding: (actionId: KeybindingActionId, entry: KeybindingEntry) => void;
  resetKeybinding: (actionId: KeybindingActionId) => void;
  resetAllKeybindings: () => void;
}

export function useTerminalPreferencesState(): TerminalPreferencesState {
  const [globalLocalEcho, setGlobalLocalEcho] = useState(false);
  const [sessionLocalEchoOverrides] = useState<Map<number, boolean>>(new Map());
  const [keybindingsOverrides, setKeybindingsOverrides] = useState<KeybindingEntry[]>([]);

  const getEffectiveLocalEcho = useCallback(
    (terminalId: number) => {
      if (sessionLocalEchoOverrides.has(terminalId)) {
        return sessionLocalEchoOverrides.get(terminalId)!;
      }
      return globalLocalEcho;
    },
    [globalLocalEcho, sessionLocalEchoOverrides],
  );

  const keybindings = useMemo(
    () => resolveKeybindings(keybindingsOverrides),
    [keybindingsOverrides],
  );

  const updateKeybinding = useCallback((actionId: KeybindingActionId, entry: KeybindingEntry) => {
    setKeybindingsOverrides((previous) => [
      ...previous.filter((item) => item.actionId !== actionId),
      entry,
    ]);
  }, []);

  const resetKeybinding = useCallback((actionId: KeybindingActionId) => {
    setKeybindingsOverrides((previous) => previous.filter((item) => item.actionId !== actionId));
  }, []);

  const resetAllKeybindings = useCallback(() => {
    setKeybindingsOverrides([]);
  }, []);

  return {
    globalLocalEcho,
    setGlobalLocalEcho,
    sessionLocalEchoOverrides,
    getEffectiveLocalEcho,
    keybindingsOverrides,
    setKeybindingsOverrides,
    keybindings,
    updateKeybinding,
    resetKeybinding,
    resetAllKeybindings,
  };
}

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export interface TerminalPreferencesState {
  globalLocalEcho: boolean;
  setGlobalLocalEcho: Dispatch<SetStateAction<boolean>>;
  sessionLocalEchoOverrides: Map<number, boolean>;
  getEffectiveLocalEcho: (terminalId: number) => boolean;
}

export function useTerminalPreferencesState(): TerminalPreferencesState {
  const [globalLocalEcho, setGlobalLocalEcho] = useState(false);
  const [sessionLocalEchoOverrides] = useState<Map<number, boolean>>(new Map());

  const getEffectiveLocalEcho = useCallback(
    (terminalId: number) => {
      if (sessionLocalEchoOverrides.has(terminalId)) {
        return sessionLocalEchoOverrides.get(terminalId)!;
      }
      return globalLocalEcho;
    },
    [globalLocalEcho, sessionLocalEchoOverrides],
  );

  return {
    globalLocalEcho,
    setGlobalLocalEcho,
    sessionLocalEchoOverrides,
    getEffectiveLocalEcho,
  };
}

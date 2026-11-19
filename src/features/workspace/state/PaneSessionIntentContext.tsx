import { createContext, useContext, type ReactNode } from "react";
import { type PaneSessionIntentActions } from "../contracts";

interface PaneSessionIntentProviderProps {
  children: ReactNode;
  value: PaneSessionIntentActions;
}

const PaneSessionIntentContext = createContext<PaneSessionIntentActions | null>(null);

export function PaneSessionIntentProvider({ children, value }: PaneSessionIntentProviderProps) {
  return (
    <PaneSessionIntentContext.Provider value={value}>{children}</PaneSessionIntentContext.Provider>
  );
}

export function usePaneSessionIntents(): PaneSessionIntentActions {
  const value = useContext(PaneSessionIntentContext);
  if (value === null) {
    throw new Error("usePaneSessionIntents must be used within PaneSessionIntentProvider");
  }
  return value;
}

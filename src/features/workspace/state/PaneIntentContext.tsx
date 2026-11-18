import { createContext, useContext, type ReactNode } from "react";
import { type PaneIntentActions } from "../contracts";

interface PaneIntentProviderProps {
  children: ReactNode;
  value: PaneIntentActions;
}

const PaneIntentContext = createContext<PaneIntentActions | null>(null);

export function PaneIntentProvider({ children, value }: PaneIntentProviderProps) {
  return <PaneIntentContext.Provider value={value}>{children}</PaneIntentContext.Provider>;
}

export function usePaneIntents(): PaneIntentActions {
  const value = useContext(PaneIntentContext);
  if (value === null) {
    throw new Error("usePaneIntents must be used within PaneIntentProvider");
  }
  return value;
}

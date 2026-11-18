import { createContext, useContext, type ReactNode } from "react";
import { type TerminalRuntimeContextType } from "../contracts";

interface TerminalRuntimeProviderProps {
  children: ReactNode;
  value: TerminalRuntimeContextType;
}

const TerminalRuntimeContext = createContext<TerminalRuntimeContextType | null>(null);

export function TerminalRuntimeProvider({ children, value }: TerminalRuntimeProviderProps) {
  return (
    <TerminalRuntimeContext.Provider value={value}>{children}</TerminalRuntimeContext.Provider>
  );
}

export function useTerminalRuntime(): TerminalRuntimeContextType {
  const value = useContext(TerminalRuntimeContext);
  if (value === null) {
    throw new Error("useTerminalRuntime must be used within TerminalRuntimeProvider");
  }
  return value;
}

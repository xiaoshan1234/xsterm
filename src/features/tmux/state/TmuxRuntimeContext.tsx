import { createContext, useContext, type ReactNode } from "react";
import { type TmuxRuntimeContextType } from "../contracts";

interface TmuxRuntimeProviderProps {
  children: ReactNode;
  value: TmuxRuntimeContextType;
}

const TmuxRuntimeContext = createContext<TmuxRuntimeContextType | null>(null);

export function TmuxRuntimeProvider({ children, value }: TmuxRuntimeProviderProps) {
  return <TmuxRuntimeContext.Provider value={value}>{children}</TmuxRuntimeContext.Provider>;
}

export function useTmuxRuntime(): TmuxRuntimeContextType {
  const value = useContext(TmuxRuntimeContext);
  if (value === null) {
    throw new Error("useTmuxRuntime must be used within TmuxRuntimeProvider");
  }
  return value;
}

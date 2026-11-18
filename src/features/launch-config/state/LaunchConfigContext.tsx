import { createContext, useContext, type ReactNode } from "react";
import { type SavedLaunchConfigsContextType } from "../contracts";

interface LaunchConfigProviderProps {
  children: ReactNode;
  value: SavedLaunchConfigsContextType;
}

const LaunchConfigContext = createContext<SavedLaunchConfigsContextType | null>(null);

export function LaunchConfigProvider({ children, value }: LaunchConfigProviderProps) {
  return <LaunchConfigContext.Provider value={value}>{children}</LaunchConfigContext.Provider>;
}

export function useSavedLaunchConfigs(): SavedLaunchConfigsContextType {
  const value = useContext(LaunchConfigContext);
  if (value === null) {
    throw new Error("useSavedLaunchConfigs must be used within LaunchConfigProvider");
  }
  return value;
}

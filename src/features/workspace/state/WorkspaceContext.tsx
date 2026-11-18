import { createContext, useContext, type ReactNode } from "react";
import { type WorkspaceLayoutContextType } from "../contracts";

interface WorkspaceProviderProps {
  children: ReactNode;
  value: WorkspaceLayoutContextType;
}

const WorkspaceContext = createContext<WorkspaceLayoutContextType | null>(null);

export function WorkspaceProvider({ children, value }: WorkspaceProviderProps) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceLayout(): WorkspaceLayoutContextType {
  const value = useContext(WorkspaceContext);
  if (value === null) {
    throw new Error("useWorkspaceLayout must be used within WorkspaceProvider");
  }
  return value;
}

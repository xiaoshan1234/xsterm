import { createContext, useContext, type ReactNode } from "react";
import { type WorkspacePaneRuntimeActions } from "../contracts";

const WorkspacePaneRuntimeActionsContext = createContext<WorkspacePaneRuntimeActions | null>(null);

export function WorkspacePaneRuntimeActionsProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: WorkspacePaneRuntimeActions;
}) {
  return (
    <WorkspacePaneRuntimeActionsContext.Provider value={value}>
      {children}
    </WorkspacePaneRuntimeActionsContext.Provider>
  );
}

export function useWorkspacePaneRuntimeActions(): WorkspacePaneRuntimeActions {
  const value = useContext(WorkspacePaneRuntimeActionsContext);
  if (value === null) {
    throw new Error(
      "useWorkspacePaneRuntimeActions must be used within WorkspacePaneRuntimeActionsProvider",
    );
  }
  return value;
}

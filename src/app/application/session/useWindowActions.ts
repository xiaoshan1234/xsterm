import type { TerminalId, WorkspaceId } from "../../../models";
import type { SavedTerminalConfig } from "../../../features/launch-config";
import type { Terminal } from "../../../features/terminal";
import type { Window, Workspace } from "../../../features/workspace";
import { useWindowLayoutActions } from "./useWindowLayoutActions";
import { useWindowLifecycleActions } from "./useWindowLifecycleActions";
import { useWindowOpenActions } from "./useWindowOpenActions";

interface UseWindowActionsDeps {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: React.MutableRefObject<Terminal[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  activeWorkspaceId: WorkspaceId | null;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<TerminalId>>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
  killTmuxWindow: (xstermWindowId: number) => Promise<void>;
  createWindowFromSession: (
    terminalId: TerminalId,
    configId: string,
    name?: string,
    targetWorkspaceId?: WorkspaceId,
  ) => Window;
}

export function useWindowActions(deps: UseWindowActionsDeps) {
  const layout = useWindowLayoutActions({
    terminalsRef: deps.terminalsRef,
    workspacesRef: deps.workspacesRef,
    setSessions: deps.setSessions,
    setWorkspaces: deps.setWorkspaces,
  });
  const createWindowFromSavedConfig = useWindowOpenActions({
    savedConfigs: deps.savedConfigs,
    workspacesRef: deps.workspacesRef,
    activeWorkspaceId: deps.activeWorkspaceId,
    createTerminalFromSavedConfig: deps.createTerminalFromSavedConfig,
    createWindowFromSession: deps.createWindowFromSession,
  });
  const closeWindow = useWindowLifecycleActions({
    workspacesRef: deps.workspacesRef,
    setSessions: deps.setSessions,
    setWorkspaces: deps.setWorkspaces,
    establishingSessionsRef: deps.establishingSessionsRef,
    closeTerminal: deps.closeTerminal,
    killTmuxWindow: deps.killTmuxWindow,
    createInitWindow: layout.createInitWindow,
  });

  return {
    ...layout,
    createWindowFromSavedConfig,
    closeWindow,
  };
}

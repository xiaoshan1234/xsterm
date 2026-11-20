import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";
import { useSavedTerminalConfigActions } from "./useSavedTerminalConfigActions";
import { useTerminalCloseAction } from "./useTerminalCloseAction";
import { useTerminalMetadataActions } from "./useTerminalMetadataActions";
import { useTerminalReconnectAction } from "./useTerminalReconnectAction";

type MaintenanceDeps = Pick<
  UseSessionLifecycleDeps,
  | "savedConfigs"
  | "terminalsRef"
  | "setSessions"
  | "setWorkspaces"
  | "activeWorkspaceId"
  | "establishingSessionsRef"
  | "updateConfigs"
  | "updateGroups"
  | "openFromConfigInternal"
  | "createWindowFromSession"
>;

export function useTerminalMaintenanceActions(deps: MaintenanceDeps) {
  const savedConfig = useSavedTerminalConfigActions({
    savedConfigs: deps.savedConfigs,
    terminalsRef: deps.terminalsRef,
    activeWorkspaceId: deps.activeWorkspaceId,
    setSessions: deps.setSessions,
    setWorkspaces: deps.setWorkspaces,
    updateConfigs: deps.updateConfigs,
    updateGroups: deps.updateGroups,
    openFromConfigInternal: deps.openFromConfigInternal,
    createWindowFromSession: deps.createWindowFromSession,
  });
  const closeTerminal = useTerminalCloseAction({
    setSessions: deps.setSessions,
    setWorkspaces: deps.setWorkspaces,
  });
  const reconnectSession = useTerminalReconnectAction({
    savedConfigs: deps.savedConfigs,
    terminalsRef: deps.terminalsRef,
    setSessions: deps.setSessions,
    setWorkspaces: deps.setWorkspaces,
    establishingSessionsRef: deps.establishingSessionsRef,
  });
  const metadata = useTerminalMetadataActions({
    terminalsRef: deps.terminalsRef,
    setSessions: deps.setSessions,
    updateConfigs: deps.updateConfigs,
  });

  return {
    ...savedConfig,
    closeTerminal,
    reconnectSession,
    ...metadata,
  };
}

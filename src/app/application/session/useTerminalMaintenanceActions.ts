import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";
import { useSavedTerminalConfigActions } from "./useSavedTerminalConfigActions";
import { useTerminalCloseAction } from "./useTerminalCloseAction";
import { useTerminalMetadataActions } from "./useTerminalMetadataActions";
import { useTerminalReconnectAction } from "./useTerminalReconnectAction";

type MaintenanceDeps = Pick<
  UseSessionLifecycleDeps,
  | "savedConfigs"
  | "terminalsRef"
  | "setTerminals"
  | "setWorkspaces"
  | "activeWorkspaceId"
  | "establishingTerminalsRef"
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
    setTerminals: deps.setTerminals,
    setWorkspaces: deps.setWorkspaces,
    updateConfigs: deps.updateConfigs,
    updateGroups: deps.updateGroups,
    openFromConfigInternal: deps.openFromConfigInternal,
    createWindowFromSession: deps.createWindowFromSession,
  });
  const closeTerminal = useTerminalCloseAction({
    setTerminals: deps.setTerminals,
    setWorkspaces: deps.setWorkspaces,
  });
  const reconnectSession = useTerminalReconnectAction({
    savedConfigs: deps.savedConfigs,
    terminalsRef: deps.terminalsRef,
    setTerminals: deps.setTerminals,
    setWorkspaces: deps.setWorkspaces,
    establishingTerminalsRef: deps.establishingTerminalsRef,
  });
  const metadata = useTerminalMetadataActions({
    terminalsRef: deps.terminalsRef,
    setTerminals: deps.setTerminals,
    updateConfigs: deps.updateConfigs,
  });

  return {
    ...savedConfig,
    closeTerminal,
    reconnectSession,
    ...metadata,
  };
}

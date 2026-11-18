import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";
import { useLocalTerminalCreationActions } from "./useLocalTerminalCreationActions";
import { useTerminalMaintenanceActions } from "./useTerminalMaintenanceActions";
import { useTmuxLifecycleActions } from "./useTmuxLifecycleActions";

export function useTerminalLifecycle(deps: UseSessionLifecycleDeps) {
  const localCreation = useLocalTerminalCreationActions(deps);
  const tmuxLifecycle = useTmuxLifecycleActions(deps);
  const maintenance = useTerminalMaintenanceActions(deps);

  return {
    ...localCreation,
    ...tmuxLifecycle,
    ...maintenance,
  };
}

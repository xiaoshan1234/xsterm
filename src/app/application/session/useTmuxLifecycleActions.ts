import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";
import { useTmuxControllerTracking } from "./useTmuxControllerTracking";
import { useTmuxRecoveryActions } from "./useTmuxRecoveryActions";
import { useTmuxSessionActions } from "./useTmuxSessionActions";

type TmuxLifecycleDeps = Pick<
  UseSessionLifecycleDeps,
  | "savedConfigs"
  | "terminalsRef"
  | "setTerminals"
  | "setWorkspaces"
  | "establishingTerminalsRef"
  | "updateConfigs"
  | "tmuxControllerConfigsRef"
  | "tmuxControllerConfigIdsRef"
  | "syncOpenTmuxSessions"
  | "pendingTmuxSessionKeysRef"
  | "tmuxControllersClosingRef"
>;

export function useTmuxLifecycleActions(deps: TmuxLifecycleDeps) {
  const tracking = useTmuxControllerTracking(deps);
  const sessions = useTmuxSessionActions({ tracking });
  const recovery = useTmuxRecoveryActions({
    tracking,
    savedConfigs: deps.savedConfigs,
    terminalsRef: deps.terminalsRef,
    setTerminals: deps.setTerminals,
    tmuxControllerConfigsRef: deps.tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef: deps.tmuxControllerConfigIdsRef,
    syncOpenTmuxSessions: deps.syncOpenTmuxSessions,
    tmuxControllersClosingRef: deps.tmuxControllersClosingRef,
  });

  return {
    attachTmuxSession: sessions.attachTmuxSession,
    createTmuxSession: sessions.createTmuxSession,
    detachTmuxSession: recovery.detachTmuxSession,
    reconnectTmuxSession: recovery.reconnectTmuxSession,
  };
}

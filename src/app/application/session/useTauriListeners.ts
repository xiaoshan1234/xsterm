import { useTerminalEventBridge } from "../../../features/terminal";
import { useTmuxEventBridge } from "./useTmuxEventBridge";
import { type TerminalState } from "./types";

type EventBridgeState = Pick<
  TerminalState,
  | "setSessions"
  | "setWorkspaces"
  | "terminalsRef"
  | "workspacesRef"
  | "establishingSessionsRef"
  | "setTmuxControllerErrors"
  | "tmuxControllerConfigsRef"
  | "tmuxControllerConfigIdsRef"
  | "syncOpenTmuxSessions"
  | "tmuxControllersClosingRef"
>;

export function useTauriListeners({
  setSessions,
  setWorkspaces,
  terminalsRef,
  workspacesRef,
  establishingSessionsRef,
  setTmuxControllerErrors,
  tmuxControllerConfigsRef,
  tmuxControllerConfigIdsRef,
  syncOpenTmuxSessions,
  tmuxControllersClosingRef,
}: EventBridgeState): void {
  useTerminalEventBridge({
    setTerminals: setSessions,
    setWorkspaces,
    terminalsRef,
    establishingSessionsRef,
  });

  useTmuxEventBridge({
    setTerminals: setSessions,
    setWorkspaces,
    terminalsRef,
    workspacesRef,
    establishingSessionsRef,
    setTmuxControllerErrors,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    syncOpenTmuxSessions,
    tmuxControllersClosingRef,
  });
}

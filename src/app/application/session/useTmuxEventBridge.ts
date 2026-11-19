import { useEffect } from "react";
import { tmuxEventStream } from "../../../features/tmux";
import { createTmuxControllerEventHandlers } from "./tmuxControllerEventHandlers";
import type { TmuxEventBridgePorts } from "./tmuxEventBridgePorts";
import { createTmuxWindowEventHandlers } from "./tmuxWindowEventHandlers";

interface TmuxEventBridgeOptions extends TmuxEventBridgePorts {
  isEnabled: boolean;
}

export function useTmuxEventBridge({
  isEnabled,
  setTerminals,
  setWorkspaces,
  terminalsRef,
  workspacesRef,
  establishingSessionsRef,
  setTmuxControllerErrors,
  tmuxControllerConfigsRef,
  tmuxControllerConfigIdsRef,
  syncOpenTmuxSessions,
  tmuxControllersClosingRef,
}: TmuxEventBridgeOptions): void {
  useEffect(() => {
    if (!isEnabled) return;
    let isDisposed = false;
    let cleanup: (() => void) | undefined;

    const ports: TmuxEventBridgePorts = {
      setTerminals,
      setWorkspaces,
      terminalsRef,
      workspacesRef,
      establishingSessionsRef,
      setTmuxControllerErrors,
      tmuxControllerConfigsRef,
      tmuxControllerConfigIdsRef,
      syncOpenTmuxSessions,
      tmuxControllersClosingRef,
    };

    const subscribe = async () => {
      try {
        const unsubscribe = await tmuxEventStream.subscribe({
          ...createTmuxControllerEventHandlers(ports),
          ...createTmuxWindowEventHandlers(ports),
        });

        if (isDisposed) {
          unsubscribe();
        } else {
          cleanup = unsubscribe;
        }
      } catch (error) {
        console.error("Failed to subscribe to tmux events:", error);
      }
    };

    void subscribe();
    return () => {
      isDisposed = true;
      cleanup?.();
    };
  }, [
    establishingSessionsRef,
    isEnabled,
    setTerminals,
    setTmuxControllerErrors,
    setWorkspaces,
    syncOpenTmuxSessions,
    terminalsRef,
    tmuxControllerConfigIdsRef,
    tmuxControllerConfigsRef,
    tmuxControllersClosingRef,
    workspacesRef,
  ]);
}

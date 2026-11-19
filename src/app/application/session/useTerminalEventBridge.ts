import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createTerminalId, type TerminalId } from "../../../models";
import { terminalEventStream } from "../../../features/terminal";
import { removeSessionsFromWorkspaces } from "../../../features/workspace";
import type { Terminal } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";

interface TerminalEventBridgeOptions {
  isEnabled: boolean;
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  terminalsRef: MutableRefObject<Terminal[]>;
  establishingSessionsRef: MutableRefObject<Set<TerminalId>>;
}

export function useTerminalEventBridge({
  isEnabled,
  setTerminals,
  setWorkspaces,
  terminalsRef,
  establishingSessionsRef,
}: TerminalEventBridgeOptions): void {
  useEffect(() => {
    if (!isEnabled) return;
    let isDisposed = false;
    let cleanup: (() => void) | undefined;

    const subscribe = async () => {
      try {
        const unsubscribe = await terminalEventStream.subscribe({
          onDisconnected: ({ terminalHandle }) => {
            const terminalId = createTerminalId(Number(terminalHandle));
            establishingSessionsRef.current.delete(terminalId);
            setTerminals((terminals) =>
              terminals.map((terminal) =>
                terminal.id === terminalId ? { ...terminal, isConnected: false } : terminal,
              ),
            );
          },
          onClosed: ({ terminalHandle }) => {
            const terminalId = createTerminalId(Number(terminalHandle));
            establishingSessionsRef.current.delete(terminalId);
            if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) return;

            setTerminals((terminals) => terminals.filter((terminal) => terminal.id !== terminalId));
            setWorkspaces((workspaces) => removeSessionsFromWorkspaces(workspaces, [terminalId]));
          },
        });

        if (isDisposed) {
          unsubscribe();
        } else {
          cleanup = unsubscribe;
        }
      } catch (error) {
        console.error("Failed to subscribe to terminal events:", error);
      }
    };

    void subscribe();
    return () => {
      isDisposed = true;
      cleanup?.();
    };
  }, [establishingSessionsRef, isEnabled, setTerminals, setWorkspaces, terminalsRef]);
}

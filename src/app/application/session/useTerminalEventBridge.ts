import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { terminalEventStream } from "../../../features/terminal";
import { removeSessionsFromWorkspaces } from "../../../features/workspace";
import type { Terminal } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";

interface TerminalEventBridgeOptions {
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  terminalsRef: MutableRefObject<Terminal[]>;
  establishingSessionsRef: MutableRefObject<Set<number>>;
}

export function useTerminalEventBridge({
  setTerminals,
  setWorkspaces,
  terminalsRef,
  establishingSessionsRef,
}: TerminalEventBridgeOptions): void {
  useEffect(() => {
    let isDisposed = false;
    let cleanup: (() => void) | undefined;

    const subscribe = async () => {
      try {
        const unsubscribe = await terminalEventStream.subscribe({
          onDisconnected: ({ terminalHandle }) => {
            const terminalId = Number(terminalHandle);
            establishingSessionsRef.current.delete(terminalId);
            setTerminals((terminals) =>
              terminals.map((terminal) =>
                terminal.id === terminalId ? { ...terminal, isConnected: false } : terminal,
              ),
            );
          },
          onClosed: ({ terminalHandle }) => {
            const terminalId = Number(terminalHandle);
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
  }, [establishingSessionsRef, setTerminals, setWorkspaces, terminalsRef]);
}

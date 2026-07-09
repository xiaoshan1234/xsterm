import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { findPaneNode, getLeafPaneIds, isSessionInPaneTree, removeSessionAndCollapse, withRecomputedSessionIds } from "./paneUtils";
import { SessionState } from "./types";

type ListenersState = Pick<
  SessionState,
  | "setSessions"
  | "setWorkspaces"
  | "sessionsRef"
  | "workspacesRef"
  | "establishingSessionsRef"
>;

export function useTauriListeners({
  setSessions,
  setWorkspaces,
  sessionsRef,
  workspacesRef,
  establishingSessionsRef,
}: ListenersState): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    (async () => {
      const unlistenSessionDisconnected = await listen<number>("session-disconnected", (event) => {
        const sessionId = event.payload;
        establishingSessionsRef.current.delete(sessionId);
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, is_connected: false } : s)));
      }).catch((e) => {
        console.error("Failed to listen session-disconnected:", e);
        return null;
      });
      if (cancelled) {
        unlistenSessionDisconnected?.();
        return;
      }
      if (unlistenSessionDisconnected) unlisteners.push(unlistenSessionDisconnected);

      const unlistenSessionClosed = await listen<number>("session-closed", (event) => {
        const sessionId = event.payload;
        establishingSessionsRef.current.delete(sessionId);
        const stillExists = sessionsRef.current.some((s) => s.id === sessionId);
        if (!stillExists) return;
        const stillAttached = workspacesRef.current.some((workspace) =>
          workspace.windows.some((window) => isSessionInPaneTree(window.rootPane, sessionId))
        );
        if (!stillAttached) return;
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, sessionId);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            })
          )
        );
      }).catch((e) => {
        console.error("Failed to listen session-closed:", e);
        return null;
      });
      if (cancelled) {
        unlistenSessionClosed?.();
        return;
      }
      if (unlistenSessionClosed) unlisteners.push(unlistenSessionClosed);
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((cleanup) => cleanup());
    };
  }, [
    setSessions,
    setWorkspaces,
    sessionsRef,
    workspacesRef,
    establishingSessionsRef,
  ]);
}

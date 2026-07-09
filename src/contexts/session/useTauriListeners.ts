import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import * as sessionService from "../../services/sessionService";
import { TmuxStateSnapshot } from "../../types/tmux";
import { Workspace } from "../../types/session";
import { applyTmuxStateSync, cloneTmuxState } from "../tmuxStateReducer";
import {
  findPaneNode,
  generateId,
  getLeafPaneIds,
  removeSessionAndCollapse,
  withRecomputedSessionIds,
  forEachPane,
} from "./paneUtils";
import { SessionState } from "./types";

type ListenersState = Pick<
  SessionState,
  | "setSessions"
  | "setWorkspaces"
  | "setTmuxState"
  | "setActiveTmuxWindowIds"
  | "sessionsRef"
  | "workspacesRef"
  | "establishingSessionsRef"
  | "tmuxListTimeoutsRef"
>;

interface UseTauriListenersOptions extends ListenersState {
  onTmuxStateSync?: (sessionId: number, snapshot: TmuxStateSnapshot) => void;
}

export function useTauriListeners({
  setSessions,
  setWorkspaces,
  setTmuxState,
  setActiveTmuxWindowIds,
  sessionsRef,
  workspacesRef,
  establishingSessionsRef,
  tmuxListTimeoutsRef,
  onTmuxStateSync,
}: UseTauriListenersOptions): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const cleanupWorkspacesForSession = (prev: Workspace[], sessionId: number): Workspace[] => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const isTmux = session?.type === "tmux" || session?.type === "ssh_tmux";

      if (!isTmux) {
        return prev.map((workspace) =>
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
        );
      }

      return prev.map((workspace) => {
        const remaining = workspace.windows.filter((window) => {
          let hasSession = false;
          forEachPane(window.rootPane, (node) => {
            if (node.type === "leaf" && node.sessionId === sessionId) {
              hasSession = true;
            }
          });
          return !hasSession;
        });

        let nextActiveId = workspace.activeWindowId;
        if (remaining.length === 0) {
          const paneId = generateId();
          const windowId = generateId();
          remaining.push({
            id: windowId,
            name: "New Session",
            activePaneId: paneId,
            windowType: "init",
            rootPane: {
              id: paneId,
              type: "leaf",
              size: 100,
            },
          });
          nextActiveId = windowId;
        } else if (!remaining.find((w) => w.id === workspace.activeWindowId)) {
          const closedIndex = workspace.windows.findIndex((w) => w.id === workspace.activeWindowId);
          const fallback = remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1];
          nextActiveId = fallback?.id ?? null;
        }

        return withRecomputedSessionIds({ ...workspace, windows: remaining, activeWindowId: nextActiveId });
      });
    };

    (async () => {
      const unlistenSessionClosed = await listen<number>("session-closed", (event) => {
        const sessionId = event.payload;
        const timeoutId = tmuxListTimeoutsRef.current.get(sessionId);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          tmuxListTimeoutsRef.current.delete(sessionId);
        }
        establishingSessionsRef.current.delete(sessionId);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setWorkspaces((prev) => cleanupWorkspacesForSession(prev, sessionId));
        setTmuxState((prev) => {
          const next = cloneTmuxState(prev);
          for (const [_, state] of next.sessions) {
            if (state.windows.some((wid) => next.windows.get(wid)?.sessionId === String(sessionId))) {
              next.sessions.delete(state.id);
            }
          }
          for (const [wid, window] of next.windows) {
            if (window.sessionId === String(sessionId)) {
              next.windows.delete(wid);
            }
          }
          for (const [pid, pane] of next.panes) {
            if (pane.sessionId === String(sessionId)) {
              next.panes.delete(pid);
            }
          }
          next.underlays.delete(sessionId);
          return next;
        });
      }).catch((e) => {
        console.error("Failed to listen session-closed:", e);
        return null;
      });
      if (cancelled) {
        unlistenSessionClosed?.();
        return;
      }
      if (unlistenSessionClosed) unlisteners.push(unlistenSessionClosed);

      const unlistenTmuxPaneOutput = await listen<[number, { paneId: string; data: number[] }]>("tmux-pane-output", () => {
        // Output bytes are delivered directly to Terminal.tsx listeners per pane.
        // No React state update is needed here.
      }).catch((e) => {
        console.error("Failed to listen tmux-pane-output:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxPaneOutput?.();
        return;
      }
      if (unlistenTmuxPaneOutput) unlisteners.push(unlistenTmuxPaneOutput);

      const unlistenTmuxStateSync = await listen<[number, TmuxStateSnapshot]>("tmux-state-sync", (event) => {
        const [sessionId, snapshot] = event.payload;
        setTmuxState((prev) => applyTmuxStateSync(prev, sessionId, snapshot));
        if (establishingSessionsRef.current.has(sessionId)) {
          establishingSessionsRef.current.delete(sessionId);
          onTmuxStateSync?.(sessionId, snapshot);
        }
      }).catch((e) => {
        console.error("Failed to listen tmux-state-sync:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxStateSync?.();
        return;
      }
      if (unlistenTmuxStateSync) unlisteners.push(unlistenTmuxStateSync);

      const unlistenTmuxConnectionError = await listen<[number, { message: string }]>("tmux-connection-error", (event) => {
        const [sessionId, { message }] = event.payload;
        window.alert(message);
        establishingSessionsRef.current.delete(sessionId);
        sessionService.closeSession(sessionId).catch(console.error);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setWorkspaces((prev) => cleanupWorkspacesForSession(prev, sessionId));
        setTmuxState((prev) => {
          const next = cloneTmuxState(prev);
          const underlay = next.underlays.get(sessionId);
          if (underlay) {
            next.underlays.set(sessionId, { ...underlay, status: "error", error: message });
          }
          return next;
        });
        setActiveTmuxWindowIds((prev) => {
          const next = new Map(prev);
          next.delete(sessionId);
          return next;
        });
      }).catch((e) => {
        console.error("Failed to listen tmux-connection-error:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxConnectionError?.();
        return;
      }
      if (unlistenTmuxConnectionError) unlisteners.push(unlistenTmuxConnectionError);
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((cleanup) => cleanup());
      for (const timeoutId of tmuxListTimeoutsRef.current.values()) {
        clearTimeout(timeoutId);
      }
      tmuxListTimeoutsRef.current.clear();
    };
  }, [
    setSessions,
    setWorkspaces,
    setTmuxState,
    setActiveTmuxWindowIds,
    sessionsRef,
    workspacesRef,
    establishingSessionsRef,
    tmuxListTimeoutsRef,
    onTmuxStateSync,
  ]);
}

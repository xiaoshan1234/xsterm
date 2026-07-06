import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { TmuxControlEvent } from "../../types/tmux";
import * as sessionService from "../../services/sessionService";
import * as tmuxService from "../../services/tmuxService";
import { applyTmuxControlEvent, cloneTmuxState } from "../tmuxStateReducer";
import { findPaneNode, getLeafPaneIds, removeSessionAndCollapse } from "./paneUtils";
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

export function useTauriListeners({
  setSessions,
  setWorkspaces,
  setTmuxState,
  setActiveTmuxWindowIds,
  sessionsRef,
  workspacesRef,
  establishingSessionsRef,
  tmuxListTimeoutsRef,
}: ListenersState): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

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
        setWorkspaces((prev) =>
          prev.map((workspace) => ({
            ...workspace,
            windows: workspace.windows.map((window) => {
              const newRoot = removeSessionAndCollapse(window.rootPane, sessionId);
              const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                ? window.activePaneId
                : (getLeafPaneIds(newRoot)[0] ?? null);
              return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          }))
        );
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

      const unlistenTmuxRequestSync = await listen<[number, string]>("tmux-request-sync", (event) => {
        const [sessionId, command] = event.payload;
        tmuxService.writeTmuxCommand(sessionId, command).catch(console.error);
      }).catch((e) => {
        console.error("Failed to listen tmux-request-sync:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxRequestSync?.();
        return;
      }
      if (unlistenTmuxRequestSync) unlisteners.push(unlistenTmuxRequestSync);

      const unlistenTmuxControlEvent = await listen<[number, TmuxControlEvent]>("tmux-control-event", (event) => {
        const [sessionId, controlEvent] = event.payload;
        const sessionIdKey = sessionId;
        setTmuxState((prev) => applyTmuxControlEvent(prev, String(sessionId), controlEvent));
        if (controlEvent.type === "SessionChanged") {
          establishingSessionsRef.current.delete(sessionId);
          tmuxService
            .listWindows(sessionId, controlEvent.sessionId)
            .catch(console.error);
        }
        if (controlEvent.type === "WindowClosed") {
          setActiveTmuxWindowIds((prev) => {
            const next = new Map(prev);
            const activeId = next.get(sessionIdKey);
            if (activeId === controlEvent.windowId) {
              next.delete(sessionIdKey);
            }
            return next;
          });
        }
        if (controlEvent.type === "WindowActivated") {
          setActiveTmuxWindowIds((prev) => {
            const next = new Map(prev);
            next.set(sessionIdKey, controlEvent.windowId);
            return next;
          });
        }
        if (controlEvent.type === "CommandError") {
          if (establishingSessionsRef.current.has(sessionId)) {
            establishingSessionsRef.current.delete(sessionId);
            sessionService.closeSession(sessionId).catch(console.error);
            setSessions((prev) => prev.filter((s) => s.id !== sessionId));
            setWorkspaces((prev) =>
              prev.map((workspace) => ({
                ...workspace,
                windows: workspace.windows.map((window) => {
                  const newRoot = removeSessionAndCollapse(window.rootPane, sessionId);
                  const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                    ? window.activePaneId
                    : (getLeafPaneIds(newRoot)[0] ?? null);
                  return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
                }),
              }))
            );
            alert(`Tmux session failed: ${controlEvent.message}`);
          }
        }
      }).catch((e) => {
        console.error("Failed to listen tmux-control-event:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxControlEvent?.();
        return;
      }
      if (unlistenTmuxControlEvent) unlisteners.push(unlistenTmuxControlEvent);
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
  ]);
}

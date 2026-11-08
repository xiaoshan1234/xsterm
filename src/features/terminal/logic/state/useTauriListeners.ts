import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  type Terminal,
  type TmuxPaneAddedEvent,
  type TmuxPaneRemovedEvent,
  type TmuxWindowAddedEvent,
  type TmuxWindowClosedEvent,
  type TmuxWindowRenamedEvent,
} from "../../../../types/terminal";
import { createLeafPane, withRecomputedSessionIds } from "./paneUtils";
import { closeWindow, removeSessionsFromWorkspaces, renameWindow } from "./eventTransitions";
import { TMUX_PANE_CAPABILITIES } from "./capabilities";
import { type TerminalState } from "./types";

/**
 * Build a Terminal-shaped entry for a tmux pane that just arrived via
 * the `tmux-pane-added` event. Mirrors what
 * `useTerminalActions.helpers.buildFrontendTerminal` produces for the
 * bootstrap pane (returned by `create_tmux_session`); the `configId`
 * is intentionally absent because splits have no corresponding saved
 * config.
 */
function buildTmuxPaneSession(info: {
  id: number;
  name: string;
  tmuxPaneId: string;
  tmuxSessionId: number;
}): Terminal {
  return {
    id: info.id,
    configId: "",
    name: info.name,
    type: "tmux-pane",
    isConnected: true,
    kind: {
      type: "tmux-pane",
      sessionId: info.tmuxSessionId,
      paneId: info.tmuxPaneId,
    },
    tmuxPaneId: info.tmuxPaneId,
    tmuxSessionId: info.tmuxSessionId,
    isHidden: false,
    capabilities: TMUX_PANE_CAPABILITIES,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

type ListenersState = Pick<
  TerminalState,
  | "setSessions"
  | "setWorkspaces"
  | "terminalsRef"
  | "workspacesRef"
  | "establishingSessionsRef"
  | "setTmuxControllerErrors"
  | "tmuxControllerConfigsRef"
>;

export function useTauriListeners({
  setSessions,
  setWorkspaces,
  terminalsRef,
  workspacesRef,
  establishingSessionsRef,
  setTmuxControllerErrors,
  tmuxControllerConfigsRef,
}: ListenersState): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    (async () => {
      const unlistenSessionDisconnected = await listen<number>("terminal-disconnected", (event) => {
        const terminalId = event.payload;
        establishingSessionsRef.current.delete(terminalId);
        setSessions((prev) =>
          prev.map((s) => (s.id === terminalId ? { ...s, isConnected: false } : s)),
        );
      }).catch((e) => {
        console.error("Failed to listen terminal-disconnected:", e);
        return null;
      });
      if (cancelled) {
        unlistenSessionDisconnected?.();
        return;
      }
      if (unlistenSessionDisconnected) unlisteners.push(unlistenSessionDisconnected);

      const unlistenSessionClosed = await listen<number>("terminal-closed", (event) => {
        const terminalId = event.payload;
        establishingSessionsRef.current.delete(terminalId);
        const stillExists = terminalsRef.current.some((s) => s.id === terminalId);
        if (!stillExists) return;
        setSessions((prev) => prev.filter((s) => s.id !== terminalId));
        setWorkspaces((prev) => removeSessionsFromWorkspaces(prev, [terminalId]));
      }).catch((e) => {
        console.error("Failed to listen terminal-closed:", e);
        return null;
      });
      if (cancelled) {
        unlistenSessionClosed?.();
        return;
      }
      if (unlistenSessionClosed) unlisteners.push(unlistenSessionClosed);

      // tmux paused / continued markers. These are read-only —
      // we do not mutate terminal state because the underlying tmux terminal
      // is still alive and the user can resume typing. A future iteration
      // may flip a `paused` flag on the Terminal for UI hints.
      const unlistenTmuxPaused = await listen<{ tmuxPaneId: string }>("tmux-paused", (event) => {
        console.debug("[xsterm] tmux-paused", event.payload);
      }).catch((e) => {
        console.error("Failed to listen tmux-paused:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxPaused?.();
        return;
      }
      if (unlistenTmuxPaused) unlisteners.push(unlistenTmuxPaused);

      const unlistenTmuxContinued = await listen<{ tmuxPaneId: string }>(
        "tmux-continued",
        (event) => {
          console.debug("[xsterm] tmux-continued", event.payload);
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-continued:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxContinued?.();
        return;
      }
      if (unlistenTmuxContinued) unlisteners.push(unlistenTmuxContinued);

      // tmux controller process exit. When the underlying `tmux -CC`
      // child terminates, drop every frontend Terminal that was bound to it.
      // Mirrors the `terminal-closed` handler but selects by controller id
      // because one controller owns N panes (= N frontend Terminal entries).
      //
      // also surface a retry banner by pushing into
      // `tmuxControllerErrors`. Reads the stored config from
      // `tmuxControllerConfigsRef` so the banner can pass it back to
      // `attachTmux` / `createTmux` on Retry. If the controller was
      // never registered (e.g. a Wave 0 test terminal) we silently skip
      // the banner so we don't show a banner with no retry path.
      const unlistenTmuxControllerExit = await listen<{
        controllerId: number;
        reason?: string;
      }>("tmux-controller-exit", (event) => {
        const { controllerId, reason } = event.payload;
        const dead = terminalsRef.current.filter((s) => s.tmuxSessionId === controllerId);
        const storedConfig = tmuxControllerConfigsRef.current.get(controllerId);
        if (dead.length > 0) {
          const deadIds = new Set(dead.map((s) => s.id));
          console.warn(
            `[xsterm] tmux-controller-exit controllerId=${controllerId} reason=${reason ?? "(none)"} — dropping ${dead.length} terminal(s)`,
          );
          for (const id of deadIds) {
            establishingSessionsRef.current.delete(id);
          }
          setSessions((prev) => prev.filter((s) => !deadIds.has(s.id)));
          setWorkspaces((prev) => removeSessionsFromWorkspaces(prev, deadIds));
        }
        if (storedConfig) {
          setTmuxControllerErrors((prev) => {
            const next = new Map(prev);
            next.set(controllerId, {
              config: storedConfig,
              reason,
              timestamp: Date.now(),
            });
            return next;
          });
          tmuxControllerConfigsRef.current.delete(controllerId);
        }
      }).catch((e) => {
        console.error("Failed to listen tmux-controller-exit:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxControllerExit?.();
        return;
      }
      if (unlistenTmuxControllerExit) unlisteners.push(unlistenTmuxControllerExit);

      // tmux-pane-added. Idempotent: if a Terminal with the same
      // xstermTerminalId already exists (the bootstrap pane case — added
      // by `create_tmux_session` return value), short-circuit. Otherwise
      // add a new Terminal to React state. The pane-tree update is owned
      // by `usePaneActions.splitTmuxPane` (which has the user-chosen
      // direction and the workspace/window/pane id context); this
      // listener only ensures the Terminal exists in React state, even
      // if a race or external source created the pane out-of-band.
      const unlistenTmuxPaneAdded = await listen<TmuxPaneAddedEvent>("tmux-pane-added", (event) => {
        const { xstermTerminalId, controllerId, tmuxPaneId } = event.payload;
        const existing = terminalsRef.current.find((s) => s.id === xstermTerminalId);
        if (existing) {
          // Bootstrap pane: Terminal was already added by the
          // `create_tmux_session` return value. Nothing to do.
          return;
        }
        const terminal = buildTmuxPaneSession({
          id: xstermTerminalId,
          name: `tmux-${controllerId}:${tmuxPaneId}`,
          tmuxPaneId,
          tmuxSessionId: controllerId,
        });
        setSessions((prev) => {
          // Re-check inside the setter to avoid a duplicate add if
          // two events race.
          if (prev.some((s) => s.id === xstermTerminalId)) return prev;
          return [...prev, terminal];
        });
      }).catch((e) => {
        console.error("Failed to listen tmux-pane-added:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxPaneAdded?.();
        return;
      }
      if (unlistenTmuxPaneAdded) unlisteners.push(unlistenTmuxPaneAdded);

      // tmux-pane-removed. Drop the matching Terminal from React
      // state and collapse the corresponding leaf in the pane tree.
      // Mirrors the `terminal-closed` handler.
      const unlistenTmuxPaneRemoved = await listen<TmuxPaneRemovedEvent>(
        "tmux-pane-removed",
        (event) => {
          const { xstermTerminalId } = event.payload;
          establishingSessionsRef.current.delete(xstermTerminalId);
          const stillExists = terminalsRef.current.some((s) => s.id === xstermTerminalId);
          if (!stillExists) return;
          setSessions((prev) => prev.filter((s) => s.id !== xstermTerminalId));
          setWorkspaces((prev) => removeSessionsFromWorkspaces(prev, [xstermTerminalId]));
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-pane-removed:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxPaneRemoved?.();
        return;
      }
      if (unlistenTmuxPaneRemoved) unlisteners.push(unlistenTmuxPaneRemoved);

      // tmux-window-added. Create a new xsterm Window in the
      // active workspace (or first workspace if no active), attach the
      // Terminal to it, and set it as the active window. Idempotent: if
      // the Terminal was already inserted by `create_tmux_window`'s
      // return value, the pane-add path is a no-op. If the Terminal is
      // unknown (race or out-of-band source), we synthesize one.
      const unlistenTmuxWindowAdded = await listen<TmuxWindowAddedEvent>(
        "tmux-window-added",
        (event) => {
          const { controllerId, tmuxWindowId, xstermWindowId, xstermTerminalId, xstermPaneId } =
            event.payload;
          // Make sure the Terminal exists in React state (idempotent —
          // if `create_tmux_window`'s return value already populated
          // it, this is a no-op).
          if (!terminalsRef.current.some((s) => s.id === xstermTerminalId)) {
            const terminal = buildTmuxPaneSession({
              id: xstermTerminalId,
              name: `tmux-${controllerId}:${xstermPaneId}`,
              tmuxPaneId: xstermPaneId,
              tmuxSessionId: controllerId,
            });
            // also stamp `tmuxWindowId` so the
            // `tmux-window-closed` listener can find this Terminal when
            // the window is killed.
            terminal.tmuxWindowId = tmuxWindowId;
            setSessions((prev) =>
              prev.some((s) => s.id === xstermTerminalId) ? prev : [...prev, terminal],
            );
          } else {
            // Terminal already in state — just stamp the tmuxWindowId
            // so window-close can find it.
            setSessions((prev) =>
              prev.map((s) => (s.id === xstermTerminalId ? { ...s, tmuxWindowId } : s)),
            );
          }

          // Pick a target workspace: prefer the one that already
          // contains a window for this controller, else the active
          // workspace, else the first workspace. If none exist, the
          // UI is in an unusual state and we skip creating a window
          // (the frontend's tmux-controller-exit handler will clean
          // up later).
          const targetWorkspaceId = (() => {
            const withController = workspacesRef.current.find((w) =>
              w.windows.some(
                (win) =>
                  win.rootPane.terminalId !== undefined &&
                  terminalsRef.current.some(
                    (s) => s.id === win.rootPane.terminalId && s.tmuxSessionId === controllerId,
                  ),
              ),
            );
            if (withController) return withController.id;
            const active = workspacesRef.current.find((w) => w.id === workspacesRef.current[0]?.id);
            return active?.id ?? workspacesRef.current[0]?.id ?? null;
          })();
          if (!targetWorkspaceId) return;

          const rootPane = createLeafPane(100, xstermTerminalId, "");
          const windowName = `Window ${xstermPaneId}`;
          setWorkspaces((prev) =>
            prev.map((workspace) => {
              if (workspace.id !== targetWorkspaceId) return workspace;
              const newWindow = {
                id: crypto.randomUUID(),
                name: windowName,
                rootPane,
                activePaneId: rootPane.id,
                windowType: "terminal" as const,
                xstermWindowId,
              };
              return withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, newWindow],
                activeWindowId: newWindow.id,
              });
            }),
          );
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-window-added:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxWindowAdded?.();
        return;
      }
      if (unlistenTmuxWindowAdded) unlisteners.push(unlistenTmuxWindowAdded);

      // tmux-window-closed. Drop every Terminal with the
      // matching `tmuxWindowId`, then drop the matching xsterm Window
      // from its workspace. If the workspace becomes empty, replace
      // it with an init window so the workspace stays usable.
      const unlistenTmuxWindowClosed = await listen<TmuxWindowClosedEvent>(
        "tmux-window-closed",
        (event) => {
          const { tmuxWindowId, xstermWindowId } = event.payload;
          // Drop every Terminal that belonged to this tmux window.
          const deadIds = terminalsRef.current
            .filter((s) => s.tmuxWindowId === tmuxWindowId)
            .map((s) => s.id);
          if (deadIds.length > 0) {
            for (const id of deadIds) {
              establishingSessionsRef.current.delete(id);
            }
            setSessions((prev) => prev.filter((s) => !deadIds.includes(s.id)));
          }

          // Find the workspace containing the xsterm Window and drop
          // the Window. If the workspace ends up empty, replace with
          // an init window.
          setWorkspaces((prev) => closeWindow(prev, xstermWindowId));
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-window-closed:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxWindowClosed?.();
        return;
      }
      if (unlistenTmuxWindowClosed) unlisteners.push(unlistenTmuxWindowClosed);

      // tmux-window-renamed. Update the matching xsterm Window's
      // `name`. No Terminal-state mutation is needed — only Window's
      // `name` is rendered in the tab bar.
      const unlistenTmuxWindowRenamed = await listen<TmuxWindowRenamedEvent>(
        "tmux-window-renamed",
        (event) => {
          const { xstermWindowId, name } = event.payload;
          setWorkspaces((prev) => renameWindow(prev, xstermWindowId, name));
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-window-renamed:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxWindowRenamed?.();
        return;
      }
      if (unlistenTmuxWindowRenamed) unlisteners.push(unlistenTmuxWindowRenamed);
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((cleanup) => cleanup());
    };
  }, [
    setSessions,
    setWorkspaces,
    terminalsRef,
    workspacesRef,
    establishingSessionsRef,
    setTmuxControllerErrors,
    tmuxControllerConfigsRef,
  ]);
}

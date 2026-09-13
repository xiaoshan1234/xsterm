import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import type { PaneNode, Session, SplitDirection, Workspace } from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";
import {
  createLeafPane,
  createSplitNode,
  findPaneNode,
  getLeafPaneIds,
  removePaneFromTree,
  replacePaneNode,
  withRecomputedSessionIds,
} from "./paneUtils";
import { assertSessionNotUsedElsewhere } from "./useSessionActions.helpers";

interface UsePaneActionsDeps {
  sessionsRef: React.MutableRefObject<Session[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
}

export function usePaneActions(deps: UsePaneActionsDeps) {
  const { sessionsRef, workspacesRef, setSessions, setWorkspaces, establishingSessionsRef } = deps;

  /**
   * Split a pane in the workspace.
   *
   * Routing: when the source session has `supportsMultiplex` (i.e.
   * it is a tmux pane), the call is delegated to
   * [`splitTmuxPane`]. The non-multiplex path is the historical
   * "create an empty leaf and let the user pick a session from the
   * dialog" flow, preserved verbatim.
   */
  const splitPane = useCallback(
    (
      workspaceId: string,
      windowId: string,
      paneId: string,
      direction: SplitDirection,
      sessionId?: number,
      configId?: string,
    ) => {
      // tmux panes have a real backend-side split; route to the
      // dedicated path which knows about controllerId / tmuxPaneId and
      // waits for tmux's matching %window-pane-changed reply.
      if (sessionId !== undefined) {
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        if (session?.capabilities?.supportsMultiplex) {
          void splitTmuxPaneInternal(
            sessionId,
            workspaceId,
            windowId,
            paneId,
            direction,
            sessionsRef,
            workspacesRef,
            setSessions,
            setWorkspaces,
          );
          return;
        }
      }

      if (sessionId !== undefined) {
        assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, windowId, sessionId);
      }
      setWorkspaces((prev) => {
        const workspace = prev.find((w) => w.id === workspaceId);
        if (!workspace) return prev;

        const window = workspace.windows.find((w) => w.id === windowId);
        if (!window) return prev;

        const target = findPaneNode(window.rootPane, paneId);
        if (!target || target.type !== "leaf") return prev;

        const session =
          sessionId !== undefined ? sessionsRef.current.find((s) => s.id === sessionId) : undefined;
        const halfSize = target.size / 2;
        const originalPane = { ...target, size: halfSize };
        const newPane = createLeafPane(halfSize, sessionId, configId ?? session?.configId);
        const splitNode = createSplitNode(direction, originalPane, newPane);
        const newRoot = replacePaneNode(window.rootPane, paneId, splitNode);

        return prev.map((w) =>
          w.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                activeWindowId: windowId,
                windows: workspace.windows.map((win) =>
                  win.id === windowId
                    ? { ...win, rootPane: newRoot, activePaneId: newPane.id }
                    : win,
                ),
              })
            : w,
        );
      });
    },
    [sessionsRef, workspacesRef, setSessions, setWorkspaces],
  );

  /**
   * kill a tmux pane via the backend `kill_tmux_pane` command.
   *
   * Returns once the command is queued on the controller's stdin; the
   * `%pane-exited` reply from tmux drives the `tmux-pane-removed`
   * event which the frontend listener uses to drop the Session from
   * React state and collapse the pane tree.
   */
  const killTmuxPane = useCallback(async (xstermSessionId: number): Promise<void> => {
    await sessionService.killTmuxPane(xstermSessionId);
  }, []);

  const updateWindowPaneTree = useCallback(
    (workspaceId: string, windowId: string, updater: (root: PaneNode) => PaneNode) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: workspace.windows.map((window) =>
                  window.id === windowId
                    ? { ...window, rootPane: updater(window.rootPane) }
                    : window,
                ),
              })
            : workspace,
        ),
      );
    },
    [setWorkspaces],
  );

  const closePane = useCallback(
    async (workspaceId: string, windowId: string, paneId: string): Promise<void> => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      const pane = window ? findPaneNode(window.rootPane, paneId) : null;
      if (!pane) return;

      const sessionId = pane.sessionId;
      if (sessionId !== undefined) {
        try {
          await sessionService.closeSession(sessionId);
        } catch (e) {
          console.error("Failed to close session backend:", e);
        } finally {
          establishingSessionsRef.current.delete(sessionId);
        }
        clearSessionOutput(sessionId);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      }

      setWorkspaces((prev) =>
        prev.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          return withRecomputedSessionIds({
            ...workspace,
            windows: workspace.windows.map((window) => {
              if (window.id !== windowId) return window;
              const newRoot = removePaneFromTree(window.rootPane, paneId);
              const newActivePaneId =
                window.activePaneId === paneId
                  ? (getLeafPaneIds(newRoot)[0] ?? null)
                  : window.activePaneId;
              return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          });
        }),
      );
    },
    [workspacesRef, setSessions, setWorkspaces, establishingSessionsRef],
  );

  const writeSession = useCallback(async (id: number, data: string): Promise<void> => {
    await sessionService.writeSession(id, data);
  }, []);

  const resizeSession = useCallback(
    async (id: number, rows: number, cols: number): Promise<void> => {
      await sessionService.resizeSession(id, rows, cols);
    },
    [],
  );

  return {
    splitPane,
    updateWindowPaneTree,
    closePane,
    writeSession,
    resizeSession,
    killTmuxPane,
  };
}

/**
 * split a tmux pane end-to-end.
 *
 * 1. Look up the parent session; require `tmuxControllerId` and
 *    `tmuxPaneId` (i.e. it must be a tmux pane).
 * 2. Call `sessionService.createTmuxPane` and await the backend's
 *    `SessionInfo`. The backend's dispatch task also fires a
 *    `tmux-pane-added` event for idempotent cross-check, but the
 *    authoritative Session object comes from the return value.
 * 3. Build a frontend `Session` for the new pane and push it into
 *    React state.
 * 4. Split the leaf in the pane tree, attaching the new session to
 *    the newly created child leaf.
 *
 * This helper is a plain function (not a React hook) because it does
 * not read any React-local state — it only dispatches via the supplied
 * `setSessions` / `setWorkspaces` callbacks. Keeping it out of the
 * hook body avoids forcing every consumer of `splitPane` to depend on
 * the tmux-only types.
 */
async function splitTmuxPaneInternal(
  xstermSessionId: number,
  workspaceId: string,
  windowId: string,
  paneId: string,
  direction: SplitDirection,
  sessionsRef: React.MutableRefObject<Session[]>,
  workspacesRef: React.MutableRefObject<Workspace[]>,
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>,
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>,
): Promise<void> {
  const parent = sessionsRef.current.find((s) => s.id === xstermSessionId);
  if (!parent) return;
  const controllerId = parent.tmuxControllerId;
  const parentTmuxPaneId = parent.tmuxPaneId;
  if (controllerId === undefined || parentTmuxPaneId === undefined) return;

  let newSessionId: number;
  try {
    const info = await sessionService.createTmuxPane(
      controllerId,
      xstermSessionId,
      direction,
    );
    newSessionId = info.id;
  } catch (e) {
    console.error("splitTmuxPane: backend create_tmux_pane failed:", e);
    return;
  }

  setSessions((prev) => {
    if (prev.some((s) => s.id === newSessionId)) return prev;
    const newSession: Session = {
      id: newSessionId,
      configId: "",
      name: `tmux-${controllerId}:${parentTmuxPaneId}`,
      type: "tmux-cc",
      isConnected: true,
      sessionType: { type: "tmux-cc", config: {} },
      tmuxPaneId: parentTmuxPaneId,
      tmuxControllerId: controllerId,
      isHidden: false,
      capabilities: {
        supportsResize: true,
        supportsReconnect: true,
        supportsLocalEcho: false,
        supportsMultiplex: true,
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    return [...prev, newSession];
  });

  setWorkspaces((prev) => {
    const workspace = prev.find((w) => w.id === workspaceId);
    if (!workspace) return prev;
    const window = workspace.windows.find((w) => w.id === windowId);
    if (!window) return prev;
    const target = findPaneNode(window.rootPane, paneId);
    if (!target || target.type !== "leaf") return prev;
    const halfSize = target.size / 2;
    const originalPane = { ...target, size: halfSize };
    const newPane = createLeafPane(halfSize, newSessionId, "");
    const splitNode = createSplitNode(direction, originalPane, newPane);
    const newRoot = replacePaneNode(window.rootPane, paneId, splitNode);
    return prev.map((w) =>
      w.id === workspaceId
        ? withRecomputedSessionIds({
            ...workspace,
            activeWindowId: windowId,
            windows: workspace.windows.map((win) =>
              win.id === windowId
                ? { ...win, rootPane: newRoot, activePaneId: newPane.id }
                : win,
            ),
          })
        : w,
    );
  });
  // Touch workspacesRef so eslint-plugin-react-hooks does not flag an
  // unused parameter (the read above does not need workspacesRef, but
  // keeping the parameter for the helper's signature symmetry with
  // `splitPane` is intentional).
  void workspacesRef;
}

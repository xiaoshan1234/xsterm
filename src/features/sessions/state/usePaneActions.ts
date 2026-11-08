import { useCallback } from "react";
import { terminalCommands, toBackendTerminalHandle } from "../../terminal/infrastructure";
import { tmuxCommands, toBackendControllerHandle } from "../../tmux/infrastructure";
import type {
  PaneNode,
  Terminal,
  SplitDirection,
  Workspace,
} from "../../../models/legacy/terminal";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";
import {
  createLeafPane,
  createSplitNode,
  findPaneNode,
  getLeafPaneIds,
  removePaneFromTree,
  replacePaneNode,
  withRecomputedSessionIds,
} from "./paneUtils";
import { assertSessionNotUsedElsewhere } from "./useTerminalActions.helpers";
import { TMUX_PANE_CAPABILITIES } from "./capabilities";

interface UsePaneActionsDeps {
  terminalsRef: React.MutableRefObject<Terminal[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
}

export function usePaneActions(deps: UsePaneActionsDeps) {
  const { terminalsRef, workspacesRef, setSessions, setWorkspaces, establishingSessionsRef } = deps;

  /**
   * Split a pane in the workspace.
   *
   * Routing: when the source terminal has `supportsMultiplex` (i.e.
   * it is a tmux pane), the call is delegated to
   * [`splitTmuxPane`]. The non-multiplex path is the historical
   * "create an empty leaf and let the user pick a terminal from the
   * dialog" flow, preserved verbatim.
   */
  const splitPane = useCallback(
    (
      workspaceId: string,
      windowId: string,
      paneId: string,
      direction: SplitDirection,
      terminalId?: number,
      configId?: string,
    ) => {
      // tmux panes have a real backend-side split; route to the
      // dedicated path which knows about controllerId / tmuxPaneId and
      // waits for tmux's matching %window-pane-changed reply.
      if (terminalId !== undefined) {
        const terminal = terminalsRef.current.find((s) => s.id === terminalId);
        if (terminal?.capabilities?.supportsMultiplex) {
          void splitTmuxPaneInternal(
            terminalId,
            workspaceId,
            windowId,
            paneId,
            direction,
            terminalsRef,
            workspacesRef,
            setSessions,
            setWorkspaces,
          );
          return;
        }
      }

      if (terminalId !== undefined) {
        assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, windowId, terminalId);
      }
      setWorkspaces((prev) => {
        const workspace = prev.find((w) => w.id === workspaceId);
        if (!workspace) return prev;

        const window = workspace.windows.find((w) => w.id === windowId);
        if (!window) return prev;

        const target = findPaneNode(window.rootPane, paneId);
        if (!target || target.type !== "leaf") return prev;

        const terminal =
          terminalId !== undefined
            ? terminalsRef.current.find((s) => s.id === terminalId)
            : undefined;
        const halfSize = target.size / 2;
        const originalPane = { ...target, size: halfSize };
        const newPane = createLeafPane(halfSize, terminalId, configId ?? terminal?.configId);
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
    [terminalsRef, workspacesRef, setSessions, setWorkspaces],
  );

  /**
   * kill a tmux pane via the backend `kill_tmux_pane` command.
   *
   * Returns once the command is queued on the controller's stdin; the
   * `%pane-exited` reply from tmux drives the `tmux-pane-removed`
   * event which the frontend listener uses to drop the Terminal from
   * React state and collapse the pane tree.
   */
  const killTmuxPane = useCallback(async (xstermTerminalId: number): Promise<void> => {
    await tmuxCommands.killTmuxPane(toBackendTerminalHandle(xstermTerminalId));
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

      const terminalId = pane.terminalId;
      if (terminalId !== undefined) {
        try {
          await terminalCommands.closeTerminal(toBackendTerminalHandle(terminalId));
        } catch (e) {
          console.error("Failed to close terminal backend:", e);
        } finally {
          establishingSessionsRef.current.delete(terminalId);
        }
        clearTerminalOutput(terminalId);
        setSessions((prev) => prev.filter((s) => s.id !== terminalId));
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

  const writeTerminal = useCallback(async (id: number, data: string): Promise<void> => {
    await terminalCommands.writeTerminal(
      toBackendTerminalHandle(id),
      new TextEncoder().encode(data),
    );
  }, []);

  const resizeTerminal = useCallback(
    async (id: number, rows: number, cols: number): Promise<void> => {
      await terminalCommands.resizeTerminal(toBackendTerminalHandle(id), rows, cols);
    },
    [],
  );

  const touchTerminalActivity = useCallback(
    (id: number) => {
      const now = Date.now();
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, lastActivityAt: now } : s)));
    },
    [setSessions],
  );

  return {
    splitPane,
    updateWindowPaneTree,
    closePane,
    writeTerminal,
    resizeTerminal,
    touchTerminalActivity,
    killTmuxPane,
  };
}

/**
 * split a tmux pane end-to-end.
 *
 * 1. Look up the parent terminal; require `tmuxSessionId` and
 *    `tmuxPaneId` (i.e. it must be a tmux pane).
 * 2. Call the tmux infrastructure adapter and await the backend's
 *    `TerminalInfo`. The backend's dispatch task also fires a
 *    `tmux-pane-added` event for idempotent cross-check, but the
 *    authoritative Terminal object comes from the return value.
 * 3. Build a frontend `Terminal` for the new pane and push it into
 *    React state.
 * 4. Split the leaf in the pane tree, attaching the new terminal to
 *    the newly created child leaf.
 *
 * This helper is a plain function (not a React hook) because it does
 * not read any React-local state — it only dispatches via the supplied
 * `setSessions` / `setWorkspaces` callbacks. Keeping it out of the
 * hook body avoids forcing every consumer of `splitPane` to depend on
 * the tmux-only types.
 */
async function splitTmuxPaneInternal(
  xstermTerminalId: number,
  workspaceId: string,
  windowId: string,
  paneId: string,
  direction: SplitDirection,
  terminalsRef: React.MutableRefObject<Terminal[]>,
  workspacesRef: React.MutableRefObject<Workspace[]>,
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>,
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>,
): Promise<void> {
  const parent = terminalsRef.current.find((s) => s.id === xstermTerminalId);
  if (!parent) return;
  const controllerId = parent.tmuxSessionId;
  const parentTmuxPaneId = parent.tmuxPaneId;
  if (controllerId === undefined || parentTmuxPaneId === undefined) return;

  let newSessionId: number;
  try {
    const info = await tmuxCommands.createTmuxPane(
      toBackendControllerHandle(controllerId),
      toBackendTerminalHandle(xstermTerminalId),
      direction,
    );
    newSessionId = info.id;
  } catch (e) {
    console.error("splitTmuxPane: backend create_tmux_pane failed:", e);
    return;
  }

  setSessions((prev) => {
    if (prev.some((s) => s.id === newSessionId)) return prev;
    const newSession: Terminal = {
      id: newSessionId,
      configId: "",
      name: `tmux-${controllerId}:${parentTmuxPaneId}`,
      type: "tmux-pane",
      isConnected: true,
      kind: {
        type: "tmux-pane",
        sessionId: controllerId,
        paneId: parentTmuxPaneId,
      },
      tmuxPaneId: parentTmuxPaneId,
      tmuxSessionId: controllerId,
      isHidden: false,
      capabilities: TMUX_PANE_CAPABILITIES,
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
              win.id === windowId ? { ...win, rootPane: newRoot, activePaneId: newPane.id } : win,
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

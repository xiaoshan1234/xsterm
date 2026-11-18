import { useCallback } from "react";
import {
  terminalSessionActions,
  terminalStreamActions,
  type TerminalConnectionInfo,
} from "../../../features/terminal";
import { tmuxControllerActions } from "../../../features/tmux";
import type { Terminal } from "../../../models/runtime/config";
import type {
  EditablePaneNode,
  PaneSplitDirection,
} from "../../../models/workspace/EditablePaneTree";
import type { Workspace } from "../../../models/runtime/workspace";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";
import {
  createLeafPane,
  createSplitNode,
  findPaneNode,
  getLeafPaneIds,
  removePaneFromTree,
  replacePaneNode,
  withRecomputedSessionIds,
  assertSessionNotUsedElsewhere,
} from "../../../features/workspace";
import { buildFrontendTerminal } from "./useTerminalActions.helpers";

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
      direction: PaneSplitDirection,
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
    await tmuxControllerActions.killPane(xstermTerminalId);
  }, []);

  const updateWindowPaneTree = useCallback(
    (
      workspaceId: string,
      windowId: string,
      updater: (root: EditablePaneNode) => EditablePaneNode,
    ) => {
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
          await terminalSessionActions.closeTerminal(terminalId);
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
    await terminalStreamActions.writeBytes(id, new TextEncoder().encode(data));
  }, []);

  const resizeTerminal = useCallback(
    async (id: number, rows: number, cols: number): Promise<void> => {
      await terminalSessionActions.resizeTerminal(id, rows, cols);
    },
    [],
  );

  const uploadImageToSshTerminal = useCallback(
    async (terminalId: number, filename: string, data: Uint8Array): Promise<string> => {
      return terminalSessionActions.uploadImageToSshTerminal(terminalId, filename, data);
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
    uploadImageToSshTerminal,
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
  direction: PaneSplitDirection,
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

  let info: TerminalConnectionInfo;
  try {
    info = await tmuxControllerActions.createPane(controllerId, xstermTerminalId, direction);
  } catch (e) {
    console.error("splitTmuxPane: backend create_tmux_pane failed:", e);
    return;
  }
  const newSessionId = info.id;

  setSessions((prev) => {
    if (prev.some((s) => s.id === newSessionId)) {
      // The `tmux-pane-added` event may have created the terminal first.
      // Make sure it carries the new pane id, window id and config link.
      return prev.map((session) =>
        session.id === newSessionId
          ? {
              ...session,
              configId: session.configId || parent.configId,
              tmuxPaneId: info.kind.type === "tmux-pane" ? info.kind.paneId : session.tmuxPaneId,
              tmuxWindowId: info.tmuxWindowId ?? session.tmuxWindowId,
            }
          : session,
      );
    }
    const newSession = buildFrontendTerminal(
      info,
      parent.configId,
      "tmux-pane",
      parent.displayConfig,
    );
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

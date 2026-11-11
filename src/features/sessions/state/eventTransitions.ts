import type { Window, Workspace } from "../../../models/legacy/terminal";
import {
  collectSessionIdsFromPaneTree,
  findFirstLeafWithSession,
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
  withRecomputedSessionIds,
} from "./paneUtils";

/**
 * Remove the given terminals from every workspace's pane trees and collapse
 * the affected splits. Recomputes each window's active pane and each
 * workspace's `terminalIds`.
 *
 * Pure and behavior-identical to the inline collapse logic previously
 * duplicated across the `terminal-closed`, `tmux-pane-removed` and
 * `tmux-controller-exit` listeners.
 */
export function removeSessionsFromWorkspaces(
  workspaces: Workspace[],
  terminalIds: Iterable<number>,
): Workspace[] {
  const ids = [...terminalIds];
  return workspaces.map((workspace) =>
    withRecomputedSessionIds({
      ...workspace,
      windows: workspace.windows.map((window) => {
        let root = window.rootPane;
        for (const id of ids) {
          root = removeSessionAndCollapse(root, id);
        }
        const newActivePaneId = findPaneNode(root, window.activePaneId ?? "")
          ? window.activePaneId
          : (getLeafPaneIds(root)[0] ?? null);
        return { ...window, rootPane: root, activePaneId: newActivePaneId };
      }),
    }),
  );
}

/**
 * Remove every window that belonged to a tmux controller and detach its
 * terminals from any mixed pane trees. Empty workspaces receive an init
 * window so a controller reconnect never leaves an unusable workspace.
 */
export function removeControllerFromWorkspaces(
  workspaces: Workspace[],
  terminalIds: Iterable<number>,
): Workspace[] {
  const controlledIds = new Set(terminalIds);

  return workspaces.map((workspace) => {
    let nextActiveId = workspace.activeWindowId;
    const windows = workspace.windows.flatMap((window) => {
      const windowTerminalIds = collectSessionIdsFromPaneTree(window.rootPane);
      const containedControlledTerminal = windowTerminalIds.some((id) => controlledIds.has(id));
      if (!containedControlledTerminal) return [window];

      let rootPane = window.rootPane;
      for (const terminalId of controlledIds) {
        rootPane = removeSessionAndCollapse(rootPane, terminalId);
      }
      if (collectSessionIdsFromPaneTree(rootPane).length === 0) {
        if (nextActiveId === window.id) nextActiveId = null;
        return [];
      }

      const activePane = findPaneNode(rootPane, window.activePaneId ?? "");
      const activePaneId =
        activePane?.type === "leaf" && activePane.terminalId !== undefined
          ? window.activePaneId
          : (findFirstLeafWithSession(rootPane)?.id ?? getLeafPaneIds(rootPane)[0] ?? null);
      return [{ ...window, rootPane, activePaneId }];
    });

    if (windows.length === 0) {
      const initPaneId = crypto.randomUUID();
      const initWindow: Window = {
        id: crypto.randomUUID(),
        name: "New Terminal",
        activePaneId: initPaneId,
        windowType: "init",
        rootPane: { id: initPaneId, type: "leaf", size: 100 },
      };
      return withRecomputedSessionIds({
        ...workspace,
        windows: [initWindow],
        activeWindowId: initWindow.id,
      });
    }

    if (nextActiveId === null) {
      nextActiveId = windows[0]?.id ?? null;
    }
    return withRecomputedSessionIds({ ...workspace, windows, activeWindowId: nextActiveId });
  });
}

/**
 * Rename the tmux-backed window matching `xstermWindowId`.
 */
export function renameWindow(
  workspaces: Workspace[],
  xstermWindowId: number,
  name: string,
): Workspace[] {
  return workspaces.map((workspace) => ({
    ...workspace,
    windows: workspace.windows.map((w) =>
      w.xstermWindowId === xstermWindowId ? { ...w, name } : w,
    ),
  }));
}

/**
 * Drop the window matching `xstermWindowId` from its workspace. When the
 * workspace becomes empty, replace it with a fresh init window so it stays
 * usable.
 */
export function closeWindow(workspaces: Workspace[], xstermWindowId: number): Workspace[] {
  return workspaces.map((workspace) => {
    const targetWindow = workspace.windows.find((w) => w.xstermWindowId === xstermWindowId);
    if (!targetWindow) return workspace;

    const remaining = workspace.windows.filter((w) => w.xstermWindowId !== xstermWindowId);
    let nextWindows = remaining;
    let nextActiveId = workspace.activeWindowId;

    if (remaining.length === 0) {
      const initPaneId = crypto.randomUUID();
      const initWindow: Window = {
        id: crypto.randomUUID(),
        name: "New Terminal",
        activePaneId: initPaneId,
        windowType: "init",
        rootPane: { id: initPaneId, type: "leaf", size: 100 },
      };
      nextWindows = [initWindow];
      nextActiveId = initWindow.id;
    } else if (nextActiveId === targetWindow.id) {
      const closedIndex = workspace.windows.findIndex((w) => w.xstermWindowId === xstermWindowId);
      const fallback =
        remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1];
      nextActiveId = fallback?.id ?? null;
    }

    return withRecomputedSessionIds({
      ...workspace,
      windows: nextWindows,
      activeWindowId: nextActiveId,
    });
  });
}

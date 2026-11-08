import { type TerminalId, type WindowId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import {
  createTerminalPane,
  findRawPane,
  setRawPaneContent,
  splitRawPane,
  type RawPaneDirection,
  type RawPaneNode,
} from "./RawPaneTree";
import {
  collectWorkspaceTerminalIds,
  createWorkspace,
  findRawWindowInWorkspace,
  findWorkspaceWindow,
  type Workspace,
} from "./Workspace";
import { renameRawWindow, type WorkspaceWindow } from "./WorkspaceWindow";

/**
 * Pure layout operations for raw windows. These functions validate model
 * invariants but do not create, close, or reconnect backend terminals.
 */
export function activateWorkspaceWindow(
  workspace: Workspace,
  windowId: WindowId,
): ModelResult<Workspace> {
  if (!findWorkspaceWindow(workspace, windowId)) {
    return modelFailure("not-found", "Window does not exist in this workspace");
  }

  return modelSuccess({
    ...workspace,
    activeWindowId: windowId,
  });
}

export function renameWorkspaceRawWindow(
  workspace: Workspace,
  windowId: WindowId,
  name: string,
): ModelResult<Workspace> {
  const window = findWorkspaceWindow(workspace, windowId);
  if (!window) {
    return modelFailure("not-found", "Window does not exist in this workspace");
  }
  if (window.kind !== "raw-window") {
    return modelFailure("invalid-transition", "tmux window names are owned by the tmux controller");
  }

  const renameResult = renameRawWindow(window, name);
  if (!renameResult.ok) {
    return renameResult;
  }

  return replaceWorkspaceWindow(workspace, renameResult.value);
}

export function attachTerminalToEmptyPane(
  workspace: Workspace,
  windowId: WindowId,
  paneId: RawPaneNode["id"],
  terminalId: TerminalId,
): ModelResult<Workspace> {
  const window = findRawWindowInWorkspace(workspace, windowId);
  if (!window) {
    return modelFailure("not-found", "Raw window does not exist");
  }

  const pane = findRawPane(window.layout, paneId);
  if (!pane) {
    return modelFailure("not-found", "Pane does not exist in this window");
  }
  if (pane.kind !== "leaf" || pane.content.kind !== "empty") {
    return modelFailure("invalid-transition", "Only an empty leaf can accept a terminal");
  }
  if (collectWorkspaceTerminalIds(workspace).includes(terminalId)) {
    return modelFailure("duplicate-id", "Terminal is already attached to this workspace");
  }

  return modelSuccess({
    ...workspace,
    windows: workspace.windows.map((candidate) =>
      candidate.id === windowId && candidate.kind === "raw-window"
        ? {
            ...candidate,
            layout: setRawPaneContent(candidate.layout, paneId, {
              kind: "terminal",
              terminalId,
            }),
          }
        : candidate,
    ),
  });
}

export function splitRawWindowPane(
  workspace: Workspace,
  windowId: WindowId,
  targetPaneId: RawPaneNode["id"],
  splitPaneId: string,
  newPaneId: string,
  direction: RawPaneDirection,
  terminalId: TerminalId,
  ratio = 0.5,
): ModelResult<Workspace> {
  // The new terminal must not already be attached elsewhere in the workspace;
  // this mirrors the constraint enforced by the Workspace factory.
  const window = findRawWindowInWorkspace(workspace, windowId);
  if (!window) {
    return modelFailure("not-found", "Raw window does not exist");
  }
  if (collectWorkspaceTerminalIds(workspace).includes(terminalId)) {
    return modelFailure("duplicate-id", "Terminal is already attached to this workspace");
  }

  const newPaneResult = createTerminalPane(newPaneId, terminalId);
  if (!newPaneResult.ok) {
    return newPaneResult;
  }

  const splitResult = splitRawPane(
    window.layout,
    targetPaneId,
    splitPaneId,
    newPaneResult.value,
    direction,
    ratio,
  );
  if (!splitResult.ok) {
    return splitResult;
  }

  return replaceWorkspaceWindow(workspace, {
    ...window,
    layout: splitResult.value,
    activePaneId: newPaneResult.value.id,
  });
}

export function detachTerminalFromWorkspace(
  workspace: Workspace,
  terminalId: TerminalId,
): ModelResult<Workspace> {
  // Detaching preserves the pane as an empty leaf. Pane removal/collapse is a
  // separate UI action and should not break the active pane invariant.
  let hasChanged = false;

  const windows = workspace.windows.map((window) => {
    if (window.kind !== "raw-window") {
      return window;
    }

    const layout = clearTerminalContent(window.layout, terminalId, () => {
      hasChanged = true;
    });
    return hasChanged ? { ...window, layout } : window;
  });

  if (!hasChanged) {
    return modelFailure("not-found", "Terminal is not attached to this workspace");
  }

  return modelSuccess({
    ...workspace,
    windows,
  });
}

export function appendWorkspaceWindow(
  workspace: Workspace,
  window: WorkspaceWindow,
  shouldActivate = true,
): ModelResult<Workspace> {
  const windows = [...workspace.windows, window];
  return createWorkspace({
    id: workspace.id,
    name: workspace.name,
    windows,
    activeWindowId: shouldActivate ? window.id : workspace.activeWindowId,
  });
}

export function removeWorkspaceWindow(
  workspace: Workspace,
  windowId: WindowId,
): ModelResult<Workspace> {
  if (workspace.windows.length === 1) {
    return modelFailure("invalid-transition", "Workspace must keep at least one window");
  }

  const closedWindowIndex = workspace.windows.findIndex((window) => window.id === windowId);
  if (closedWindowIndex < 0) {
    return modelFailure("not-found", "Window does not exist in this workspace");
  }

  const windows = workspace.windows.filter((window) => window.id !== windowId);
  const fallbackWindow =
    windows[Math.max(0, closedWindowIndex - 1)] ??
    windows[Math.min(closedWindowIndex, windows.length - 1)];
  const activeWindowId =
    workspace.activeWindowId === windowId ? fallbackWindow.id : workspace.activeWindowId;

  return createWorkspace({
    id: workspace.id,
    name: workspace.name,
    windows,
    activeWindowId,
  });
}

function replaceWorkspaceWindow(
  workspace: Workspace,
  replacement: WorkspaceWindow,
): ModelResult<Workspace> {
  return createWorkspace({
    id: workspace.id,
    name: workspace.name,
    windows: workspace.windows.map((window) =>
      window.id === replacement.id ? replacement : window,
    ),
    activeWindowId: workspace.activeWindowId,
  });
}

function clearTerminalContent(
  node: RawPaneNode,
  terminalId: TerminalId,
  onChanged: () => void,
): RawPaneNode {
  if (node.kind === "leaf") {
    if (node.content.kind === "terminal" && node.content.terminalId === terminalId) {
      onChanged();
      return {
        ...node,
        content: { kind: "empty" },
      };
    }
    return node;
  }

  return {
    ...node,
    children: [
      clearTerminalContent(node.children[0], terminalId, onChanged),
      clearTerminalContent(node.children[1], terminalId, onChanged),
    ],
  };
}

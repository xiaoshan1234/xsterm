import {
  createWorkspaceId,
  type TerminalId,
  type TmuxWindowId,
  type WindowId,
  type WorkspaceId,
} from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { collectTerminalIdsFromRawPaneTree } from "./RawPaneTree";
import { type RawWindow, type TmuxWindowReference, type WorkspaceWindow } from "./WorkspaceWindow";

/**
 * Aggregate root for user-visible tabs and layouts. It references runtime
 * terminal/controller ids but never owns backend connections.
 *
 * `activeWindowId` must point to an existing window. Terminal ids are derived
 * by selectors instead of stored as a redundant cache.
 */
export interface Workspace {
  readonly kind: "workspace";
  readonly id: WorkspaceId;
  readonly name: string;
  readonly windows: readonly WorkspaceWindow[];
  readonly activeWindowId: WindowId;
}

export interface CreateWorkspaceInput {
  id: string;
  name: string;
  windows: readonly WorkspaceWindow[];
  activeWindowId: WindowId;
}

export function createWorkspace(input: CreateWorkspaceInput): ModelResult<Workspace> {
  const name = input.name.trim();
  if (!name) {
    return modelFailure("invalid-value", "Workspace name must not be empty");
  }
  if (input.windows.length === 0) {
    return modelFailure("invalid-layout", "Workspace must contain at least one window");
  }

  const windowIds = input.windows.map((window) => window.id);
  if (new Set(windowIds).size !== windowIds.length) {
    return modelFailure("duplicate-id", "Workspace contains duplicate window ids");
  }
  if (!windowIds.includes(input.activeWindowId)) {
    return modelFailure("invalid-layout", "Active window must exist in the workspace");
  }

  // Validate cross-window uniqueness before returning a model that selectors
  // and persistence code will treat as valid.
  const terminalIds = collectWorkspaceTerminalIdsFromWindows(input.windows);
  if (new Set(terminalIds).size !== terminalIds.length) {
    return modelFailure("duplicate-id", "The same raw terminal cannot appear in multiple panes");
  }

  const tmuxWindowKeys = input.windows
    .filter((window): window is TmuxWindowReference => window.kind === "tmux-window-reference")
    .map((window) => `${window.controllerId}:${window.tmuxWindowId}`);
  if (new Set(tmuxWindowKeys).size !== tmuxWindowKeys.length) {
    return modelFailure("duplicate-id", "The same tmux window cannot be referenced more than once");
  }

  try {
    return modelSuccess({
      kind: "workspace",
      id: createWorkspaceId(input.id),
      name,
      windows: [...input.windows],
      activeWindowId: input.activeWindowId,
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid workspace id",
    );
  }
}

export function findWorkspaceWindow(
  workspace: Workspace,
  windowId: WindowId,
): WorkspaceWindow | null {
  return workspace.windows.find((window) => window.id === windowId) ?? null;
}

export function findRawWindowInWorkspace(
  workspace: Workspace,
  windowId: WindowId,
): RawWindow | null {
  const window = findWorkspaceWindow(workspace, windowId);
  return window?.kind === "raw-window" ? window : null;
}

export function collectWorkspaceTerminalIds(workspace: Workspace): readonly TerminalId[] {
  // This is intentionally derived from the layout rather than persisted.
  return collectWorkspaceTerminalIdsFromWindows(workspace.windows);
}

export function collectWorkspaceTmuxWindowReferences(
  workspace: Workspace,
): readonly TmuxWindowReference[] {
  return workspace.windows.filter(
    (window): window is TmuxWindowReference => window.kind === "tmux-window-reference",
  );
}

export function collectTmuxWindowIdsForController(
  workspace: Workspace,
  controllerId: TmuxWindowReference["controllerId"],
): readonly TmuxWindowId[] {
  return collectWorkspaceTmuxWindowReferences(workspace)
    .filter((window) => window.controllerId === controllerId)
    .map((window) => window.tmuxWindowId);
}

function collectWorkspaceTerminalIdsFromWindows(windows: readonly WorkspaceWindow[]): TerminalId[] {
  return windows.flatMap((window) =>
    window.kind === "raw-window" ? collectTerminalIdsFromRawPaneTree(window.layout) : [],
  );
}

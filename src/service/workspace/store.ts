/**
 * Workspace service store — `Workspace` UI tree registry.
 *
 * **Scope**: workspace list + active selection + workspace-scoped
 * refs. The full `Window` / `PaneTree` mutation lives here too —
 * the workspace tree is the closest owning service for those
 * mutations, even though pane-level operations have their own
 * (`service/pane`) helpers.
 *
 * **Refs** mirror the arrays for synchronous non-React reads; see
 * `service/session/store.ts` for the rationale.
 *
 * **Stub actions** are filled in by Commit 4.
 */
import { create } from "zustand";
import type { PaneNode, Window, Workspace } from "../../model/entities";

export interface WorkspaceStoreState {
  // --- registry ------------------------------------------------------
  workspaces: Workspace[];
  setWorkspaces: (next: Workspace[] | ((prev: Workspace[]) => Workspace[])) => void;
  /** Latest workspaces mirror for synchronous non-React reads. */
  workspacesRef: { current: Workspace[] };

  // --- active selection ---------------------------------------------
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (next: string | null | ((prev: string | null) => string | null)) => void;

  // --- mutating actions (stubs in Commit 3, real in Commit 4) -------
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setActiveWorkspace: (id: string) => void;
  reorderWindows: (workspaceId: string, fromIndex: number, toIndex: number) => void;
  addWindow: (workspaceId: string, window: Window) => void;
  removeWindow: (workspaceId: string, windowId: string) => void;
  renameWindow: (workspaceId: string, windowId: string, name: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  updateWindowPaneTree: (
    workspaceId: string,
    windowId: string,
    updater: (root: PaneNode) => PaneNode,
  ) => void;
  reset: () => void;
}

const initialWorkspaces: Workspace[] = [];
const initialWorkspacesRef = { current: initialWorkspaces };

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  workspaces: initialWorkspaces,
  setWorkspaces: (next) => {
    set((state) => {
      const resolved =
        typeof next === "function" ? (next as (p: Workspace[]) => Workspace[])(state.workspaces) : next;
      initialWorkspacesRef.current = resolved;
      return { workspaces: resolved };
    });
  },
  workspacesRef: initialWorkspacesRef,
  activeWorkspaceId: null,
  setActiveWorkspaceId: (next) => {
    set((state) => ({
      activeWorkspaceId:
        typeof next === "function"
          ? (next as (p: string | null) => string | null)(state.activeWorkspaceId)
          : next,
    }));
  },

  // Stubs.
  addWorkspace: () => {},
  removeWorkspace: () => {},
  renameWorkspace: () => {},
  setActiveWorkspace: () => {},
  reorderWindows: () => {},
  addWindow: () => {},
  removeWindow: () => {},
  renameWindow: () => {},
  setActiveWindow: () => {},
  updateWindowPaneTree: () => {},
  reset: () => {
    initialWorkspacesRef.current = [];
    set({ workspaces: [], activeWorkspaceId: null });
  },
}));

/** Mirror getter used by non-React callers (bridges / use cases). */
export function getActiveWorkspaceId(): string | null {
  return useWorkspaceStore.getState().activeWorkspaceId;
}

/** Mirror getter used by non-React callers. */
export function getWorkspaces(): Workspace[] {
  return useWorkspaceStore.getState().workspaces;
}

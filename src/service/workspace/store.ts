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
import type { PaneNode, Window, Workspace } from "../../model";

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
        typeof next === "function"
          ? (next as (p: Workspace[]) => Workspace[])(state.workspaces)
          : next;
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

  addWorkspace: (workspace) => {
    set((state) => {
      if (state.workspaces.some((w) => w.id === workspace.id)) return state;
      const workspaces = [...state.workspaces, workspace];
      initialWorkspacesRef.current = workspaces;
      return {
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId ?? workspace.id,
      };
    });
  },
  removeWorkspace: (id) => {
    set((state) => {
      if (!state.workspaces.some((w) => w.id === id)) return state;
      const workspaces = state.workspaces.filter((w) => w.id !== id);
      const activeWorkspaceId =
        state.activeWorkspaceId === id ? (workspaces[0]?.id ?? null) : state.activeWorkspaceId;
      initialWorkspacesRef.current = workspaces;
      return { workspaces, activeWorkspaceId };
    });
  },
  renameWorkspace: (id, name) => {
    set((state) => {
      let changed = false;
      const workspaces = state.workspaces.map((w) => {
        if (w.id !== id) return w;
        if (w.name === name) return w;
        changed = true;
        return { ...w, name };
      });
      if (!changed) return state;
      initialWorkspacesRef.current = workspaces;
      return { workspaces };
    });
  },
  setActiveWorkspace: (id) => {
    set((state) => {
      if (state.activeWorkspaceId === id) return state;
      if (!state.workspaces.some((w) => w.id === id)) return state;
      return { activeWorkspaceId: id };
    });
  },
  reorderWindows: (workspaceId, fromIndex, toIndex) => {
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === workspaceId);
      if (idx === -1) return state;
      const workspace = state.workspaces[idx];
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= workspace.windows.length) return state;
      if (fromIndex === toIndex) return state;
      const windows = workspace.windows.slice();
      const [moved] = windows.splice(fromIndex, 1);
      windows.splice(toIndex, 0, moved);
      const workspaces = state.workspaces.map((w, i) => (i === idx ? { ...w, windows } : w));
      initialWorkspacesRef.current = workspaces;
      return { workspaces };
    });
  },
  addWindow: (workspaceId, window) => {
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === workspaceId);
      if (idx === -1) return state;
      const workspaces = state.workspaces.map((w, i) =>
        i === idx
          ? {
              ...w,
              windows: [...w.windows, window],
              activeWindowId: window.id,
            }
          : w,
      );
      initialWorkspacesRef.current = workspaces;
      return { workspaces };
    });
  },
  removeWindow: (workspaceId, windowId) => {
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === workspaceId);
      if (idx === -1) return state;
      const workspace = state.workspaces[idx];
      const remaining = workspace.windows.filter((win) => win.id !== windowId);
      if (remaining.length === workspace.windows.length) return state;
      const activeWindowId =
        workspace.activeWindowId === windowId
          ? (remaining[0]?.id ?? null)
          : workspace.activeWindowId;
      const workspaces = state.workspaces.map((w, i) =>
        i === idx ? { ...w, windows: remaining, activeWindowId } : w,
      );
      initialWorkspacesRef.current = workspaces;
      return { workspaces };
    });
  },
  renameWindow: (workspaceId, windowId, name) => {
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === workspaceId);
      if (idx === -1) return state;
      let changed = false;
      const workspaces = state.workspaces.map((w, i) => {
        if (i !== idx) return w;
        const windows = w.windows.map((win) => {
          if (win.id !== windowId) return win;
          if (win.name === name) return win;
          changed = true;
          return { ...win, name };
        });
        return changed ? { ...w, windows } : w;
      });
      if (!changed) return state;
      initialWorkspacesRef.current = workspaces;
      return { workspaces };
    });
  },
  setActiveWindow: (workspaceId, windowId) => {
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === workspaceId);
      if (idx === -1) return state;
      const workspace = state.workspaces[idx];
      if (!workspace.windows.some((win) => win.id === windowId)) return state;
      if (workspace.activeWindowId === windowId) return state;
      const workspaces = state.workspaces.map((w, i) =>
        i === idx ? { ...w, activeWindowId: windowId } : w,
      );
      return { workspaces };
    });
  },
  updateWindowPaneTree: (workspaceId, windowId, updater) => {
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === workspaceId);
      if (idx === -1) return state;
      let changed = false;
      const workspaces = state.workspaces.map((w, i) => {
        if (i !== idx) return w;
        const windows = w.windows.map((win) => {
          if (win.id !== windowId) return win;
          if (win.kind !== "terminal") return win;
          const next = updater(win.rootPane);
          if (next === win.rootPane) return win;
          changed = true;
          return { ...win, rootPane: next };
        });
        return changed ? { ...w, windows } : w;
      });
      if (!changed) return state;
      initialWorkspacesRef.current = workspaces;
      return { workspaces };
    });
  },
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

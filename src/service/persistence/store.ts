/**
 * Persistence service store — saved configs + saved workspaces +
 * saved window configs + groups.
 *
 * **Scope**: persisted view of the user's session-config library.
 * The runtime sessions live in `service/session/store.ts`; the
 * persistence store is the on-disk-mirrored slice.
 *
 * **Refs omitted**: persistence values are read by the persistence
 * bridge and the sidebars; synchronous non-React reads happen
 * through `usePersistenceStore.getState()`. No refs needed (the
 * arrays themselves are the canonical state).
 */
import { create } from "zustand";
import type {
  SavedSessionConfig,
  SavedWindowConfig,
  SavedWorkspace,
  SessionGroup,
} from "../../model";

export interface PersistenceStoreState {
  savedConfigs: SavedSessionConfig[];
  setSavedConfigs: (
    next: SavedSessionConfig[] | ((p: SavedSessionConfig[]) => SavedSessionConfig[]),
  ) => void;
  savedWorkspaces: SavedWorkspace[];
  setSavedWorkspaces: (
    next: SavedWorkspace[] | ((p: SavedWorkspace[]) => SavedWorkspace[]),
  ) => void;
  savedWindowConfigs: SavedWindowConfig[];
  setSavedWindowConfigs: (
    next: SavedWindowConfig[] | ((p: SavedWindowConfig[]) => SavedWindowConfig[]),
  ) => void;
  groups: SessionGroup[];
  setGroups: (next: SessionGroup[] | ((p: SessionGroup[]) => SessionGroup[])) => void;
  nextGroupId: number;
  setNextGroupId: (next: number | ((p: number) => number)) => void;

  // ---- mutations ---------------------------------------------------
  upsertSavedConfig: (config: SavedSessionConfig) => void;
  removeSavedConfig: (configId: string) => void;
  upsertSavedWorkspace: (workspace: SavedWorkspace) => void;
  removeSavedWorkspace: (id: string) => void;
  renameSavedWorkspace: (id: string, name: string) => void;
  upsertSavedWindowConfig: (config: SavedWindowConfig) => void;
  removeSavedWindowConfig: (id: string) => void;
  renameSavedWindowConfig: (id: string, name: string) => void;
  addGroup: (group: SessionGroup) => void;
  removeGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  toggleGroup: (id: number) => void;
  addConfigToGroup: (groupId: number, configId: string) => void;
  removeConfigFromGroup: (groupId: number, configId: string) => void;
  reset: () => void;
}

export const usePersistenceStore = create<PersistenceStoreState>((set) => ({
  savedConfigs: [],
  setSavedConfigs: (next) => {
    set((state) => ({
      savedConfigs:
        typeof next === "function"
          ? (next as (p: SavedSessionConfig[]) => SavedSessionConfig[])(state.savedConfigs)
          : next,
    }));
  },
  savedWorkspaces: [],
  setSavedWorkspaces: (next) => {
    set((state) => ({
      savedWorkspaces:
        typeof next === "function"
          ? (next as (p: SavedWorkspace[]) => SavedWorkspace[])(state.savedWorkspaces)
          : next,
    }));
  },
  savedWindowConfigs: [],
  setSavedWindowConfigs: (next) => {
    set((state) => ({
      savedWindowConfigs:
        typeof next === "function"
          ? (next as (p: SavedWindowConfig[]) => SavedWindowConfig[])(state.savedWindowConfigs)
          : next,
    }));
  },
  groups: [],
  setGroups: (next) => {
    set((state) => ({
      groups:
        typeof next === "function"
          ? (next as (p: SessionGroup[]) => SessionGroup[])(state.groups)
          : next,
    }));
  },
  nextGroupId: 1,
  setNextGroupId: (next) => {
    set((state) => ({
      nextGroupId:
        typeof next === "function" ? (next as (p: number) => number)(state.nextGroupId) : next,
    }));
  },

  upsertSavedConfig: (config) => {
    set((state) => {
      const idx = state.savedConfigs.findIndex((c) => c.id === config.id);
      const savedConfigs =
        idx === -1
          ? [...state.savedConfigs, config]
          : state.savedConfigs.map((c) => (c.id === config.id ? config : c));
      return { savedConfigs };
    });
  },
  removeSavedConfig: (configId) => {
    set((state) => ({
      savedConfigs: state.savedConfigs.filter((c) => c.id !== configId),
      groups: state.groups.map((g) => ({
        ...g,
        configIds: g.configIds.filter((id) => id !== configId),
      })),
    }));
  },
  upsertSavedWorkspace: (workspace) => {
    set((state) => {
      const idx = state.savedWorkspaces.findIndex((w) => w.id === workspace.id);
      const savedWorkspaces =
        idx === -1
          ? [...state.savedWorkspaces, workspace]
          : state.savedWorkspaces.map((w) => (w.id === workspace.id ? workspace : w));
      return { savedWorkspaces };
    });
  },
  removeSavedWorkspace: (id) => {
    set((state) => ({
      savedWorkspaces: state.savedWorkspaces.filter((w) => w.id !== id),
    }));
  },
  renameSavedWorkspace: (id, name) => {
    set((state) => ({
      savedWorkspaces: state.savedWorkspaces.map((w) => (w.id === id ? { ...w, name } : w)),
    }));
  },
  upsertSavedWindowConfig: (config) => {
    set((state) => {
      const idx = state.savedWindowConfigs.findIndex((c) => c.id === config.id);
      const savedWindowConfigs =
        idx === -1
          ? [...state.savedWindowConfigs, config]
          : state.savedWindowConfigs.map((c) => (c.id === config.id ? config : c));
      return { savedWindowConfigs };
    });
  },
  removeSavedWindowConfig: (id) => {
    set((state) => ({
      savedWindowConfigs: state.savedWindowConfigs.filter((c) => c.id !== id),
    }));
  },
  renameSavedWindowConfig: (id, name) => {
    set((state) => ({
      savedWindowConfigs: state.savedWindowConfigs.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  },
  addGroup: (group) => {
    set((state) => ({ groups: [...state.groups, group] }));
  },
  removeGroup: (id) => {
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
    }));
  },
  renameGroup: (id, name) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, name } : g)),
    }));
  },
  toggleGroup: (id) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
    }));
  },
  addConfigToGroup: (groupId, configId) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId && !g.configIds.includes(configId)
          ? { ...g, configIds: [...g.configIds, configId] }
          : g,
      ),
    }));
  },
  removeConfigFromGroup: (groupId, configId) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, configIds: g.configIds.filter((id) => id !== configId) } : g,
      ),
    }));
  },
  reset: () => {
    set({
      savedConfigs: [],
      savedWorkspaces: [],
      savedWindowConfigs: [],
      groups: [],
      nextGroupId: 1,
    });
  },
}));

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
 *
 * **Stub actions** are filled in by Commit 4.
 */
import { create } from "zustand";
import type {
  SavedSessionConfig,
  SavedWindowConfig,
  SavedWorkspace,
  SessionGroup,
} from "../../model/entities";

export interface PersistenceStoreState {
  savedConfigs: SavedSessionConfig[];
  setSavedConfigs: (
    next:
      | SavedSessionConfig[]
      | ((p: SavedSessionConfig[]) => SavedSessionConfig[]),
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

  // Stubs.
  upsertSavedConfig: () => {},
  removeSavedConfig: () => {},
  upsertSavedWorkspace: () => {},
  removeSavedWorkspace: () => {},
  renameSavedWorkspace: () => {},
  upsertSavedWindowConfig: () => {},
  removeSavedWindowConfig: () => {},
  renameSavedWindowConfig: () => {},
  addGroup: () => {},
  removeGroup: () => {},
  renameGroup: () => {},
  toggleGroup: () => {},
  addConfigToGroup: () => {},
  removeConfigFromGroup: () => {},
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

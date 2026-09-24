/**
 * Persistence service — action function surface.
 *
 * **Scope**: mutations to the persisted view of saved configs,
 * saved workspaces, saved window configs, and session groups.
 * Each mutation triggers a side-effect via the persistence
 * bridge (writing back to disk). In Commit 3 the stubs just
 * update the in-memory store; Commit 4 wires the disk I/O.
 *
 * **No cross-service imports**.
 */
import type {
  PersistedSessionConfig,
  PersistedWindowConfig,
  PersistedWorkspace,
  SessionGroup,
} from "../../model";
import { usePersistenceStore, type PersistenceStoreState } from "./store";

export function setSavedConfigs(
  next: PersistedSessionConfig[] | ((p: PersistedSessionConfig[]) => PersistedSessionConfig[]),
): void {
  usePersistenceStore.getState().setSavedConfigs(next);
}

export function upsertSavedConfig(config: PersistedSessionConfig): void {
  usePersistenceStore.getState().upsertSavedConfig(config);
}

export function removeSavedConfig(configId: string): void {
  usePersistenceStore.getState().removeSavedConfig(configId);
}

export function setSavedWorkspaces(
  next: PersistedWorkspace[] | ((p: PersistedWorkspace[]) => PersistedWorkspace[]),
): void {
  usePersistenceStore.getState().setSavedWorkspaces(next);
}

export function upsertSavedWorkspace(workspace: PersistedWorkspace): void {
  usePersistenceStore.getState().upsertSavedWorkspace(workspace);
}

export function removeSavedWorkspace(id: string): void {
  usePersistenceStore.getState().removeSavedWorkspace(id);
}

export function renameSavedWorkspace(id: string, name: string): void {
  usePersistenceStore.getState().renameSavedWorkspace(id, name);
}

export function setSavedWindowConfigs(
  next: PersistedWindowConfig[] | ((p: PersistedWindowConfig[]) => PersistedWindowConfig[]),
): void {
  usePersistenceStore.getState().setSavedWindowConfigs(next);
}

export function upsertSavedWindowConfig(config: PersistedWindowConfig): void {
  usePersistenceStore.getState().upsertSavedWindowConfig(config);
}

export function removeSavedWindowConfig(id: string): void {
  usePersistenceStore.getState().removeSavedWindowConfig(id);
}

export function renameSavedWindowConfig(id: string, name: string): void {
  usePersistenceStore.getState().renameSavedWindowConfig(id, name);
}

export function setGroups(next: SessionGroup[] | ((p: SessionGroup[]) => SessionGroup[])): void {
  usePersistenceStore.getState().setGroups(next);
}

export function addGroup(group: SessionGroup): void {
  usePersistenceStore.getState().addGroup(group);
}

export function removeGroup(id: number): void {
  usePersistenceStore.getState().removeGroup(id);
}

export function renameGroup(id: number, name: string): void {
  usePersistenceStore.getState().renameGroup(id, name);
}

export function toggleGroup(id: number): void {
  usePersistenceStore.getState().toggleGroup(id);
}

export function addConfigToGroup(groupId: number, configId: string): void {
  usePersistenceStore.getState().addConfigToGroup(groupId, configId);
}

export function removeConfigFromGroup(groupId: number, configId: string): void {
  usePersistenceStore.getState().removeConfigFromGroup(groupId, configId);
}

export function getSavedConfigs(): PersistedSessionConfig[] {
  return usePersistenceStore.getState().savedConfigs;
}

export function getSavedWorkspaces(): PersistedWorkspace[] {
  return usePersistenceStore.getState().savedWorkspaces;
}

export function getSavedWindowConfigs(): PersistedWindowConfig[] {
  return usePersistenceStore.getState().savedWindowConfigs;
}

export function getGroups(): SessionGroup[] {
  return usePersistenceStore.getState().groups;
}

export function getNextGroupId(): number {
  return usePersistenceStore.getState().nextGroupId;
}

export function resetPersistenceService(): void {
  usePersistenceStore.getState().reset();
}

export function usePersistenceActions(): Pick<
  PersistenceStoreState,
  "savedConfigs" | "savedWorkspaces" | "savedWindowConfigs" | "groups" | "nextGroupId"
> {
  return usePersistenceStore((s) => ({
    savedConfigs: s.savedConfigs,
    savedWorkspaces: s.savedWorkspaces,
    savedWindowConfigs: s.savedWindowConfigs,
    groups: s.groups,
    nextGroupId: s.nextGroupId,
  }));
}

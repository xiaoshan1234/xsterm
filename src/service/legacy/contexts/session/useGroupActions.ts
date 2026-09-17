/**
 * Group actions — thin wrapper hook that delegates to the persistence
 * store. State lives in `src/service/persistence/store.ts`; this hook
 * only adapts the shape so the rest of the React tree keeps working
 * unchanged.
 */
import { useCallback } from "react";
import { usePersistenceStore } from "../../../persistence/store";
import type { SavedSessionConfig } from "../../../../model/entities";
import { createGroup as createGroupUseCase } from "../../../../app/useCases/createGroup";
import { deleteGroup as deleteGroupUseCase } from "../../../../app/useCases/deleteGroup";
import { moveConfigToGroup as moveConfigToGroupUseCase } from "../../../../app/useCases/moveConfigToGroup";

interface UseGroupActionsDeps {
  /** Legacy hook took this so it could allocate ids; the persistence
   * store reads nextGroupId from itself, so callers no longer need to
   * pass it. Kept for type-compatibility with `SessionState` which still
   * exposes `nextGroupId`. */
  nextGroupId: number;
  setNextGroupId: React.Dispatch<React.SetStateAction<number>>;
  updateConfigs: (updater: (prev: never[]) => never[]) => void;
  updateGroups: (updater: (prev: never[]) => never[], nextId?: number) => void;
}

export function useGroupActions(_deps: UseGroupActionsDeps) {
  const persistence = usePersistenceStore;

  const createGroup = useCallback((name: string) => createGroupUseCase(name), []);
  const deleteGroup = useCallback((id: number) => deleteGroupUseCase(id), []);
  const addToGroup = useCallback(
    (groupId: number, configId: string) =>
      persistence.getState().addConfigToGroup(groupId, configId),
    [persistence],
  );
  const removeFromGroup = useCallback(
    (groupId: number, configId: string) =>
      persistence.getState().removeConfigFromGroup(groupId, configId),
    [persistence],
  );
  const moveConfigToGroup = useCallback(
    (configId: string, groupId: number | null) => moveConfigToGroupUseCase(configId, groupId),
    [],
  );
  const renameGroup = useCallback(
    (id: number, name: string) => persistence.getState().renameGroup(id, name),
    [persistence],
  );
  const toggleGroup = useCallback(
    (id: number) => persistence.getState().toggleGroup(id),
    [persistence],
  );
  const updateConfig = useCallback(
    (config: SavedSessionConfig) => persistence.getState().upsertSavedConfig(config),
    [persistence],
  );

  return {
    createGroup,
    deleteGroup,
    addToGroup,
    removeFromGroup,
    moveConfigToGroup,
    renameGroup,
    toggleGroup,
    updateConfig,
  };
}

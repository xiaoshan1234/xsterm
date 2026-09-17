/**
 * Group actions — thin wrapper hook that delegates to the use cases in
 * `src/app/useCases/`. State lives in `src/service/persistence/store.ts`
 * and is mutated by the use cases; this hook only adapts the shape so
 * the rest of the React tree keeps working unchanged.
 */
import { useCallback } from "react";
import { createGroup as createGroupUseCase } from "../../../../app/useCases/createGroup";
import { deleteGroup as deleteGroupUseCase } from "../../../../app/useCases/deleteGroup";
import { renameGroup as renameGroupUseCase } from "../../../../app/useCases/renameGroup";
import { toggleGroup as toggleGroupUseCase } from "../../../../app/useCases/toggleGroup";
import { addToGroup as addToGroupUseCase } from "../../../../app/useCases/addToGroup";
import { removeFromGroup as removeFromGroupUseCase } from "../../../../app/useCases/removeFromGroup";
import { moveConfigToGroup as moveConfigToGroupUseCase } from "../../../../app/useCases/moveConfigToGroup";
import { updateConfig as updateConfigUseCase } from "../../../../app/useCases/updateConfig";

interface UseGroupActionsDeps {
  /** Legacy hook took this so it could allocate ids; the new use case
   * reads from `usePersistenceStore.getState().nextGroupId` instead, so
   * callers no longer need to pass it. Kept for type-compatibility with
   * `SessionState` which still exposes `nextGroupId`. */
  nextGroupId: number;
  setNextGroupId: React.Dispatch<React.SetStateAction<number>>;
  updateConfigs: (updater: (prev: never[]) => never[]) => void;
  updateGroups: (updater: (prev: never[]) => never[], nextId?: number) => void;
}

export function useGroupActions(_deps: UseGroupActionsDeps) {
  const createGroup = useCallback((name: string) => createGroupUseCase(name), []);
  const deleteGroup = useCallback((id: number) => deleteGroupUseCase(id), []);
  const addToGroup = useCallback(
    (groupId: number, configId: string) => addToGroupUseCase(groupId, configId),
    [],
  );
  const removeFromGroup = useCallback(
    (groupId: number, configId: string) => removeFromGroupUseCase(groupId, configId),
    [],
  );
  const moveConfigToGroup = useCallback(
    (configId: string, groupId: number | null) => moveConfigToGroupUseCase(configId, groupId),
    [],
  );
  const renameGroup = useCallback(
    (id: number, name: string) => renameGroupUseCase(id, name),
    [],
  );
  const toggleGroup = useCallback((id: number) => toggleGroupUseCase(id), []);
  const updateConfig = useCallback(
    (config: Parameters<typeof updateConfigUseCase>[0]) => updateConfigUseCase(config),
    [],
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
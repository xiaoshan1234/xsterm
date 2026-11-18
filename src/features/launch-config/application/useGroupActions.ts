import { useCallback } from "react";
import type { SavedTerminalConfig, TerminalGroup } from "../contracts";
import {
  addConfigToGroup,
  addGroup,
  deleteGroup as deleteGroupFromList,
  moveConfigToGroup as moveConfigToGroupInList,
  removeConfigFromGroup,
  renameGroup as renameGroupInList,
  toggleGroup as toggleGroupInList,
} from "./groupOperations";

interface UseGroupActionsDeps {
  nextGroupId: number;
  setNextGroupId: React.Dispatch<React.SetStateAction<number>>;
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
}

export function useGroupActions(deps: UseGroupActionsDeps) {
  const { nextGroupId, setNextGroupId, updateConfigs, updateGroups } = deps;

  const createGroup = useCallback(
    (name: string) => {
      const id = nextGroupId;
      setNextGroupId((prev) => prev + 1);
      updateGroups((prev) => addGroup(prev, id, name), id + 1);
    },
    [nextGroupId, setNextGroupId, updateGroups],
  );

  const deleteGroup = useCallback(
    (id: number) => {
      updateGroups((prev) => deleteGroupFromList(prev, id));
    },
    [updateGroups],
  );

  const addToGroup = useCallback(
    (groupId: number, configId: string) => {
      updateGroups((prev) => addConfigToGroup(prev, groupId, configId));
    },
    [updateGroups],
  );

  const removeFromGroup = useCallback(
    (groupId: number, configId: string) => {
      updateGroups((prev) => removeConfigFromGroup(prev, groupId, configId));
    },
    [updateGroups],
  );

  const moveConfigToGroup = useCallback(
    (configId: string, groupId: number | null) => {
      updateGroups((prev) => moveConfigToGroupInList(prev, configId, groupId));
    },
    [updateGroups],
  );

  const renameGroup = useCallback(
    (id: number, name: string) => {
      updateGroups((prev) => renameGroupInList(prev, id, name));
    },
    [updateGroups],
  );

  const toggleGroup = useCallback(
    (id: number) => {
      updateGroups((prev) => toggleGroupInList(prev, id));
    },
    [updateGroups],
  );

  const updateConfig = useCallback(
    (config: SavedTerminalConfig) => {
      updateConfigs((prev) => prev.map((c) => (c.id === config.id ? config : c)));
    },
    [updateConfigs],
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

import { useCallback } from "react";
import type { SavedSessionConfig, SessionGroup } from "../../types/session";

interface UseGroupActionsDeps {
  nextGroupId: number;
  setNextGroupId: React.Dispatch<React.SetStateAction<number>>;
  updateConfigs: (updater: (prev: SavedSessionConfig[]) => SavedSessionConfig[]) => void;
  updateGroups: (updater: (prev: SessionGroup[]) => SessionGroup[], nextId?: number) => void;
}

export function useGroupActions(deps: UseGroupActionsDeps) {
  const { nextGroupId, setNextGroupId, updateConfigs, updateGroups } = deps;

  const createGroup = useCallback(
    (name: string) => {
      const id = nextGroupId;
      setNextGroupId((prev) => prev + 1);
      updateGroups((prev) => [...prev, { id, name, configIds: [], collapsed: false }], id + 1);
    },
    [nextGroupId, setNextGroupId, updateGroups],
  );

  const deleteGroup = useCallback(
    (id: number) => {
      updateGroups((prev) => prev.filter((g) => g.id !== id));
    },
    [updateGroups],
  );

  const addToGroup = useCallback(
    (groupId: number, configId: string) => {
      updateGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, configIds: [...g.configIds, configId] } : g)),
      );
    },
    [updateGroups],
  );

  const removeFromGroup = useCallback(
    (groupId: number, configId: string) => {
      updateGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, configIds: g.configIds.filter((cid) => cid !== configId) } : g,
        ),
      );
    },
    [updateGroups],
  );

  const moveConfigToGroup = useCallback(
    (configId: string, groupId: number | null) => {
      updateGroups((prev) =>
        prev.map((g) => ({
          ...g,
          configIds: g.configIds.filter((id) => id !== configId),
        })),
      );
      if (groupId !== null) {
        updateGroups((prev) =>
          prev.map((g) => (g.id === groupId ? { ...g, configIds: [...g.configIds, configId] } : g)),
        );
      }
    },
    [updateGroups],
  );

  const renameGroup = useCallback(
    (id: number, name: string) => {
      updateGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
    },
    [updateGroups],
  );

  const toggleGroup = useCallback(
    (id: number) => {
      updateGroups((prev) =>
        prev.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
      );
    },
    [updateGroups],
  );

  const updateConfig = useCallback(
    (config: SavedSessionConfig) => {
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

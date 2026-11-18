import { useCallback, useEffect } from "react";
import type { SavedTerminalConfig, TerminalGroup } from "../contracts";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "../constants";
import {
  loadSavedConfigs,
  loadSavedGroups,
  persistConfigs,
  persistGroups,
} from "../persistence/launchConfigStorage";

interface UseLaunchConfigPersistenceOptions {
  setSavedConfigs: (
    value: SavedTerminalConfig[] | ((prev: SavedTerminalConfig[]) => SavedTerminalConfig[]),
  ) => void;
  setGroups: (value: TerminalGroup[] | ((prev: TerminalGroup[]) => TerminalGroup[])) => void;
  setNextGroupId: (value: number | ((prev: number) => number)) => void;
  nextGroupId: number;
}

export interface LaunchConfigPersistenceActions {
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
}

export function useLaunchConfigPersistence({
  setSavedConfigs,
  setGroups,
  setNextGroupId,
  nextGroupId,
}: UseLaunchConfigPersistenceOptions): LaunchConfigPersistenceActions {
  const updateConfigs = useCallback(
    (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => {
      setSavedConfigs((previous) => {
        const updated = updater(previous);
        void persistConfigs(updated);
        return updated;
      });
    },
    [setSavedConfigs],
  );

  const updateGroups = useCallback(
    (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => {
      setGroups((previous) => {
        const updated = updater(previous);
        void persistGroups({ groups: updated, nextGroupId: nextId ?? nextGroupId });
        return updated;
      });
    },
    [nextGroupId, setGroups],
  );

  useEffect(() => {
    let isCancelled = false;
    const initialize = async () => {
      const [configs, savedGroups] = await Promise.all([loadSavedConfigs(), loadSavedGroups()]);
      if (isCancelled) return;

      setSavedConfigs(configs);
      setGroups(
        savedGroups.groups.some((group) => group.id === DEFAULT_GROUP_ID)
          ? savedGroups.groups
          : [
              {
                id: DEFAULT_GROUP_ID,
                name: DEFAULT_GROUP_NAME,
                configIds: [],
                collapsed: false,
              },
              ...savedGroups.groups,
            ],
      );
      setNextGroupId(savedGroups.nextGroupId);
    };

    void initialize();
    return () => {
      isCancelled = true;
    };
  }, [setGroups, setNextGroupId, setSavedConfigs]);

  return { updateConfigs, updateGroups };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedTerminalConfig, TerminalGroup } from "../contracts";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "../constants";
import {
  launchConfigRepository,
  type LaunchConfigRepository,
} from "../persistence/launchConfigRepository";

interface UseLaunchConfigPersistenceOptions {
  setSavedConfigs: (
    value: SavedTerminalConfig[] | ((prev: SavedTerminalConfig[]) => SavedTerminalConfig[]),
  ) => void;
  setGroups: (value: TerminalGroup[] | ((prev: TerminalGroup[]) => TerminalGroup[])) => void;
  setNextGroupId: (value: number | ((prev: number) => number)) => void;
  savedConfigs: SavedTerminalConfig[];
  groups: TerminalGroup[];
  nextGroupId: number;
  repository?: LaunchConfigRepository;
}

export interface LaunchConfigPersistenceActions {
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  isLoaded: boolean;
  error: string | null;
}

export function useLaunchConfigPersistence({
  setSavedConfigs,
  setGroups,
  setNextGroupId,
  savedConfigs,
  groups,
  nextGroupId,
  repository = launchConfigRepository,
}: UseLaunchConfigPersistenceOptions): LaunchConfigPersistenceActions {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipInitialConfigPersistRef = useRef(true);
  const skipInitialGroupPersistRef = useRef(true);

  const updateConfigs = useCallback(
    (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => {
      setSavedConfigs(updater);
    },
    [setSavedConfigs],
  );

  const updateGroups = useCallback(
    (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => {
      setGroups(updater);
      if (nextId !== undefined) {
        setNextGroupId(nextId);
      }
    },
    [setGroups, setNextGroupId],
  );

  useEffect(() => {
    if (!isLoaded) return;
    if (skipInitialConfigPersistRef.current) {
      skipInitialConfigPersistRef.current = false;
      return;
    }
    void repository.persistConfigs(savedConfigs).catch((cause) => {
      console.error("Failed to persist launch configs:", cause);
    });
  }, [isLoaded, repository, savedConfigs]);

  useEffect(() => {
    if (!isLoaded) return;
    if (skipInitialGroupPersistRef.current) {
      skipInitialGroupPersistRef.current = false;
      return;
    }
    void repository.persistGroups({ groups, nextGroupId }).catch((cause) => {
      console.error("Failed to persist launch config groups:", cause);
    });
  }, [groups, isLoaded, nextGroupId, repository]);

  useEffect(() => {
    let isCancelled = false;
    const initialize = async () => {
      try {
        const [configs, savedGroups] = await Promise.all([
          repository.loadConfigs(),
          repository.loadGroups(),
        ]);
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
      } catch (cause) {
        if (!isCancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!isCancelled) setIsLoaded(true);
      }
    };

    void initialize();
    return () => {
      isCancelled = true;
    };
  }, [repository, setGroups, setNextGroupId, setSavedConfigs]);

  return { updateConfigs, updateGroups, isLoaded, error };
}

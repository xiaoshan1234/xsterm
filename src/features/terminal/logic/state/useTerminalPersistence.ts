import { useCallback, useEffect } from "react";
import * as terminalStorage from "../../../../services/terminalStorage";
import {
  type SavedTerminalConfig,
  type SavedWindowConfig,
  type SavedWorkspace,
  type TerminalGroup,
} from "../../../../types/terminal";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "./constants";
import { type SessionPersistence } from "./types";

interface UseSessionPersistenceOptions {
  setSavedConfigs: (
    value: SavedTerminalConfig[] | ((prev: SavedTerminalConfig[]) => SavedTerminalConfig[]),
  ) => void;
  setGroups: (value: TerminalGroup[] | ((prev: TerminalGroup[]) => TerminalGroup[])) => void;
  setNextGroupId: (value: number | ((prev: number) => number)) => void;
  setSavedWorkspaces: (
    value: SavedWorkspace[] | ((prev: SavedWorkspace[]) => SavedWorkspace[]),
  ) => void;
  setSavedWindowConfigs: (
    value: SavedWindowConfig[] | ((prev: SavedWindowConfig[]) => SavedWindowConfig[]),
  ) => void;
  setGlobalLocalEcho: (value: boolean | ((prev: boolean) => boolean)) => void;
  globalLocalEcho: boolean;
  nextGroupId: number;
}

export function useTerminalPersistence({
  setSavedConfigs,
  setGroups,
  setNextGroupId,
  setSavedWorkspaces,
  setSavedWindowConfigs,
  setGlobalLocalEcho,
  globalLocalEcho,
  nextGroupId,
}: UseSessionPersistenceOptions): SessionPersistence {
  const persistSavedWorkspaces = useCallback((workspacesData: SavedWorkspace[]) => {
    terminalStorage.persistWorkspaces(workspacesData);
  }, []);

  const persistSavedWindowConfigs = useCallback((configs: SavedWindowConfig[]) => {
    terminalStorage.persistWindowConfigs(configs);
  }, []);

  const updateConfigs = useCallback(
    (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => {
      setSavedConfigs((prev) => {
        const updated = updater(prev);
        terminalStorage.persistConfigs(updated);
        return updated;
      });
    },
    [setSavedConfigs],
  );

  const updateGroups = useCallback(
    (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => {
      setGroups((prev) => {
        const updated = updater(prev);
        terminalStorage.persistGroups({ groups: updated, nextGroupId: nextId ?? nextGroupId });
        return updated;
      });
    },
    [nextGroupId, setGroups],
  );

  useEffect(() => {
    const init = async () => {
      const [configs, savedGroups, workspacesData, windowConfigs] = await Promise.all([
        terminalStorage.loadSavedConfigs(),
        terminalStorage.loadSavedGroups(),
        terminalStorage.loadSavedWorkspaces(),
        terminalStorage.loadSavedWindowConfigs(),
      ]);
      setSavedConfigs(configs);
      if (savedGroups.groups.some((g) => g.id === DEFAULT_GROUP_ID)) {
        setGroups(savedGroups.groups);
      } else {
        setGroups([
          {
            id: DEFAULT_GROUP_ID,
            name: DEFAULT_GROUP_NAME,
            configIds: [],
            collapsed: false,
          },
          ...savedGroups.groups,
        ]);
      }
      setNextGroupId(savedGroups.nextGroupId);
      setSavedWorkspaces(workspacesData);
      setSavedWindowConfigs(windowConfigs);

      try {
        const store = await terminalStorage.getSettingsStore();
        const savedGlobalEcho = await store.get<boolean>("globalLocalEcho");
        if (savedGlobalEcho !== null && savedGlobalEcho !== undefined) {
          setGlobalLocalEcho(savedGlobalEcho);
        }
      } catch (e) {
        console.error("Failed to load global settings:", e);
      }
    };
    init();
  }, [
    setSavedConfigs,
    setGroups,
    setNextGroupId,
    setSavedWorkspaces,
    setSavedWindowConfigs,
    setGlobalLocalEcho,
  ]);

  useEffect(() => {
    let cancelled = false;
    const persist = async () => {
      try {
        const store = await terminalStorage.getSettingsStore();
        if (!cancelled) {
          await store.set("globalLocalEcho", globalLocalEcho);
          await store.save();
        }
      } catch (e) {
        console.error("Failed to save global settings:", e);
      }
    };
    persist();
    return () => {
      cancelled = true;
    };
  }, [globalLocalEcho]);

  return { updateConfigs, updateGroups, persistSavedWorkspaces, persistSavedWindowConfigs };
}

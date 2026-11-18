import { useCallback, useEffect } from "react";
import { useLaunchConfigPersistence } from "../../../features/launch-config/composition";
import { getSettingsStore } from "../../../features/settings";
import {
  loadSavedWindowConfigs,
  loadSavedWorkspaces,
  persistWindowConfigs,
  persistWorkspaces,
} from "../../../features/workspace/composition";
import type { SavedTerminalConfig, TerminalGroup } from "../../../features/launch-config";
import type { SavedWindowConfig, SavedWorkspace } from "../../../features/workspace";
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
  const launchConfigPersistence = useLaunchConfigPersistence({
    setSavedConfigs,
    setGroups,
    setNextGroupId,
    nextGroupId,
  });

  const persistSavedWorkspaces = useCallback((workspacesData: SavedWorkspace[]) => {
    void persistWorkspaces(workspacesData);
  }, []);

  const persistSavedWindowConfigs = useCallback((configs: SavedWindowConfig[]) => {
    void persistWindowConfigs(configs);
  }, []);

  useEffect(() => {
    const init = async () => {
      const [workspacesData, windowConfigs] = await Promise.all([
        loadSavedWorkspaces(),
        loadSavedWindowConfigs(),
      ]);
      setSavedWorkspaces(workspacesData);
      setSavedWindowConfigs(windowConfigs);

      try {
        const store = getSettingsStore();
        const savedGlobalEcho = await store.get<boolean>("globalLocalEcho");
        if (savedGlobalEcho !== null && savedGlobalEcho !== undefined) {
          setGlobalLocalEcho(savedGlobalEcho);
        }
      } catch (e) {
        console.error("Failed to load global settings:", e);
      }
    };
    init();
  }, [setSavedWorkspaces, setSavedWindowConfigs, setGlobalLocalEcho]);

  useEffect(() => {
    let cancelled = false;
    const persist = async () => {
      try {
        const store = getSettingsStore();
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

  return {
    ...launchConfigPersistence,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
  };
}

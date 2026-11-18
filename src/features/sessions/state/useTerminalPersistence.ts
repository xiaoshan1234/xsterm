import { useCallback, useEffect } from "react";
import { useLaunchConfigPersistence } from "../../launch-config";
import * as terminalStorage from "../persistence/terminalStorage";
import {
  type SavedTerminalConfig,
  type SavedWindowConfig,
  type SavedWorkspace,
  type TerminalGroup,
} from "../../../models/legacy/terminal";
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
    terminalStorage.persistWorkspaces(workspacesData);
  }, []);

  const persistSavedWindowConfigs = useCallback((configs: SavedWindowConfig[]) => {
    terminalStorage.persistWindowConfigs(configs);
  }, []);

  useEffect(() => {
    const init = async () => {
      const [workspacesData, windowConfigs] = await Promise.all([
        terminalStorage.loadSavedWorkspaces(),
        terminalStorage.loadSavedWindowConfigs(),
      ]);
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
  }, [setSavedWorkspaces, setSavedWindowConfigs, setGlobalLocalEcho]);

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

  return {
    ...launchConfigPersistence,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
  };
}

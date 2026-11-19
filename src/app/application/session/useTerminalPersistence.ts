import { useCallback, useEffect, useRef, useState } from "react";
import {
  launchConfigRepository as defaultLaunchConfigRepository,
  useLaunchConfigPersistence,
  type LaunchConfigRepository,
} from "../../../features/launch-config";
import {
  settingsRepository as defaultSettingsRepository,
  type SettingsRepository,
} from "../../../features/settings";
import {
  workspaceRepository as defaultWorkspaceRepository,
  type WorkspaceRepository,
} from "../../../features/workspace";
import type { SavedTerminalConfig, TerminalGroup } from "../../../features/launch-config";
import type { SavedWindowConfig, SavedWorkspace } from "../../../features/workspace";
import type { SessionPersistence, SessionPersistenceSaveError } from "./types";

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
  savedConfigs: SavedTerminalConfig[];
  groups: TerminalGroup[];
  globalLocalEcho: boolean;
  nextGroupId: number;
  launchConfigRepository?: LaunchConfigRepository;
  workspaceRepository?: WorkspaceRepository;
  settingsRepository?: SettingsRepository;
}

export function useTerminalPersistence({
  setSavedConfigs,
  setGroups,
  setNextGroupId,
  setSavedWorkspaces,
  setSavedWindowConfigs,
  setGlobalLocalEcho,
  savedConfigs,
  groups,
  globalLocalEcho,
  nextGroupId,
  launchConfigRepository: launchRepository = defaultLaunchConfigRepository,
  workspaceRepository: workspaceRepo = defaultWorkspaceRepository,
  settingsRepository: settingsRepo = defaultSettingsRepository,
}: UseSessionPersistenceOptions): SessionPersistence {
  const [isWorkspaceDataLoaded, setIsWorkspaceDataLoaded] = useState(false);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SessionPersistenceSaveError | null>(null);
  const skipInitialSettingsPersistRef = useRef(true);
  const reportSaveError = useCallback(
    (source: SessionPersistenceSaveError["source"], operation: string, cause: unknown) => {
      console.error(`Failed to ${operation}:`, cause);
      setSaveError({
        source,
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    },
    [],
  );
  const reportLaunchConfigSaveError = useCallback(
    (operation: string, cause: unknown) => {
      reportSaveError("launch-config", operation, cause);
    },
    [reportSaveError],
  );
  const launchConfigPersistence = useLaunchConfigPersistence({
    setSavedConfigs,
    setGroups,
    setNextGroupId,
    savedConfigs,
    groups,
    nextGroupId,
    repository: launchRepository,
    onSaveError: reportLaunchConfigSaveError,
  });

  const persistSavedWorkspaces = useCallback(
    (workspacesData: SavedWorkspace[]) => {
      void workspaceRepo.persistWorkspaces(workspacesData).catch((cause) => {
        reportSaveError("workspace", "save workspace snapshots", cause);
      });
    },
    [reportSaveError, workspaceRepo],
  );

  const persistSavedWindowConfigs = useCallback(
    (configs: SavedWindowConfig[]) => {
      void workspaceRepo.persistWindowConfigs(configs).catch((cause) => {
        reportSaveError("workspace", "save window configurations", cause);
      });
    },
    [reportSaveError, workspaceRepo],
  );

  useEffect(() => {
    let isCancelled = false;
    const init = async () => {
      try {
        const [workspacesData, windowConfigs] = await Promise.all([
          workspaceRepo.loadWorkspaces(),
          workspaceRepo.loadWindowConfigs(),
        ]);
        if (isCancelled) return;
        setSavedWorkspaces(workspacesData);
        setSavedWindowConfigs(windowConfigs);
      } catch (cause) {
        if (!isCancelled) {
          setWorkspaceError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!isCancelled) setIsWorkspaceDataLoaded(true);
      }
    };
    void init();
    return () => {
      isCancelled = true;
    };
  }, [setSavedWorkspaces, setSavedWindowConfigs, workspaceRepo]);

  useEffect(() => {
    let isCancelled = false;
    const loadSettings = async () => {
      try {
        const savedGlobalEcho = await settingsRepo.loadGlobalLocalEcho();
        if (!isCancelled && savedGlobalEcho !== undefined) {
          setGlobalLocalEcho(savedGlobalEcho);
        }
      } catch (e) {
        console.error("Failed to load global settings:", e);
        if (!isCancelled) {
          setSettingsError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!isCancelled) setIsSettingsLoaded(true);
      }
    };
    void loadSettings();
    return () => {
      isCancelled = true;
    };
  }, [setGlobalLocalEcho, settingsRepo]);

  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (skipInitialSettingsPersistRef.current) {
      skipInitialSettingsPersistRef.current = false;
      return;
    }
    let cancelled = false;
    const persist = async () => {
      try {
        if (!cancelled) {
          await settingsRepo.persistGlobalLocalEcho(globalLocalEcho);
        }
      } catch (e) {
        if (!cancelled) {
          reportSaveError("settings", "save terminal preferences", e);
        }
      }
    };
    persist();
    return () => {
      cancelled = true;
    };
  }, [globalLocalEcho, isSettingsLoaded, reportSaveError, settingsRepo]);

  const clearSaveError = useCallback(() => {
    setSaveError(null);
  }, []);

  return {
    ...launchConfigPersistence,
    isLoaded: launchConfigPersistence.isLoaded && isWorkspaceDataLoaded && isSettingsLoaded,
    error: launchConfigPersistence.error ?? workspaceError ?? settingsError,
    saveError,
    clearSaveError,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
  };
}

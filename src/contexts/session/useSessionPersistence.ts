import { useCallback, useEffect } from "react";
import * as sessionStorage from "../../services/sessionStorage";
import { normalizeSavedConfig } from "../../utils/sessionConfigMigration";
import { SavedSessionConfig, SavedWindowConfig, SavedWorkspace, SessionGroup } from "../../types/session";
import { SessionPersistence } from "./types";

interface UseSessionPersistenceOptions {
  setSavedConfigs: (value: SavedSessionConfig[] | ((prev: SavedSessionConfig[]) => SavedSessionConfig[])) => void;
  setGroups: (value: SessionGroup[] | ((prev: SessionGroup[]) => SessionGroup[])) => void;
  setNextGroupId: (value: number | ((prev: number) => number)) => void;
  setSavedWorkspaces: (value: SavedWorkspace[] | ((prev: SavedWorkspace[]) => SavedWorkspace[])) => void;
  setSavedWindowConfigs: (value: SavedWindowConfig[] | ((prev: SavedWindowConfig[]) => SavedWindowConfig[])) => void;
  setGlobalLocalEcho: (value: boolean | ((prev: boolean) => boolean)) => void;
  globalLocalEcho: boolean;
  nextGroupId: number;
}

export function useSessionPersistence({
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
    sessionStorage.persistWorkspaces(workspacesData);
  }, []);

  const persistSavedWindowConfigs = useCallback((configs: SavedWindowConfig[]) => {
    sessionStorage.persistWindowConfigs(configs);
  }, []);

  const updateConfigs = useCallback(
    (updater: (prev: SavedSessionConfig[]) => SavedSessionConfig[]) => {
      setSavedConfigs((prev) => {
        const updated = updater(prev);
        sessionStorage.persistConfigs(updated);
        return updated;
      });
    },
    [setSavedConfigs]
  );

  const updateGroups = useCallback(
    (updater: (prev: SessionGroup[]) => SessionGroup[], nextId?: number) => {
      setGroups((prev) => {
        const updated = updater(prev);
        sessionStorage.persistGroups({ groups: updated, nextGroupId: nextId ?? nextGroupId });
        return updated;
      });
    },
    [nextGroupId, setGroups]
  );

  useEffect(() => {
    const init = async () => {
      const [rawConfigs, savedGroups, workspacesData, windowConfigs] = await Promise.all([
        sessionStorage.loadSavedConfigs(),
        sessionStorage.loadSavedGroups(),
        sessionStorage.loadSavedWorkspaces(),
        sessionStorage.loadSavedWindowConfigs(),
      ]);
      const configs = rawConfigs.map((c) => normalizeSavedConfig(c));
      setSavedConfigs(configs);
      setGroups(savedGroups.groups);
      setNextGroupId(savedGroups.nextGroupId);
      setSavedWorkspaces(workspacesData);
      setSavedWindowConfigs(windowConfigs);

      try {
        const store = await sessionStorage.getSettingsStore();
        const savedGlobalEcho = await store.get<boolean>("globalLocalEcho");
        if (savedGlobalEcho !== null && savedGlobalEcho !== undefined) {
          setGlobalLocalEcho(savedGlobalEcho);
        }
      } catch (e) {
        console.error("Failed to load global settings:", e);
      }
    };
    init();
  }, [setSavedConfigs, setGroups, setNextGroupId, setSavedWorkspaces, setSavedWindowConfigs, setGlobalLocalEcho]);

  useEffect(() => {
    let cancelled = false;
    const persist = async () => {
      try {
        const store = await sessionStorage.getSettingsStore();
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

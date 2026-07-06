import { useCallback, useEffect } from "react";
import * as sessionStorage from "../../services/sessionStorage";
import { SavedSessionConfig, SavedWorkspace, SessionGroup } from "../../types/session";
import { SessionPersistence } from "./types";

interface UseSessionPersistenceOptions {
  setSavedConfigs: (value: SavedSessionConfig[] | ((prev: SavedSessionConfig[]) => SavedSessionConfig[])) => void;
  setGroups: (value: SessionGroup[] | ((prev: SessionGroup[]) => SessionGroup[])) => void;
  setNextGroupId: (value: number | ((prev: number) => number)) => void;
  setSavedWorkspaces: (value: SavedWorkspace[] | ((prev: SavedWorkspace[]) => SavedWorkspace[])) => void;
  setGlobalLocalEcho: (value: boolean | ((prev: boolean) => boolean)) => void;
  globalLocalEcho: boolean;
  nextGroupId: number;
}

export function useSessionPersistence({
  setSavedConfigs,
  setGroups,
  setNextGroupId,
  setSavedWorkspaces,
  setGlobalLocalEcho,
  globalLocalEcho,
  nextGroupId,
}: UseSessionPersistenceOptions): SessionPersistence {
  const persistSavedWorkspaces = useCallback((workspacesData: SavedWorkspace[]) => {
    sessionStorage.persistWorkspaces(workspacesData);
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

  // ============================================================
  // 初始化：从 Tauri store 加载持久化数据到 React 状态
  // ============================================================
  useEffect(() => {
    const init = async () => {
      // 并行加载三个数据源：会话配置、分组、工作区快照
      const [configs, savedGroups, workspacesData] = await Promise.all([
        sessionStorage.loadSavedConfigs(),   // 读取 sessions.json 中的 savedConfigs
        sessionStorage.loadSavedGroups(),    // 读取 sessions.json 中的 groups（含 nextGroupId）
        sessionStorage.loadSavedWorkspaces(),// 读取 sessions.json 中的 savedWorkspaces
      ]);
      setSavedConfigs(configs);
      setGroups(savedGroups.groups);
      setNextGroupId(savedGroups.nextGroupId);
      setSavedWorkspaces(workspacesData);

      // 单独从 settings store 加载全局本地回显设置
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
  }, [setSavedConfigs, setGroups, setNextGroupId, setSavedWorkspaces, setGlobalLocalEcho]);

  // ============================================================
  // 同步：globalLocalEcho 变更时自动写回 settings store
  // ============================================================
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

  return { updateConfigs, updateGroups, persistSavedWorkspaces };
}

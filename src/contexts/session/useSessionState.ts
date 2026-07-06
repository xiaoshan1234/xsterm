import { useState, useRef, useCallback, useEffect } from "react";
import { SavedSessionConfig, SavedWorkspace, Session, SessionGroup, Workspace } from "../../types/session";
import { TmuxState } from "../../types/tmux";
import { SessionState } from "./types";

/**
 * 会话状态管理 Hook
 *
 * 状态生命周期概述：
 * 1. 应用启动时，useSessionPersistence 从 Tauri store 加载 savedConfigs、groups、savedWorkspaces
 * 2. 用户通过 createLocalSession/createSshSession/createTmuxSession 创建会话 → sessions[]
 * 3. 每个会话自动创建对应的工作区 → workspaces[]，其中包含面板树（PaneNode）
 * 4. 用户可将工作区保存为快照 → savedWorkspaces[]（含配置信息，重启后可恢复）
 * 5. 会话关闭时自动从 sessions[] 和 workspaces[] 中移除对应项
 */
export function useSessionState(): SessionState {
  // 已保存的会话配置列表（持久化到 sessions.json）
  const [savedConfigs, setSavedConfigs] = useState<SavedSessionConfig[]>([]);
  // 当前活跃的会话实例列表（运行时状态，不持久化）
  const [sessions, setSessions] = useState<Session[]>([]);
  // 当前活跃的工作区列表（运行时状态）
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  // 当前展示的工作区 ID（运行时状态）
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  // 已保存的工作区快照列表（持久化，包含面板树结构）
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
  // 会话分组列表，用于 UI 侧边栏展示（持久化）
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  // 下一个新分组的 ID（持久化，避免 ID 冲突）
  const [nextGroupId, setNextGroupId] = useState(1);
  // 全局本地回显开关（持久化到 settings store）
  const [globalLocalEcho, setGlobalLocalEcho] = useState(false);
  // 单个会话的本地回显覆盖（Map<会话ID, 是否启用>，优先级高于 globalLocalEcho）
  const [sessionLocalEchoOverrides] = useState<Map<number, boolean>>(new Map());
  // Tmux 会话、窗口、面板的完整状态（运行时状态）
  const [tmuxState, setTmuxState] = useState<TmuxState>({
    sessions: new Map(),
    windows: new Map(),
    panes: new Map(),
  });
  // 每个 Tmux 会话对应的当前活跃窗口 ID（Map<会话ID, 窗口ID>）
  const [activeTmuxWindowIds, setActiveTmuxWindowIds] = useState<Map<number, string>>(new Map());

  // refs 用于在不重新渲染的情况下访问最新状态（避免闭包陷阱）
  const sessionsRef = useRef(sessions);
  const workspacesRef = useRef(workspaces);
  // 正在建立中的 Tmux 会话 ID 集合（用于避免重复初始化）
  const establishingSessionsRef = useRef<Set<number>>(new Set());
  // Tmux 会话列表轮询定时器（Map<会话ID, timeoutId>）
  const tmuxListTimeoutsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const getEffectiveLocalEcho = useCallback(
    (sessionId: number) => {
      if (sessionLocalEchoOverrides.has(sessionId)) {
        return sessionLocalEchoOverrides.get(sessionId)!;
      }
      return globalLocalEcho;
    },
    [sessionLocalEchoOverrides, globalLocalEcho]
  );

  return {
    savedConfigs,
    setSavedConfigs,
    sessions,
    setSessions,
    workspaces,
    setWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    savedWorkspaces,
    setSavedWorkspaces,
    groups,
    setGroups,
    nextGroupId,
    setNextGroupId,
    globalLocalEcho,
    setGlobalLocalEcho,
    sessionLocalEchoOverrides,
    tmuxState,
    setTmuxState,
    activeTmuxWindowIds,
    setActiveTmuxWindowIds,
    sessionsRef,
    workspacesRef,
    establishingSessionsRef,
    tmuxListTimeoutsRef,
    getEffectiveLocalEcho,
  };
}

import { useState, useRef, useCallback, useEffect } from "react";
import { SavedSessionConfig, SavedWindowConfig, SavedWorkspace, Session, SessionGroup, Workspace } from "../../types/session";
import { TmuxState } from "../../types/tmux";
import { SessionState } from "./types";

export function useSessionState(): SessionState {
  const [savedConfigs, setSavedConfigs] = useState<SavedSessionConfig[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
  const [savedWindowConfigs, setSavedWindowConfigs] = useState<SavedWindowConfig[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);
  const [globalLocalEcho, setGlobalLocalEcho] = useState(false);
  const [sessionLocalEchoOverrides] = useState<Map<number, boolean>>(new Map());
  const [tmuxState, setTmuxState] = useState<TmuxState>({
    sessions: new Map(),
    windows: new Map(),
    panes: new Map(),
    underlays: new Map(),
  });
  const [activeTmuxWindowIds, setActiveTmuxWindowIds] = useState<Map<number, string>>(new Map());

  const sessionsRef = useRef(sessions);
  const workspacesRef = useRef(workspaces);
  const establishingSessionsRef = useRef<Set<number>>(new Set());
  const tmuxListTimeoutsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    if (activeWorkspaceId === null && workspaces.length > 0) {
      setActiveWorkspaceId(workspaces[0].id);
    } else if (activeWorkspaceId && !workspaces.find((w) => w.id === activeWorkspaceId)) {
      const fallbackId = workspaces[0]?.id ?? null;
      setActiveWorkspaceId(fallbackId);
    }
  }, [workspaces, activeWorkspaceId, setActiveWorkspaceId]);

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
    savedWindowConfigs,
    setSavedWindowConfigs,
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

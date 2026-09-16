import { useState, useRef, useCallback, useEffect } from "react";
import {
  type SavedSessionConfig,
  type SavedWindowConfig,
  type SavedWorkspace,
  type Session,
  type SessionGroup,
  type TmuxCcConfig,
  type TmuxWindowListEntry,
  type Workspace,
} from "../../types/session";
import { type SessionState, type TmuxControllerError } from "./types";

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
  // one entry per tmux controller that has exited unexpectedly.
  // Kept separate from `sessions` so its lifecycle is not affected by the
  // `tmux-controller-exit` listener's `setSessions((prev) => prev.filter(...))`.
  const [tmuxControllerErrors, setTmuxControllerErrors] = useState<
    Map<number, TmuxControllerError>
  >(new Map());
  // `controllerId → config` map. Populated by the create / attach
  // tmux flows so the retry banner can hand the original config back to
  // `createTmux` / `attachTmux`. Survives pane teardown (which only removes
  // `sessions` entries, not the controller's persistent metadata).
  const tmuxControllerConfigsRef = useRef<Map<number, TmuxCcConfig>>(new Map());
  // `controllerId → TmuxWindowListEntry[]` cache. Populated by the
  // `tmux-window-list` listener and incrementally refreshed by
  // `tmux-window-added` / `-closed` / `-renamed`. Read by
  // `TmuxWindowsControl` to render the windows-control card. ADR 0009 §2.6.
  const tmuxWindowListsRef = useRef<Map<number, TmuxWindowListEntry[]>>(new Map());

  const sessionsRef = useRef(sessions);
  const workspacesRef = useRef(workspaces);
  const establishingSessionsRef = useRef<Set<number>>(new Set());

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
    [sessionLocalEchoOverrides, globalLocalEcho],
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
    sessionsRef,
    workspacesRef,
    establishingSessionsRef,
    getEffectiveLocalEcho,
    tmuxControllerErrors,
    setTmuxControllerErrors,
    tmuxControllerConfigsRef,
    tmuxWindowListsRef,
  };
}

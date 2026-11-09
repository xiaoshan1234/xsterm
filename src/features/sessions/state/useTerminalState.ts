import { useState, useRef, useCallback, useEffect } from "react";
import {
  type SavedTerminalConfig,
  type SavedWindowConfig,
  type SavedWorkspace,
  type Terminal,
  type TerminalGroup,
  type TmuxSessionConfig,
  type Workspace,
} from "../../../models/legacy/terminal";
import { type TerminalState, type TmuxControllerError } from "./types";

export function useTerminalState(): TerminalState {
  const [savedConfigs, setSavedConfigs] = useState<SavedTerminalConfig[]>([]);
  const [terminals, setSessions] = useState<Terminal[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
  const [savedWindowConfigs, setSavedWindowConfigs] = useState<SavedWindowConfig[]>([]);
  const [groups, setGroups] = useState<TerminalGroup[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);
  const [globalLocalEcho, setGlobalLocalEcho] = useState(false);
  const [sessionLocalEchoOverrides] = useState<Map<number, boolean>>(new Map());
  // one entry per tmux controller that has exited unexpectedly.
  // Kept separate from `terminals` so its lifecycle is not affected by the
  // `tmux-controller-exit` listener's `setSessions((prev) => prev.filter(...))`.
  const [tmuxControllerErrors, setTmuxControllerErrors] = useState<
    Map<number, TmuxControllerError>
  >(new Map());
  // `controllerId → config` map. Populated by the create / attach
  // tmux flows so the retry banner can hand the original config back to
  // `createTmux` / `attachTmux`. Survives pane teardown (which only removes
  // `terminals` entries, not the controller's persistent metadata).
  const tmuxControllerConfigsRef = useRef<Map<number, TmuxSessionConfig>>(new Map());
  // `controllerId` -> `configId` map. Populated by the attach flow so
  // event-driven tmux panes can be linked back to their saved config.
  const tmuxControllerConfigIdsRef = useRef<Map<number, string>>(new Map());
  // Controllers the user intentionally detached/closed. Used to suppress the
  // retry banner when the matching `tmux-controller-exit` arrives.
  const tmuxControllersClosingRef = useRef<Set<number>>(new Set());

  const terminalsRef = useRef(terminals);
  const workspacesRef = useRef(workspaces);
  const establishingSessionsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

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
    (terminalId: number) => {
      if (sessionLocalEchoOverrides.has(terminalId)) {
        return sessionLocalEchoOverrides.get(terminalId)!;
      }
      return globalLocalEcho;
    },
    [sessionLocalEchoOverrides, globalLocalEcho],
  );

  return {
    savedConfigs,
    setSavedConfigs,
    terminals,
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
    terminalsRef,
    workspacesRef,
    establishingSessionsRef,
    getEffectiveLocalEcho,
    tmuxControllerErrors,
    setTmuxControllerErrors,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    tmuxControllersClosingRef,
  };
}

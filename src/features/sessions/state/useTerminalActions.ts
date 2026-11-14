import { useCallback } from "react";
import { terminalCommands } from "../../terminal/infrastructure";
import { tmuxCommands } from "../../tmux/infrastructure";
import type {
  LocalTerminalConfig,
  SshConfig,
  Terminal,
  TmuxSessionConfig,
  Window,
  Workspace,
} from "../../../models/legacy/terminal";
import { createLeafPane, forEachPane, generateId, withRecomputedSessionIds } from "./paneUtils";
import {
  assertSessionNotUsedElsewhere,
  buildFrontendTerminal,
  dispatchByType,
  getUniqueWindowName,
} from "./useTerminalActions.helpers";
import { useGroupActions } from "./useGroupActions";
import { usePaneActions } from "./usePaneActions";
import { usePersistenceActions } from "./usePersistenceActions";
import { useTerminalLifecycle } from "./useTerminalLifecycle";
import { useWindowActions } from "./useWindowActions";
import { useWorkspaceActions } from "./useWorkspaceActions";
import type { SessionActions, SessionPersistence, TerminalState } from "./types";
import { findOpenTmuxControllerId, tmuxSessionKey } from "../../tmux/viewModels/sessionIdentity";

interface UseSessionActionsOptions extends TerminalState, SessionPersistence {}

/**
 * Composes the terminal action surface from six concern-focused hooks.
 * Each sub-hook owns one slice of the public `SessionActions` API; this entry
 * point only adds the small set of "shared primitives" that are consumed by
 * multiple concerns (terminal-from-config, window-from-terminal, workspace-from-terminal).
 */
export function useTerminalActions(opts: UseSessionActionsOptions): SessionActions {
  const {
    savedConfigs,
    terminalsRef,
    setSessions,
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    activeWorkspaceId,
    establishingSessionsRef,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    pendingTmuxSessionKeysRef,
    syncOpenTmuxSessions,
    setTmuxControllerErrors,
  } = opts;

  const focusTerminal = useCallback(
    (terminalId: number) => {
      let target: { workspaceId: string; windowId: string; paneId: string } | undefined;
      for (const workspace of workspacesRef.current) {
        for (const window of workspace.windows) {
          forEachPane(window.rootPane, (pane) => {
            if (!target && pane.type === "leaf" && pane.terminalId === terminalId) {
              target = {
                workspaceId: workspace.id,
                windowId: window.id,
                paneId: pane.id,
              };
            }
          });
          if (target) break;
        }
        if (target) break;
      }
      if (!target) return;

      setWorkspaces((previous) =>
        previous.map((workspace) =>
          workspace.id === target?.workspaceId
            ? {
                ...workspace,
                activeWindowId: target.windowId,
                windows: workspace.windows.map((window) =>
                  window.id === target?.windowId
                    ? { ...window, activePaneId: target.paneId }
                    : window,
                ),
              }
            : workspace,
        ),
      );
      setActiveWorkspaceId(target.workspaceId);
    },
    [setActiveWorkspaceId, setWorkspaces, workspacesRef],
  );

  const openFromConfigInternal = useCallback(
    async (configId: string): Promise<Terminal> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      if (config.type === "tmux-pane") {
        const tmuxConfig = config.config as TmuxSessionConfig;
        const openControllerId = findOpenTmuxControllerId(
          tmuxConfig,
          savedConfigs,
          tmuxControllerConfigIdsRef.current,
          tmuxControllerConfigsRef.current,
          terminalsRef.current,
        );
        if (openControllerId !== undefined) {
          const existing = terminalsRef.current.find(
            (terminal) => terminal.tmuxSessionId === openControllerId,
          );
          if (existing) {
            focusTerminal(existing.id);
            return existing;
          }
        }
        const sessionKey = tmuxSessionKey(tmuxConfig);
        if (pendingTmuxSessionKeysRef.current.has(sessionKey)) {
          throw new Error("This tmux session is already opening.");
        }
        pendingTmuxSessionKeysRef.current.add(sessionKey);
        // Attach is event-driven: `attach_tmux_session` emits the
        // `tmux-window-added` / `tmux-pane-added` events that create the
        // real windows and terminals. Return a representative Terminal for
        // the caller without adding it to state.
        try {
          const info = await tmuxCommands.attachTmuxSession(tmuxConfig);
          const terminal = buildFrontendTerminal(info, configId, "tmux-pane", config.displayConfig);
          if (terminal.tmuxSessionId !== undefined) {
            tmuxControllerConfigsRef.current.set(terminal.tmuxSessionId, tmuxConfig);
            tmuxControllerConfigIdsRef.current.set(terminal.tmuxSessionId, configId);
            syncOpenTmuxSessions();
            setSessions((previous) =>
              previous.map((session) =>
                session.tmuxSessionId === terminal.tmuxSessionId
                  ? { ...session, configId, displayConfig: config.displayConfig }
                  : session,
              ),
            );
          }
          return terminal;
        } finally {
          pendingTmuxSessionKeysRef.current.delete(sessionKey);
        }
      }

      const info = await dispatchByType(
        config.type,
        () =>
          terminalCommands.createLocalTerminal(
            config.config as LocalTerminalConfig,
            config.displayConfig?.logging,
          ),
        () =>
          terminalCommands.createSshTerminal(
            config.config as SshConfig,
            config.displayConfig?.logging,
          ),
        () => tmuxCommands.attachTmuxSession(config.config as TmuxSessionConfig),
      );
      const terminal = buildFrontendTerminal(info, configId, config.type, config.displayConfig);
      setSessions((prev) => [...prev, terminal]);
      return terminal;
    },
    [
      focusTerminal,
      savedConfigs,
      setSessions,
      terminalsRef,
      pendingTmuxSessionKeysRef,
      tmuxControllerConfigsRef,
      tmuxControllerConfigIdsRef,
      syncOpenTmuxSessions,
    ],
  );

  const createTerminalFromSavedConfig = useCallback(
    async (configId: string): Promise<Terminal> => openFromConfigInternal(configId),
    [openFromConfigInternal],
  );

  const createWindowFromSession = useCallback(
    (
      terminalId: number,
      configId: string,
      name?: string,
      targetWorkspaceIdParam?: string,
    ): Window => {
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, terminalId);
      const rootPane = createLeafPane(100, terminalId, configId);
      const baseName = name ?? "Window";
      const window: Window = {
        id: generateId(),
        name: baseName,
        rootPane,
        activePaneId: rootPane.id,
      };

      setWorkspaces((prev) => {
        const fallbackWorkspaceId = workspacesRef.current[0]?.id ?? prev[0]?.id ?? null;
        const targetWorkspaceId = targetWorkspaceIdParam ?? fallbackWorkspaceId;
        const workspaceExists = targetWorkspaceId && prev.some((w) => w.id === targetWorkspaceId);
        if (prev.length === 0 || !targetWorkspaceId || !workspaceExists) {
          const uniqueName = getUniqueWindowName(prev, "", baseName);
          const finalWindow: Window = { ...window, name: uniqueName };
          const workspace: Workspace = {
            id: generateId(),
            name: "default",
            windows: [finalWindow],
            activeWindowId: finalWindow.id,
            terminalIds: [terminalId],
          };
          setActiveWorkspaceId(workspace.id);
          return [workspace];
        }
        const uniqueName = getUniqueWindowName(prev, targetWorkspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return prev.map((workspace) =>
          workspace.id === targetWorkspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, finalWindow],
                activeWindowId: finalWindow.id,
              })
            : workspace,
        );
      });
      return window;
    },
    [setWorkspaces, setActiveWorkspaceId, workspacesRef],
  );

  const createWorkspaceFromSession = useCallback(
    (terminalId: number, configId: string, name?: string): Workspace => {
      const terminal = terminalsRef.current.find((s) => s.id === terminalId);
      const windowName = name ?? terminal?.name ?? "Window";
      const rootPane = createLeafPane(100, terminalId, configId);
      const window: Window = {
        id: generateId(),
        name: windowName,
        rootPane,
        activePaneId: rootPane.id,
      };
      const workspace: Workspace = {
        id: generateId(),
        name: name ?? terminal?.name ?? "Workspace",
        windows: [window],
        activeWindowId: window.id,
        terminalIds: [terminalId],
      };
      setWorkspaces((prev) => [...prev, workspace]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [terminalsRef, setWorkspaces, setActiveWorkspaceId],
  );

  const lifecycle = useTerminalLifecycle({
    ...opts,
    openFromConfigInternal,
    createWindowFromSession,
  });

  const pane = usePaneActions(opts);

  const windowActions = useWindowActions({
    savedConfigs,
    terminalsRef,
    workspacesRef,
    activeWorkspaceId,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
    createTerminalFromSavedConfig,
    createWindowFromSession,
  });

  const workspaceActions = useWorkspaceActions({
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSessions,
    establishingSessionsRef,
  });

  const persistence = usePersistenceActions({
    ...opts,
    openFromConfigInternal,
  });

  const group = useGroupActions(opts);

  const dismissTmuxControllerError = useCallback(
    (controllerId: number) => {
      setTmuxControllerErrors((prev) => {
        const next = new Map(prev);
        next.delete(controllerId);
        return next;
      });
    },
    [setTmuxControllerErrors],
  );

  return {
    createTerminalFromSavedConfig,
    createWindowFromSession,
    createWindowFromSavedConfig: windowActions.createWindowFromSavedConfig,
    createWorkspaceFromSession,
    ...lifecycle,
    ...pane,
    reportTerminalSize: opts.reportTerminalSize,
    createWindow: windowActions.createWindow,
    createInitWindow: windowActions.createInitWindow,
    replaceInitWindowWithTerminal: windowActions.replaceInitWindowWithTerminal,
    closeWindow: windowActions.closeWindow,
    setActiveWindow: windowActions.setActiveWindow,
    setActivePane: windowActions.setActivePane,
    reorderWindows: windowActions.reorderWindows,
    renameWindow: windowActions.renameWindow,
    createDefaultWorkspace: workspaceActions.createDefaultWorkspace,
    createEmptyWorkspace: workspaceActions.createEmptyWorkspace,
    setActiveWorkspace: workspaceActions.setActiveWorkspace,
    closeWorkspace: workspaceActions.closeWorkspace,
    ...persistence,
    ...group,
    applyDisplayConfigToLiveSession: lifecycle.applyDisplayConfigToLiveSession,
    dismissTmuxControllerError,
  };
}

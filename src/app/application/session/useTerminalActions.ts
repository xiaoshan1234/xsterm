import { useCallback } from "react";
import { terminalSessionActions } from "../../../features/terminal";
import { tmuxControllerActions, tmuxWindowActions } from "../../../features/tmux";
import type { LocalTerminalConfig, SshConfig, Terminal } from "../../../features/terminal";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import type { Window, Workspace } from "../../../features/workspace";
import {
  assertSessionNotUsedElsewhere,
  createLeafPane,
  forEachPane,
  generateId,
  getUniqueWindowName,
  withRecomputedSessionIds,
} from "../../../features/workspace";
import { usePersistenceActions } from "../../../features/workspace";
import { buildFrontendTerminal, dispatchByType } from "./useTerminalActions.helpers";
import { useGroupActions } from "../../../features/launch-config";
import { usePaneActions } from "./usePaneActions";
import { useTerminalStreamActions } from "./useTerminalStreamActions";
import { useTerminalLifecycle } from "./useTerminalLifecycle";
import type { SessionPersistence, SessionState } from "./types";
import { findOpenTmuxControllerId, tmuxSessionKey } from "../../../features/tmux";
import { useWindowActions } from "./useWindowActions";
import { useWorkspaceActions } from "./useWorkspaceActions";

interface UseSessionCoordinatorOptions {
  state: SessionState;
  persistence: SessionPersistence;
}

/**
 * Composes the session command surface from concern-focused hooks.
 * Each sub-hook owns one slice; this entry point only adds the shared
 * primitives consumed by multiple concerns.
 */
export function useTerminalActions({
  state,
  persistence: sessionPersistence,
}: UseSessionCoordinatorOptions) {
  const { savedConfigs, nextGroupId, setNextGroupId } = state.launchConfig;
  const { terminalsRef, setSessions, establishingSessionsRef, reportTerminalSize } = state.terminal;
  const {
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    activeWorkspaceId,
    savedWorkspaces,
    savedWindowConfigs,
    setSavedWorkspaces,
    setSavedWindowConfigs,
  } = state.workspace;
  const {
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    tmuxControllersClosingRef,
    pendingTmuxSessionKeysRef,
    syncOpenTmuxSessions,
    setTmuxControllerErrors,
  } = state.tmux;
  const { updateConfigs, updateGroups, persistSavedWorkspaces, persistSavedWindowConfigs } =
    sessionPersistence;

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
            (terminal) => terminal.tmux?.controllerId === openControllerId,
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
          const info = await tmuxControllerActions.attachSession(tmuxConfig);
          const terminal = buildFrontendTerminal(info, configId, "tmux-pane", config.displayConfig);
          const controllerId = terminal.tmux?.controllerId;
          if (controllerId !== undefined) {
            tmuxControllerConfigsRef.current.set(controllerId, tmuxConfig);
            tmuxControllerConfigIdsRef.current.set(controllerId, configId);
            syncOpenTmuxSessions();
            setSessions((previous) =>
              previous.map((session) =>
                session.tmux?.controllerId === controllerId
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
          terminalSessionActions.createLocal(
            config.config as LocalTerminalConfig,
            config.displayConfig?.logging,
          ),
        () =>
          terminalSessionActions.createSsh(
            config.config as SshConfig,
            config.displayConfig?.logging,
          ),
        () => tmuxControllerActions.attachSession(config.config as TmuxSessionConfig),
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
    savedConfigs,
    terminalsRef,
    setSessions,
    setWorkspaces,
    activeWorkspaceId,
    establishingSessionsRef,
    updateConfigs,
    updateGroups,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    syncOpenTmuxSessions,
    pendingTmuxSessionKeysRef,
    tmuxControllersClosingRef,
    openFromConfigInternal,
    createWindowFromSession,
  });

  const pane = usePaneActions({
    terminalsRef,
    workspacesRef,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
  });

  const terminalStream = useTerminalStreamActions({ setSessions });

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
    closeTerminal: terminalSessionActions.closeTerminal,
    killTmuxWindow: tmuxWindowActions.killWindow,
  });

  const workspaceActions = useWorkspaceActions({
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSessions,
    establishingSessionsRef,
    closeTerminal: terminalSessionActions.closeTerminal,
  });

  const workspacePersistence = usePersistenceActions({
    savedWorkspaces,
    savedWindowConfigs,
    workspacesRef,
    terminalsRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSavedWorkspaces,
    setSavedWindowConfigs,
    setSessions,
    establishingSessionsRef,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
    openFromConfigInternal,
    closeTerminal: terminalSessionActions.closeTerminal,
  });

  const group = useGroupActions({
    nextGroupId,
    setNextGroupId,
    updateConfigs,
    updateGroups,
  });

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
    ...terminalStream,
    reportTerminalSize,
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
    ...workspacePersistence,
    ...group,
    applyDisplayConfigToLiveSession: lifecycle.applyDisplayConfigToLiveSession,
    dismissTmuxControllerError,
  };
}

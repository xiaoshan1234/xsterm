import { useCallback } from "react";
import * as terminalService from "../../../../services/terminalService";
import type {
  LocalTerminalConfig,
  SshConfig,
  Terminal,
  TmuxSessionConfig,
  Window,
  Workspace,
} from "../../../../types/terminal";
import { createLeafPane, generateId, withRecomputedSessionIds } from "./paneUtils";
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
  } = opts;

  const openFromConfigInternal = useCallback(
    async (configId: string): Promise<Terminal> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      const info = await dispatchByType(
        config.type,
        () =>
          terminalService.createLocal(
            config.config as LocalTerminalConfig,
            config.displayConfig?.logging,
          ),
        () => terminalService.createSsh(config.config as SshConfig, config.displayConfig?.logging),
        () =>
          terminalService.createTmux(
            config.config as TmuxSessionConfig,
            config.displayConfig?.logging,
          ),
      );
      const terminal = buildFrontendTerminal(info, configId, config.type, config.displayConfig);
      setSessions((prev) => [...prev, terminal]);
      return terminal;
    },
    [savedConfigs, setSessions],
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
    [terminalsRef, setWorkspaces, setActiveWorkspaceId, workspacesRef],
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

  return {
    createTerminalFromSavedConfig,
    createWindowFromSession,
    createWindowFromSavedConfig: windowActions.createWindowFromSavedConfig,
    createWorkspaceFromSession,
    ...lifecycle,
    ...pane,
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
  };
}

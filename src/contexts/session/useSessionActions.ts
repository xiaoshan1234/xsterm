import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import type {
  LocalSessionConfig,
  SSHSessionConfig,
  Session,
  Window,
  Workspace,
} from "../../types/session";
import { createLeafPane, generateId, withRecomputedSessionIds } from "./paneUtils";
import {
  assertSessionNotUsedElsewhere,
  buildFrontendSession,
  dispatchByType,
  getUniqueWindowName,
} from "./useSessionActions.helpers";
import { useGroupActions } from "./useGroupActions";
import { usePaneActions } from "./usePaneActions";
import { usePersistenceActions } from "./usePersistenceActions";
import { useSessionLifecycle } from "./useSessionLifecycle";
import { useWindowActions } from "./useWindowActions";
import { useWorkspaceActions } from "./useWorkspaceActions";
import type { SessionActions, SessionPersistence, SessionState } from "./types";

interface UseSessionActionsOptions extends SessionState, SessionPersistence {}

/**
 * Composes the session action surface from six concern-focused hooks.
 * Each sub-hook owns one slice of the public `SessionActions` API; this entry
 * point only adds the small set of "shared primitives" that are consumed by
 * multiple concerns (session-from-config, window-from-session, workspace-from-session).
 */
export function useSessionActions(opts: UseSessionActionsOptions): SessionActions {
  const {
    savedConfigs,
    sessionsRef,
    setSessions,
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    activeWorkspaceId,
    establishingSessionsRef,
  } = opts;

  const openFromConfigInternal = useCallback(
    async (configId: string): Promise<Session> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      const info = await dispatchByType(
        config.type,
        () => sessionService.createLocal(config.config as LocalSessionConfig),
        () => sessionService.createSsh(config.config as SSHSessionConfig),
      );
      const session = buildFrontendSession(info, configId, config.type, config.displayConfig);
      setSessions((prev) => [...prev, session]);
      return session;
    },
    [savedConfigs, setSessions],
  );

  const createSessionFromSavedConfig = useCallback(
    async (configId: string): Promise<Session> => openFromConfigInternal(configId),
    [openFromConfigInternal],
  );

  const createWindowFromSession = useCallback(
    (
      sessionId: number,
      configId: string,
      name?: string,
      targetWorkspaceIdParam?: string,
    ): Window => {
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, sessionId);
      const rootPane = createLeafPane(100, sessionId, configId);
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
            sessionIds: [sessionId],
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
    [sessionsRef, setWorkspaces, setActiveWorkspaceId, workspacesRef],
  );

  const createWorkspaceFromSession = useCallback(
    (sessionId: number, configId: string, name?: string): Workspace => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const windowName = name ?? session?.name ?? "Window";
      const rootPane = createLeafPane(100, sessionId, configId);
      const window: Window = {
        id: generateId(),
        name: windowName,
        rootPane,
        activePaneId: rootPane.id,
      };
      const workspace: Workspace = {
        id: generateId(),
        name: name ?? session?.name ?? "Workspace",
        windows: [window],
        activeWindowId: window.id,
        sessionIds: [sessionId],
      };
      setWorkspaces((prev) => [...prev, workspace]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [sessionsRef, setWorkspaces, setActiveWorkspaceId],
  );

  const lifecycle = useSessionLifecycle({
    ...opts,
    openFromConfigInternal,
    createWindowFromSession,
  });

  const pane = usePaneActions(opts);

  const windowActions = useWindowActions({
    savedConfigs,
    sessionsRef,
    workspacesRef,
    activeWorkspaceId,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
    createSessionFromSavedConfig,
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
    createSessionFromSavedConfig,
    createWindowFromSession,
    createWindowFromSavedConfig: windowActions.createWindowFromSavedConfig,
    createWorkspaceFromSession,
    ...lifecycle,
    ...pane,
    createWindow: windowActions.createWindow,
    createInitWindow: windowActions.createInitWindow,
    replaceInitWindowWithSession: windowActions.replaceInitWindowWithSession,
    closeWindow: windowActions.closeWindow,
    setActiveWindow: windowActions.setActiveWindow,
    setActivePane: windowActions.setActivePane,
    reorderWindows: windowActions.reorderWindows,
    renameWindow: windowActions.renameWindow,
    createDefaultWorkspace: workspaceActions.createDefaultWorkspace,
    setActiveWorkspace: workspaceActions.setActiveWorkspace,
    closeWorkspace: workspaceActions.closeWorkspace,
    ...persistence,
    ...group,
  };
}

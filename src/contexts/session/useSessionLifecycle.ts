import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import type {
  LocalSessionConfig,
  SavedSessionConfig,
  Session,
  SessionDisplayConfig,
  SessionGroup,
  SSHSessionConfig,
  Window,
  Workspace,
} from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";
import {
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
  replaceSessionIdInPaneTree,
  withRecomputedSessionIds,
} from "./paneUtils";
import {
  assertSessionNotUsedElsewhere,
  buildFrontendSession,
  dispatchByType,
} from "./useSessionActions.helpers";

interface UseSessionLifecycleDeps {
  savedConfigs: SavedSessionConfig[];
  sessionsRef: React.MutableRefObject<Session[]>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  activeWorkspaceId: string | null;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  updateConfigs: (updater: (prev: SavedSessionConfig[]) => SavedSessionConfig[]) => void;
  updateGroups: (updater: (prev: SessionGroup[]) => SessionGroup[], nextId?: number) => void;
  openFromConfigInternal: (configId: string) => Promise<Session>;
  createWindowFromSession: (
    sessionId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
}

export function useSessionLifecycle(deps: UseSessionLifecycleDeps) {
  const {
    savedConfigs,
    sessionsRef,
    setSessions,
    setWorkspaces,
    activeWorkspaceId,
    establishingSessionsRef,
    updateConfigs,
    updateGroups,
    openFromConfigInternal,
    createWindowFromSession,
  } = deps;

  /**
   * Core internal method for creating and activating a session
   *
   * Full session creation flow:
   * 1. Generate configId (as unique identifier for the persistent config)
   * 2. Call backend sessionService to create the real session
   * 3. Construct the frontend Session object, add to sessions[]
   * 4. If save=true, persist the config to savedConfigs (survives restarts)
   * 5. Automatically call createWindowFromSession to create a default workspace
   */
  const createAndActivateSession = useCallback(
    async (
      type: Session["type"],
      create: () => Promise<sessionService.SessionInfo>,
      config: LocalSessionConfig | SSHSessionConfig,
      save: boolean,
      skipAutoWindow = false,
      displayConfig?: SessionDisplayConfig,
    ): Promise<Session> => {
      const configId = crypto.randomUUID();
      const info = await create();
      const session = buildFrontendSession(info, configId, type, displayConfig);

      setSessions((prev) => [...prev, session]);

      if (save) {
        let savedConfig: SavedSessionConfig;
        if (type === "local") {
          const localConfig = config as LocalSessionConfig;
          savedConfig = {
            id: configId,
            name: info.name,
            version: 1,
            type: "local",
            config: localConfig,
            displayConfig,
          };
        } else {
          const sshConfig = config as SSHSessionConfig;
          savedConfig = {
            id: configId,
            name: info.name,
            version: 1,
            type: "ssh",
            config: sshConfig,
            displayConfig,
          };
        }
        updateConfigs((prev) => [...prev, savedConfig]);
      }

      if (!skipAutoWindow) {
        createWindowFromSession(
          session.id,
          session.configId,
          session.name,
          activeWorkspaceId ?? undefined,
        );
      }
      return session;
    },
    [updateConfigs, createWindowFromSession, setSessions, activeWorkspaceId],
  );

  /**
   * Create a local session and automatically create a workspace
   *
   * Call chain: createLocalSession → createAndActivateSession("local", ...)
   *  → backend sessionService.createLocal(config) → sessions[] + auto-create workspace
   */
  const createLocalSession = useCallback(
    async (
      config: LocalSessionConfig,
      save = true,
      displayConfig?: SessionDisplayConfig,
    ): Promise<Session> => {
      return createAndActivateSession(
        "local",
        () => sessionService.createLocal(config),
        config,
        save,
        false,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * Create an SSH session and automatically create a workspace
   *
   * Call chain: createSshSession → createAndActivateSession("ssh", ...)
   *  → backend sessionService.createSsh(config) → sessions[] + auto-create workspace
   */
  const createSshSession = useCallback(
    async (
      config: SSHSessionConfig,
      save = true,
      displayConfig?: SessionDisplayConfig,
    ): Promise<Session> => {
      return createAndActivateSession(
        "ssh",
        () => sessionService.createSsh(config),
        config,
        save,
        false,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  const createLocalSessionOnly = useCallback(
    async (
      config: LocalSessionConfig,
      save = true,
      displayConfig?: SessionDisplayConfig,
    ): Promise<Session> => {
      return createAndActivateSession(
        "local",
        () => sessionService.createLocal(config),
        config,
        save,
        true,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  const createSshSessionOnly = useCallback(
    async (
      config: SSHSessionConfig,
      save = true,
      displayConfig?: SessionDisplayConfig,
    ): Promise<Session> => {
      return createAndActivateSession(
        "ssh",
        () => sessionService.createSsh(config),
        config,
        save,
        true,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * Open a session from a saved config (also creates a default workspace)
   *
   * Difference from createSessionFromSavedConfig: this method additionally calls createWindowFromSession,
   * used for the sidebar "open" operation, which also displays the session UI
   */
  const openFromConfig = useCallback(
    async (configId: string): Promise<Session> => {
      const session = await openFromConfigInternal(configId);
      createWindowFromSession(session.id, session.name, activeWorkspaceId ?? undefined);
      return session;
    },
    [openFromConfigInternal, createWindowFromSession, activeWorkspaceId],
  );

  const removeConfig = useCallback(
    (configId: string) => {
      updateConfigs((prev) => prev.filter((c) => c.id !== configId));
      updateGroups((prev) =>
        prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })),
      );
      const session = sessionsRef.current.find((s) => s.configId === configId);
      if (session) {
        sessionService.closeSession(session.id).catch(console.error);
        clearSessionOutput(session.id);
        setSessions((prev) => prev.filter((s) => s.configId !== configId));
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, session.id);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            }),
          ),
        );
      }
    },
    [updateConfigs, updateGroups, sessionsRef, setSessions, setWorkspaces],
  );

  /**
   * Close a session
   *
   * Session close flow:
   * 1. Call backend sessionService.closeSession(id) to close the real session
   * 2. Remove the session from sessions[]
   * 3. Remove panes corresponding to this session in all workspaces (removeSessionAndCollapse), and automatically switch active pane
   *
   * Note: savedConfigs are not automatically deleted (config is preserved, user can reopen)
   */
  const closeSession = useCallback(
    async (id: number): Promise<void> => {
      try {
        await sessionService.closeSession(id);
      } catch (e) {
        console.error("Failed to close session backend:", e);
      } finally {
        clearSessionOutput(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, id);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            }),
          ),
        );
      }
    },
    [setSessions, setWorkspaces],
  );

  const reconnectSession = useCallback(
    async (id: number): Promise<Session> => {
      const oldSession = sessionsRef.current.find((s) => s.id === id);
      if (!oldSession) throw new Error("Session not found");
      if (oldSession.capabilities && !oldSession.capabilities.supportsReconnect) {
        throw new Error("Reconnect not supported for this transport");
      }

      const config = savedConfigs.find((c) => c.id === oldSession.configId);
      if (!config) throw new Error("Saved config not found for session");

      const info = await dispatchByType(
        config.type,
        () => sessionService.createLocal(config.config as LocalSessionConfig),
        () => sessionService.createSsh(config.config as SSHSessionConfig),
      );
      const type: Session["type"] = config.type;

      const newSession = buildFrontendSession(
        info,
        oldSession.configId,
        type,
        config.displayConfig,
      );
      setSessions((prev) => [...prev, newSession]);

      setWorkspaces((prev) =>
        prev.map((workspace) =>
          withRecomputedSessionIds({
            ...workspace,
            windows: workspace.windows.map((window) => ({
              ...window,
              rootPane: replaceSessionIdInPaneTree(window.rootPane, id, newSession.id),
            })),
          }),
        ),
      );

      establishingSessionsRef.current.delete(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));

      try {
        await sessionService.closeSession(id);
      } catch (e) {
        console.error("Failed to close old session backend during reconnect:", e);
      } finally {
        clearSessionOutput(id);
      }

      return newSession;
    },
    [savedConfigs, sessionsRef, setSessions, setWorkspaces, establishingSessionsRef],
  );

  // NOTE: renameSession also lives here because it touches both sessions[] and savedConfigs.
  // It is grouped with lifecycle because it operates on the persisted config too.
  const renameSession = useCallback(
    (id: number, name: string) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
      const session = sessionsRef.current.find((s) => s.id === id);
      if (session) {
        updateConfigs((prev) => prev.map((c) => (c.id === session.configId ? { ...c, name } : c)));
      }
    },
    [updateConfigs, sessionsRef, setSessions],
  );

  return {
    createLocalSession,
    createSshSession,
    createLocalSessionOnly,
    createSshSessionOnly,
    openFromConfig,
    removeConfig,
    closeSession,
    reconnectSession,
    renameSession,
  };
}

export { assertSessionNotUsedElsewhere };

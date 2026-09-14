import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import { logger } from "../../contexts/LoggerContext";
import type {
  LocalSessionConfig,
  SavedSessionConfig,
  Session,
  SessionDisplayConfig,
  SessionGroup,
  SSHSessionConfig,
  TmuxCcConfig,
  Window,
  Workspace,
} from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";
import {
  createLeafPane,
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
  /**
   * Spawn a brand-new workspace wrapping the session's window. tmux-cc
   * sessions ALWAYS route through this so that one tmux session maps to
   * exactly one xsterm workspace (mirrors `TmuxForm.helperText`:
   * "one tmux session always maps to one xsterm workspace"). Local / SSH
   * continue to route through `createWindowFromSession` so they share the
   * active workspace as before.
   */
  createWorkspaceFromSession: (
    sessionId: number,
    configId: string,
    name?: string,
  ) => Workspace;
  createDefaultWorkspace: () => Workspace;
  /** persistent map keyed by controller id so the retry banner
   * can hand the original config back to the backend after a
   * `tmux-controller-exit`. */
  tmuxControllerConfigsRef?: React.MutableRefObject<Map<number, import("../../types/session").TmuxCcConfig>>;
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
    createDefaultWorkspace,
    tmuxControllerConfigsRef,
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
      config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig,
      save: boolean,
      skipAutoWindow = false,
      displayConfig?: SessionDisplayConfig,
    ): Promise<Session> => {
      const configId = crypto.randomUUID();
      const info = await create();
      const session = buildFrontendSession(info, configId, type, displayConfig);

      // stash the tmux-cc config so a future retry banner can
      // re-call the backend with the same args. We do this AFTER the
      // backend call so the controllerId is known (the backend assigns
      // it; we don't get it from the frontend).
      if (type === "tmux-cc" && tmuxControllerConfigsRef && session.tmuxControllerId !== undefined) {
        tmuxControllerConfigsRef.current.set(
          session.tmuxControllerId,
          config as TmuxCcConfig,
        );
      }

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
        } else if (type === "ssh") {
          const sshConfig = config as SSHSessionConfig;
          savedConfig = {
            id: configId,
            name: info.name,
            version: 1,
            type: "ssh",
            config: sshConfig,
            displayConfig,
          };
        } else {
          // tmux-cc saved config persists TmuxCcConfig verbatim.
          // Migration in services/sessionStorage.ts recognises type "tmux-cc".
          const tmuxConfig = config as TmuxCcConfig;
          savedConfig = {
            id: configId,
            name: info.name,
            version: 1,
            type: "tmux-cc",
            config: tmuxConfig,
            displayConfig,
          };
        }
        updateConfigs((prev) => [...prev, savedConfig]);
      }

      if (!skipAutoWindow) {
              if (type === "tmux-cc") {
                // ADR 0009 §2.7: synchronously install the control-window +
                // bootstrap pane's xsterm Window. The bootstrap tmux
                // window does NOT emit `%window-add`, so the
                // `tmux-window-added` listener never fires for it.
                insertTmuxControlAndBootstrapWindow(
                  session,
                  tmuxControllerConfigsRef?.current.get(session.tmuxControllerId ?? -1)?.tmuxSessionName,
                  activeWorkspaceId,
                  setWorkspaces,
                  createDefaultWorkspace,
                );
              } else {
                createWindowFromSession(
                  session.id,
                  session.configId,
                  session.name,
                  activeWorkspaceId ?? undefined,
                );
              }
            }
            return session;
          },
          [
            updateConfigs,
            createWindowFromSession,
            setWorkspaces,
            activeWorkspaceId,
            createDefaultWorkspace,
            tmuxControllerConfigsRef,
          ],
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
   * create a local tmux control-mode session and a default workspace.
   *
   * Call chain: createTmuxSession → createAndActivateSession("tmux-cc", ...)
   * → probe_tmux_session_exists (optional) → backend sessionService.createTmux
   * or attachTmux → sessions[] + auto-create window.
   *
   * When the server already has a session with the same
   * `tmuxSessionName`, the controller's `new-window` shortcut (which
   * it only takes on a fresh session) would otherwise be wasted and
   * the user would see a phantom empty window on top of their
   * existing panes. So we probe first and re-route to
   * `attach_tmux_session` when the session exists. The probe is
   * local-only (SSH falls through to the previous behaviour).
   */
  const createTmuxSession = useCallback(
      async (
        config: TmuxCcConfig,
        save = true,
        displayConfig?: SessionDisplayConfig,
      ): Promise<Session> => {
        return createAndActivateSession(
        "tmux-cc",
        async () => {
          let alreadyExists = false;
          try {
            alreadyExists = await sessionService.probeTmuxSessionExists(
              config,
            );
          } catch (err) {
            // Probe is best-effort. If it fails (SSH, transport
            // error, command-not-found), fall through to the create
            // path — same behaviour as before this PR.
            const reason = err instanceof Error ? err.message : String(err);
            logger.warn(
              "useSessionLifecycle",
              "probe_tmux_session_exists failed; falling back to createTmux",
              reason,
            );
          }
          if (alreadyExists) {
            return await sessionService.attachTmux(config);
          }
          return await sessionService.createTmux(config);
        },
        config,
        save,
        false,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * create a tmux session without auto-creating a default window.
   * Used by the PaneInitCard / Split flows where the consumer attaches the
   * resulting session to an existing pane.
   */
  const createTmuxSessionOnly = useCallback(
    async (
      config: TmuxCcConfig,
      save = true,
      displayConfig?: SessionDisplayConfig,
    ): Promise<Session> => {
      return createAndActivateSession(
        "tmux-cc",
        () => sessionService.createTmux(config),
        config,
        save,
        true,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * Persist a session configuration WITHOUT creating a backend session
   * or auto-opening a window.
   *
   * Used by the Create Session dialog's "Save Only" button — the user
   * configures the form fields but does not want a live session yet;
   * the config is parked in `savedConfigs` so it can be opened later
   * via the Session Manager sidebar.
   *
   * Differs from `createXxxSession`: no `create_session` IPC call, no
   * `setSessions`, no `createWindowFromSession`. Only `updateConfigs`
   * runs, mirroring the `save === true` branch of `createAndActivateSession`.
   *
   * The caller is responsible for SSH/tmux-over-SSH validation
   * (matching `createAndActivateSession`'s expectations) before calling
   * this method — saving an invalid SSH config would block a future
   * "Open" via `createSessionFromSavedConfig`.
   *
   * Display config is persisted as-is so the saved entry round-trips
   * through `createSessionFromSavedConfig` exactly like a config saved
   * via the Create button.
   */
  const saveConfigOnly = useCallback(
    (
      type: Session["type"],
      config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig,
      displayConfig?: SessionDisplayConfig,
    ): SavedSessionConfig => {
      const configId = crypto.randomUUID();
      // Fallback name mirrors `create_session`'s defaults so sidebar labels stay consistent.
      const configName = config.name?.trim();
      const idAndVersion = { id: configId, version: 1 } as const;

      let savedConfig: SavedSessionConfig;
      if (type === "local") {
        const localConfig = config as LocalSessionConfig;
        savedConfig = {
          ...idAndVersion,
          name: configName || "Local",
          type: "local",
          config: localConfig,
          displayConfig,
        };
      } else if (type === "ssh") {
        const sshConfig = config as SSHSessionConfig;
        const user = sshConfig.username?.trim() || "user";
        const host = sshConfig.host?.trim() || "host";
        savedConfig = {
          ...idAndVersion,
          name: configName || `${user}@${host}`,
          type: "ssh",
          config: sshConfig,
          displayConfig,
        };
      } else {
        const tmuxConfig = config as TmuxCcConfig;
        savedConfig = {
          ...idAndVersion,
          name: configName || tmuxConfig.tmuxSessionName?.trim() || "Tmux",
          type: "tmux-cc",
          config: tmuxConfig,
          displayConfig,
        };
      }

      updateConfigs((prev) => [...prev, savedConfig]);
      return savedConfig;
    },
    [updateConfigs],
  );

  /**
   * Open a session from a saved config (also creates a default workspace)
   *
   * Difference from createSessionFromSavedConfig: this method additionally calls createWindowFromSession,
   * used for the sidebar "open" operation, which also displays the session UI.
   *
   * tmux-cc configs no longer route through `createWorkspaceFromSession`
   * (ADR 0009 §2.7). The tmux-window-added / tmux-window-list listeners
   * install the control-window + ordinary tmux-windows into the active
   * workspace — same path as the create flow above.
   */
  const openFromConfig = useCallback(
    async (configId: string): Promise<Session> => {
      const session = await openFromConfigInternal(configId);
      if (session.type !== "tmux-cc") {
        createWindowFromSession(
          session.id,
          session.configId,
          session.name,
          activeWorkspaceId ?? undefined,
        );
      }
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
        () => sessionService.createTmux(config.config as TmuxCcConfig),
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

  /**
   * Merge a `displayConfig` patch into a running session's in-memory state
   * so the new values (e.g. `sizingMode`, `cols`, `rows`) propagate via
   * React to Terminal → `useTerminalResize` and apply without restart.
   *
   * Persistence is the caller's responsibility — callers should
   * `updateConfig(...)` first so the saved config and the running session
   * stay in sync.
   */
  const applyDisplayConfigToLiveSession = useCallback(
    (id: number, patch: Partial<SessionDisplayConfig>) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, displayConfig: { ...(s.displayConfig ?? {}), ...patch } }
            : s,
        ),
      );
    },
    [setSessions],
  );

  return {
    createLocalSession,
    createSshSession,
    createLocalSessionOnly,
    createSshSessionOnly,
    createTmuxSession,
    createTmuxSessionOnly,
    saveConfigOnly,
    openFromConfig,
    removeConfig,
    closeSession,
    reconnectSession,
    renameSession,
    applyDisplayConfigToLiveSession,
  };
}

export { assertSessionNotUsedElsewhere };

/**
 * Synchronously install the `tmux-control` Window + the bootstrap
 * pane's xsterm Window into the active workspace (creating the
 * workspace on demand when none exists). Mirrors the shape the
 * `tmux-window-added` listener builds, but runs at
 * `create_tmux_session` / `attach_tmux_session` return time so the
 * user sees tabs immediately. Subsequent `tmux-window-added` events
 * for OTHER windows on the controller are still emitted by the
 * dispatch task and remain idempotent via the `xstermWindowId`
 * dedupe check.
 *
 * When `session.xstermWindowId` is `undefined` (test fixtures, or a
 * controller race during the bootstrap `list-windows` reply), only
 * the control-window is installed; the pane's xsterm Window will
 * arrive from the `tmux-window-added` listener when it eventually
  * fires.
  */
 export function insertTmuxControlAndBootstrapWindow(
   session: Session,
   tmuxSessionName: string | undefined,
   activeWorkspaceId: string | null,
   setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>,
   createDefaultWorkspace: () => Workspace,
 ): void {
  if (session.type !== "tmux-cc" || session.tmuxControllerId === undefined) {
    return;
  }
  const controllerId = session.tmuxControllerId;
  const tmuxName = tmuxSessionName ?? `tmux-${controllerId}`;
  const rootPane = createLeafPane(100, session.id, session.configId);

  setWorkspaces((prev) => {
      let workspaces = prev;
      let targetId = activeWorkspaceId ?? workspaces[0]?.id ?? null;
    if (!targetId || !workspaces.some((w) => w.id === targetId)) {
      const fresh = createDefaultWorkspace();
      targetId = fresh.id;
      workspaces = [...workspaces, fresh];
    }
    const target = workspaces.find((w) => w.id === targetId);
    if (!target) return workspaces;
    const hasControlWindow = target.windows.some(
      (w) => w.windowType === "tmux-control" && w.tmuxControlWindowId === controllerId,
    );
    // Dedupe against the listener: if the async `tmux-window-added`
    // for this bootstrap window already landed (race between the
    // backend return and this setter), skip the insert.
    if (
      session.xstermWindowId !== undefined &&
      target.windows.some((w) => w.xstermWindowId === session.xstermWindowId)
    ) {
      return workspaces;
    }
    const controlWindow: Window = {
      id: crypto.randomUUID(),
      name: tmuxName,
      rootPane: {
        id: crypto.randomUUID(),
        type: "leaf",
        size: 100,
      },
      activePaneId: null,
      windowType: "tmux-control",
      tmuxControlWindowId: controllerId,
      tmuxControlName: tmuxName,
    };
    const bootstrapWindow: Window = {
      id: crypto.randomUUID(),
      name: tmuxName,
      rootPane,
      activePaneId: rootPane.id,
      windowType: "terminal",
      ...(session.xstermWindowId !== undefined
        ? { xstermWindowId: session.xstermWindowId }
        : {}),
    };
    const baseWindows = hasControlWindow ? target.windows : [controlWindow, ...target.windows];
    return workspaces.map((workspace) =>
      workspace.id === targetId
        ? withRecomputedSessionIds({
            ...workspace,
            windows: [...baseWindows, bootstrapWindow],
            activeWindowId: bootstrapWindow.id,
          })
        : workspace,
    );
  });
}

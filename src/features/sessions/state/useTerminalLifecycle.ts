import { useCallback } from "react";
import * as terminalService from "../../../services/terminalService";
import type {
  LocalTerminalConfig,
  SavedTerminalConfig,
  Terminal,
  TerminalDisplayConfig,
  TerminalGroup,
  SshConfig,
  TmuxSessionConfig,
  Window,
  Workspace,
} from "../../../types/terminal";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";
import {
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
  replaceSessionIdInPaneTree,
  withRecomputedSessionIds,
} from "./paneUtils";
import {
  assertSessionNotUsedElsewhere,
  buildFrontendTerminal,
  dispatchByType,
} from "./useTerminalActions.helpers";

interface UseSessionLifecycleDeps {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  activeWorkspaceId: string | null;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
  createWindowFromSession: (
    terminalId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
  /** persistent map keyed by controller id so the retry banner
   * can hand the original config back to the backend after a
   * `tmux-controller-exit`. */
  tmuxControllerConfigsRef?: React.MutableRefObject<Map<number, TmuxSessionConfig>>;
}

export function useTerminalLifecycle(deps: UseSessionLifecycleDeps) {
  const {
    savedConfigs,
    terminalsRef,
    setSessions,
    setWorkspaces,
    activeWorkspaceId,
    establishingSessionsRef,
    updateConfigs,
    updateGroups,
    openFromConfigInternal,
    createWindowFromSession,
    tmuxControllerConfigsRef,
  } = deps;

  /**
   * Core internal method for creating and activating a terminal
   *
   * Full terminal creation flow:
   * 1. Generate configId (as unique identifier for the persistent config)
   * 2. Call backend terminalService to create the real terminal
   * 3. Construct the frontend Terminal object, add to terminals[]
   * 4. If save=true, persist the config to savedConfigs (survives restarts)
   * 5. Automatically call createWindowFromSession to create a default workspace
   */
  const createAndActivateSession = useCallback(
    async (
      type: Terminal["type"],
      create: () => Promise<terminalService.TerminalInfo>,
      config: LocalTerminalConfig | SshConfig | TmuxSessionConfig,
      save: boolean,
      skipAutoWindow = false,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      const configId = crypto.randomUUID();
      const info = await create();
      const terminal = buildFrontendTerminal(info, configId, type, displayConfig);

      // stash the tmux-pane config so a future retry banner can
      // re-call the backend with the same args. We do this AFTER the
      // backend call so the controllerId is known (the backend assigns
      // it; we don't get it from the frontend).
      if (
        type === "tmux-pane" &&
        tmuxControllerConfigsRef &&
        terminal.tmuxSessionId !== undefined
      ) {
        tmuxControllerConfigsRef.current.set(terminal.tmuxSessionId, config as TmuxSessionConfig);
      }

      setSessions((prev) => [...prev, terminal]);

      if (save) {
        let savedConfig: SavedTerminalConfig;
        if (type === "local") {
          const localConfig = config as LocalTerminalConfig;
          savedConfig = {
            id: configId,
            name: info.name,
            version: 1,
            type: "local",
            config: localConfig,
            displayConfig,
          };
        } else if (type === "ssh") {
          const sshConfig = config as SshConfig;
          savedConfig = {
            id: configId,
            name: info.name,
            version: 1,
            type: "ssh",
            config: sshConfig,
            displayConfig,
          };
        } else {
          // tmux-pane saved config persists TmuxSessionConfig verbatim.
          // Migration in services/terminalStorage.ts recognises type "tmux-pane".
          const tmuxConfig = config as TmuxSessionConfig;
          savedConfig = {
            id: configId,
            name: info.name,
            version: 1,
            type: "tmux-pane",
            config: tmuxConfig,
            displayConfig,
          };
        }
        updateConfigs((prev) => [...prev, savedConfig]);
      }

      if (!skipAutoWindow) {
        createWindowFromSession(
          terminal.id,
          terminal.configId,
          terminal.name,
          activeWorkspaceId ?? undefined,
        );
      }
      return terminal;
    },
    [updateConfigs, createWindowFromSession, setSessions, activeWorkspaceId],
  );

  /**
   * Create a local terminal and automatically create a workspace
   *
   * Call chain: createLocalSession → createAndActivateSession("local", ...)
   *  → backend terminalService.createLocal(config) → terminals[] + auto-create workspace
   */
  const createLocalSession = useCallback(
    async (
      config: LocalTerminalConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      return createAndActivateSession(
        "local",
        () => terminalService.createLocal(config, displayConfig?.logging),
        config,
        save,
        false,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * Create an SSH terminal and automatically create a workspace
   *
   * Call chain: createSshSession → createAndActivateSession("ssh", ...)
   *  → backend terminalService.createSsh(config) → terminals[] + auto-create workspace
   */
  const createSshSession = useCallback(
    async (
      config: SshConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      return createAndActivateSession(
        "ssh",
        () => terminalService.createSsh(config, displayConfig?.logging),
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
      config: LocalTerminalConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      return createAndActivateSession(
        "local",
        () => terminalService.createLocal(config, displayConfig?.logging),
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
      config: SshConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      return createAndActivateSession(
        "ssh",
        () => terminalService.createSsh(config, displayConfig?.logging),
        config,
        save,
        true,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * create a local tmux control-mode terminal and a default workspace.
   *
   * Call chain: createTmuxSession → createAndActivateSession("tmux-pane", ...)
   * → backend terminalService.createTmux(config) → terminals[] + auto-create window.
   */
  const createTmuxSession = useCallback(
    async (
      config: TmuxSessionConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      return createAndActivateSession(
        "tmux-pane",
        () => terminalService.createTmux(config, displayConfig?.logging),
        config,
        save,
        false,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * create a tmux terminal without auto-creating a default window.
   * Used by the PaneInitCard / Split flows where the consumer attaches the
   * resulting terminal to an existing pane.
   */
  const createTmuxSessionOnly = useCallback(
    async (
      config: TmuxSessionConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      return createAndActivateSession(
        "tmux-pane",
        () => terminalService.createTmux(config, displayConfig?.logging),
        config,
        save,
        true,
        displayConfig,
      );
    },
    [createAndActivateSession],
  );

  /**
   * Persist a terminal configuration WITHOUT creating a backend terminal
   * or auto-opening a window.
   *
   * Used by the Create Terminal dialog's "Save Only" button — the user
   * configures the form fields but does not want a live terminal yet;
   * the config is parked in `savedConfigs` so it can be opened later
   * via the Terminal Manager sidebar.
   *
   * Differs from `createXxxSession`: no `create_session` IPC call, no
   * `setSessions`, no `createWindowFromSession`. Only `updateConfigs`
   * runs, mirroring the `save === true` branch of `createAndActivateSession`.
   *
   * The caller is responsible for SSH/tmux-over-SSH validation
   * (matching `createAndActivateSession`'s expectations) before calling
   * this method — saving an invalid SSH config would block a future
   * "Open" via `createTerminalFromSavedConfig`.
   *
   * Display config is persisted as-is so the saved entry round-trips
   * through `createTerminalFromSavedConfig` exactly like a config saved
   * via the Create button.
   */
  const saveConfigOnly = useCallback(
    (
      type: Terminal["type"],
      config: LocalTerminalConfig | SshConfig | TmuxSessionConfig,
      displayConfig?: TerminalDisplayConfig,
    ): SavedTerminalConfig => {
      const configId = crypto.randomUUID();
      // Fallback name mirrors `create_session`'s defaults so sidebar labels stay consistent.
      const configName = config.name?.trim();
      const idAndVersion = { id: configId, version: 1 } as const;

      let savedConfig: SavedTerminalConfig;
      if (type === "local") {
        const localConfig = config as LocalTerminalConfig;
        savedConfig = {
          ...idAndVersion,
          name: configName || "Local",
          type: "local",
          config: localConfig,
          displayConfig,
        };
      } else if (type === "ssh") {
        const sshConfig = config as SshConfig;
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
        const tmuxConfig = config as TmuxSessionConfig;
        savedConfig = {
          ...idAndVersion,
          name: configName || tmuxConfig.tmuxSessionName?.trim() || "Tmux",
          type: "tmux-pane",
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
   * Open a terminal from a saved config (also creates a default workspace)
   *
   * Difference from createTerminalFromSavedConfig: this method additionally calls createWindowFromSession,
   * used for the sidebar "open" operation, which also displays the terminal UI
   */
  const openFromConfig = useCallback(
    async (configId: string): Promise<Terminal> => {
      const terminal = await openFromConfigInternal(configId);
      createWindowFromSession(terminal.id, terminal.name, activeWorkspaceId ?? undefined);
      return terminal;
    },
    [openFromConfigInternal, createWindowFromSession, activeWorkspaceId],
  );

  const removeConfig = useCallback(
    (configId: string) => {
      updateConfigs((prev) => prev.filter((c) => c.id !== configId));
      updateGroups((prev) =>
        prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })),
      );
      const terminal = terminalsRef.current.find((s) => s.configId === configId);
      if (terminal) {
        terminalService.closeTerminal(terminal.id).catch(console.error);
        clearTerminalOutput(terminal.id);
        setSessions((prev) => prev.filter((s) => s.configId !== configId));
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, terminal.id);
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
    [updateConfigs, updateGroups, terminalsRef, setSessions, setWorkspaces],
  );

  /**
   * Close a terminal
   *
   * Terminal close flow:
   * 1. Call backend terminalService.closeTerminal(id) to close the real terminal
   * 2. Remove the terminal from terminals[]
   * 3. Remove panes corresponding to this terminal in all workspaces (removeSessionAndCollapse), and automatically switch active pane
   *
   * Note: savedConfigs are not automatically deleted (config is preserved, user can reopen)
   */
  const closeTerminal = useCallback(
    async (id: number): Promise<void> => {
      try {
        await terminalService.closeTerminal(id);
      } catch (e) {
        console.error("Failed to close terminal backend:", e);
      } finally {
        clearTerminalOutput(id);
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
    async (id: number): Promise<Terminal> => {
      const oldSession = terminalsRef.current.find((s) => s.id === id);
      if (!oldSession) throw new Error("Terminal not found");
      if (oldSession.capabilities && !oldSession.capabilities.supportsReconnect) {
        throw new Error("Reconnect not supported for this transport");
      }

      const config = savedConfigs.find((c) => c.id === oldSession.configId);
      if (!config) throw new Error("Saved config not found for terminal");

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
      const type: Terminal["type"] = config.type;

      const newSession = buildFrontendTerminal(
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
        await terminalService.closeTerminal(id);
      } catch (e) {
        console.error("Failed to close old terminal backend during reconnect:", e);
      } finally {
        clearTerminalOutput(id);
      }

      return newSession;
    },
    [savedConfigs, terminalsRef, setSessions, setWorkspaces, establishingSessionsRef],
  );

  // NOTE: renameSession also lives here because it touches both terminals[] and savedConfigs.
  // It is grouped with lifecycle because it operates on the persisted config too.
  const renameSession = useCallback(
    (id: number, name: string) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
      const terminal = terminalsRef.current.find((s) => s.id === id);
      if (terminal) {
        updateConfigs((prev) => prev.map((c) => (c.id === terminal.configId ? { ...c, name } : c)));
      }
    },
    [updateConfigs, terminalsRef, setSessions],
  );

  /**
   * Merge a `displayConfig` patch into a running terminal's in-memory state
   * so the new values (e.g. `sizingMode`, `cols`, `rows`) propagate via
   * React to Terminal → `useTerminalResize` and apply without restart.
   *
   * Persistence is the caller's responsibility — callers should
   * `updateConfig(...)` first so the saved config and the running terminal
   * stay in sync.
   */
  const applyDisplayConfigToLiveSession = useCallback(
    (id: number, patch: Partial<TerminalDisplayConfig>) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, displayConfig: { ...(s.displayConfig ?? {}), ...patch } } : s,
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
    closeTerminal,
    reconnectSession,
    renameSession,
    applyDisplayConfigToLiveSession,
  };
}

export { assertSessionNotUsedElsewhere };

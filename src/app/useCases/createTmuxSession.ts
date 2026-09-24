/**
 * createTmuxSession — create a tmux control-mode session and install
 * the full initial state into the active workspace in **one round-trip**.
 *
 * Routing: when the server already has a session with the same
 * `tmuxSessionName`, route through `attachTmux` instead of `createTmux`
 * to avoid leaving a phantom empty window on top of existing panes.
 *
 * The backend's new IA returns a [`TmuxSessionInit`](../../infra/tauri/commands/tmux.ts)
 * (session + n windows + m panes + 1 control window). This function
 * creates 1:1 React store entries for every Window and Session the
 * backend reports — no async `tmux-window-list` / `tmux-pane-list`
 * events are needed for the initial state.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { logger } from "../../infra/logger/logger";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../app/rules/sessionRules";
import { generateId } from "../../app/rules/paneTree";
import type {
  PaneNode,
  PersistedSessionConfig,
  Session,
  SessionDisplayConfig,
  TmuxCcConfig,
  Window,
} from "../../model";

export async function createTmuxSession(
  config: TmuxCcConfig,
  save: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const t0 = Date.now();
  const configId = generateId();
  logger.debug("createTmuxSession", "entry", {
    configId,
    tmuxSessionName: config.tmuxSessionName ?? null,
    ssh: config.ssh ? "ssh" : "local",
    save,
    hasDisplayConfig: displayConfig !== undefined,
  });

  let init: Awaited<ReturnType<typeof tmuxTauri.createTmux>>;
  let branch: "attach" | "create" = "create";

  try {
    const exists = await tmuxTauri.probeTmuxSessionExists(config);
    if (exists) {
      branch = "attach";
      logger.debug("createTmuxSession", "probe: server already has session, attaching", {
        tmuxSessionName: config.tmuxSessionName,
      });
      init = await tmuxTauri.attachTmux(config);
    } else {
      logger.debug("createTmuxSession", "probe: no existing session, creating", {
        tmuxSessionName: config.tmuxSessionName,
      });
      init = await tmuxTauri.createTmux(config);
    }
  } catch (err) {
    logger.debug("createTmuxSession", "probe failed, falling back to createTmux", {
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      init = await tmuxTauri.createTmux(config);
    } catch (createErr) {
      logger.error("createTmuxSession", "createTmux also failed; aborting", {
        branch: "create",
        error: createErr instanceof Error ? createErr.message : String(createErr),
        elapsedMs: Date.now() - t0,
      });
      throw createErr;
    }
  }

  logger.debug("createTmuxSession", "backend init received", {
    branch,
    controllerId: init.session.tmuxControllerId ?? null,
    bootstrapSessionId: init.session.id,
    bootstrapName: init.session.name,
    windowCount: init.windows.length,
    paneCount: init.panes.length,
    controlWindowName: init.controlWindow.name,
  });

  // Build the bootstrap Session (whose id matches `init.session.id`).
  const bootstrapSession = buildFrontendSession(init.session, configId, "tmux-cc", displayConfig);

  if (save) {
    const saved: PersistedSessionConfig = {
      id: configId,
      name: init.session.name,
      version: 1,
      type: "tmux-cc",
      config,
      displayConfig,
    };
    usePersistenceStore.getState().upsertSavedConfig(saved);
    logger.debug("createTmuxSession", "persisted", { savedConfigId: configId });
  }

  // Build 1:1 Session rows for every pane reported by the server.
  // `init.panes` already includes the bootstrap pane (same id as
  // `bootstrapSession.id`); we de-dup via a Set so we don't insert
  // the same Session twice.
  const seenSessionIds = new Set<number>();
  const sessionsToAdd: Session[] = [];
  for (const pane of init.panes) {
    if (seenSessionIds.has(pane.sessionId)) continue;
    seenSessionIds.add(pane.sessionId);
    // The bootstrap pane carries no special "is this the
    // bootstrap?" flag — it just happens to be the one with
    // `pane.sessionId === bootstrapSession.id`. We reuse the
    // bootstrapSession object verbatim for that row so frontend
    // listeners that keyed off `isHidden` see the right value.
    if (pane.sessionId === bootstrapSession.id) {
      sessionsToAdd.push(bootstrapSession);
    } else {
      sessionsToAdd.push(
        buildFrontendSession(
          makeSessionInfoFromPane(pane, init.session.tmuxControllerId!, configId),
          configId,
          "tmux-cc",
          displayConfig,
        ),
      );
    }
  }
  useSessionStore.getState().setSessions((prev) => [...prev, ...sessionsToAdd]);
  logger.debug("createTmuxSession", "session rows built", {
    total: sessionsToAdd.length,
    unique: seenSessionIds.size,
  });

  // Build 1:1 Window rows for every window reported by the server,
  // plus exactly one TmuxControlWindow row.
  installInitialWindows(init, bootstrapSession);

  logger.debug("createTmuxSession", "done", {
    sessionId: bootstrapSession.id,
    elapsedMs: Date.now() - t0,
  });
  return bootstrapSession;
}

/**
 * Build the frontend Session model for a pane that is NOT the
 * bootstrap pane. `SessionInfo` is normally shaped by the backend's
 * `tmux_pane_info` builder; we replicate enough of that shape here
 * to satisfy `buildFrontendSession`.
 */
function makeSessionInfoFromPane(
  pane: tmuxTauri.TmuxPaneInit,
  controllerId: number,
  configId: string,
) {
  return {
    id: pane.sessionId,
    name: pane.title || `tmux:${pane.tmuxPaneId}`,
    sessionType: {
      type: "tmux-cc" as const,
      config: { controllerId, paneId: pane.tmuxPaneId, sessionName: "" },
    },
    isConnected: true,
    capabilities: {
      supportsMultiplex: true,
    },
    tmuxPaneId: pane.tmuxPaneId,
    tmuxControllerId: controllerId,
    tmuxServerWindowId: pane.tmuxWindowId,
    configId,
    isHidden: false,
  } as unknown as Parameters<typeof buildFrontendSession>[0];
}

/**
 * Install the TmuxControlWindow + n terminal Windows into the active
 * workspace. Each Window holds a single-leaf PaneTree whose
 * `sessionId` is the corresponding Session row's id.
 *
 * Layout per Window:
 *   - tmux-control Window  → single leaf pane with no Session (the
 *     controller UI lives here).
 *   - each terminal Window → single leaf pane whose Session is
 *     `init.panes[i]` for the i-th pane that lives in that window.
 *
 * Note that the **bootstrap pane's** terminal Window is `init.windows`
 * whose `tmux_window_id` equals the bootstrap pane's `tmux_window_id`
 * — we render that one as the first Window so its `activePaneId` /
 * `name` matches the active tmux state.
 */
function installInitialWindows(init: tmuxTauri.TmuxSessionInit, bootstrapSession: Session): void {
  const workspaceStore = useWorkspaceStore.getState();
  const workspaces = workspaceStore.workspaces;
  const targetId = workspaceStore.activeWorkspaceId ?? workspaces[0]?.id;
  if (!targetId) {
    // Caller is expected to ensure a workspace exists.
    return;
  }

  const controllerId = init.session.tmuxControllerId!;

  // Group panes by their tmux_window_id so each Window holds the
  // panes that belong to it server-side.
  const panesByWindow = new Map<string, tmuxTauri.TmuxPaneInit[]>();
  for (const pane of init.panes) {
    const list = panesByWindow.get(pane.tmuxWindowId) ?? [];
    list.push(pane);
    panesByWindow.set(pane.tmuxWindowId, list);
  }

  const newWindows: Window[] = [];

  // One terminal Window per server-side window, in server order.
  for (const w of init.windows) {
    const panes = panesByWindow.get(w.tmuxWindowId) ?? [];
    if (panes.length === 0) continue;
    const rootPane = buildRootPane(panes[0].sessionId, w.active);
    newWindows.push({
      id: generateId(),
      name: w.name,
      kind: "terminal",
      rootPane,
      activePaneId: rootPane.id,
      tmuxControllerId: controllerId,
      tmuxServerWindowId: w.tmuxWindowId,
    });
  }

  logger.debug("createTmuxSession", "terminal windows built", {
    serverWindowCount: init.windows.length,
    terminalWindowCount: newWindows.length,
    skippedWindows: init.windows.length - newWindows.length,
  });

  // Ensure the bootstrap pane's Window is the active one — match
  // `init.session.tmux_window_id` to the Window we just built and
  // tag its id.
  const bootstrapWindowId = (() => {
    const bootstrapWin = newWindows.find(
      (w) => w.kind === "terminal" && w.tmuxServerWindowId === bootstrapSession.tmuxServerWindowId,
    );
    return bootstrapWin?.id ?? newWindows[0]?.id ?? "";
  })();

  const controlWindow: Window = {
    id: generateId(),
    name: init.controlWindow.name,
    kind: "tmux-control",
    activePaneId: null,
    tmuxControllerId: controllerId,
    tmuxSessionName: init.controlWindow.name,
  };

  logger.debug("createTmuxSession", "installing into workspace", {
    targetWorkspaceId: targetId,
    terminalWindows: newWindows.length,
    controlWindowInserted: !workspaceStore.workspaces
      .find((w) => w.id === targetId)
      ?.windows.some((w) => w.kind === "tmux-control" && w.tmuxControllerId === controllerId),
  });

  workspaceStore.setWorkspaces((prev) => {
    const target = prev.find((w) => w.id === targetId);
    if (!target) return prev;
    const hasControlWindow = target.windows.some(
      (w) => w.kind === "tmux-control" && w.tmuxControllerId === controllerId,
    );
    const prefix = hasControlWindow ? [] : [controlWindow];
    return prev.map((workspace) =>
      workspace.id === targetId
        ? {
            ...workspace,
            windows: [...prefix, ...workspace.windows, ...newWindows],
            activeWindowId: bootstrapWindowId,
          }
        : workspace,
    );
  });
}

/**
 * Build a single-leaf rootPane whose leaf is bound to the first pane
 * in the given list. Multiple server-side panes in one tmux window
 * (e.g. after splits) end up as one frontend Window containing a
 * chain of split panes — but since `list-panes -a` returns panes
 * that already exist in the server's window, the simplest correct
 * representation here is one Window per tmux window with a single
 * leaf bound to the **first** pane in the window. Subsequent splits
 * will be wired up by the existing `tmux-pane-added` listener (the
 * user-driven split path).
 */
function buildRootPane(sessionId: number, _active: boolean): PaneNode {
  return {
    id: generateId(),
    kind: "leaf" as const,
    size: 100,
    binding: { sessionId, configId: "" },
  };
}

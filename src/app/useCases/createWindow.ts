/**
 * createWindow — append a new terminal / init Window to a workspace.
 *
 * Variants (consolidated in one function):
 * - `variant: "fromSession"` — bind an existing session to a leaf pane.
 * - `variant: "fromSavedConfig"` — recreate session from saved config
 *   and bind it (driven by `openSavedSession`).
 * - `variant: "init"` — placeholder window (PaneInitCard).
 * - `variant: "replaceInit"` — promote an init window to a real
 *   terminal window bound to a session.
 * - `variant: "tmux"` — create a tmux window on the controller
 *   (delegates to `infra.createTmuxWindow`; the actual `Window` row
 *   is delivered asynchronously via `tmux-window-added`).
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { assertSessionNotUsedElsewhere, getUniqueWindowName } from "../../model/rules/sessionRules";
import { createLeafPane, generateId, getDefaultWindowName } from "../../model/entities/paneTree";
import { withRecomputedSessionIds } from "../../model/rules/workspaceRules";
import type { Window } from "../../model/entities";
import { openSavedSession } from "./openSavedSession";

export interface CreateWindowFromSessionInput {
  sessionId: number;
  configId: string;
  name?: string;
  targetWorkspaceId?: string;
}
export interface CreateWindowOptions {
  variant: "fromSession" | "fromSavedConfig" | "init" | "replaceInit" | "tmux";
  workspaceId?: string;
  windowId?: string;
  sessionId?: number;
  configId?: string;
  name?: string;
  windowType?: "terminal" | "init";
  tmuxControlWindowId?: number;
}

export async function createWindow(
  opts: CreateWindowFromSessionInput | CreateWindowOptions,
): Promise<Window> {
  // Legacy short-form: a single object carrying sessionId/configId/name/workspaceId.
  if ("sessionId" in opts && "configId" in opts && !("variant" in opts)) {
    return createWindowFromSession(opts as CreateWindowFromSessionInput);
  }

  const o = opts as CreateWindowOptions;
  switch (o.variant) {
    case "fromSession":
      return createWindowFromSession({
        sessionId: o.sessionId!,
        configId: o.configId!,
        name: o.name,
        targetWorkspaceId: o.workspaceId,
      });
    case "fromSavedConfig":
      return createWindowFromSavedConfig(o.configId!, o.name, o.workspaceId);
    case "init":
      return createInitWindow();
    case "replaceInit":
      return replaceInitWindowWithSession(
        o.workspaceId!,
        o.windowId!,
        o.sessionId!,
        o.configId!,
        o.name,
      );
    case "tmux":
      return createTmuxServerWindow(o.tmuxControlWindowId!, o.name, o.workspaceId);
  }
}

function createWindowFromSession(input: CreateWindowFromSessionInput): Window {
  const wsStore = useWorkspaceStore.getState();
  const workspaces = wsStore.workspaces;
  const sessionStore = useSessionStore.getState();
  const targetId = input.targetWorkspaceId ?? wsStore.activeWorkspaceId ?? workspaces[0]?.id;
  if (!targetId) throw new Error("No workspace available");

  assertSessionNotUsedElsewhere(workspaces, targetId, null, input.sessionId);

  const rootPane = createLeafPane(100, input.sessionId, input.configId);
  const baseName = input.name ?? getDefaultWindowName(rootPane, sessionStore.sessions, "Window");
  const window: Window = {
    id: generateId(),
    name: baseName,
    rootPane,
    activePaneId: rootPane.id,
    windowType: "terminal",
  };

  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) =>
      workspace.id === targetId
        ? withRecomputedSessionIds({
            ...workspace,
            windows: [
              ...workspace.windows,
              { ...window, name: getUniqueWindowName(prev, targetId, baseName) },
            ],
            activeWindowId: window.id,
          })
        : workspace,
    ),
  );
  return window;
}

async function createWindowFromSavedConfig(
  configId: string,
  name: string | undefined,
  workspaceId: string | undefined,
): Promise<Window> {
  const session = await openSavedSession(configId);
  assertSessionNotUsedElsewhere(useWorkspaceStore.getState().workspaces, null, null, session.id);
  return createWindowFromSession({
    sessionId: session.id,
    configId: session.configId,
    name: name ?? session.name,
    targetWorkspaceId: workspaceId,
  });
}

function createInitWindow(): Window {
  const paneId = generateId();
  return {
    id: generateId(),
    name: "New Session",
    activePaneId: paneId,
    windowType: "init",
    rootPane: { id: paneId, type: "leaf", size: 100 },
  };
}

function replaceInitWindowWithSession(
  workspaceId: string,
  windowId: string,
  sessionId: number,
  configId: string,
  name: string | undefined,
): Window {
  const wsStore = useWorkspaceStore.getState();
  assertSessionNotUsedElsewhere(wsStore.workspaces, workspaceId, windowId, sessionId);

  const rootPane = createLeafPane(100, sessionId, configId);
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  const baseName = name ?? session?.name ?? "Window";

  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      return withRecomputedSessionIds({
        ...workspace,
        windows: workspace.windows.map((window) =>
          window.id === windowId
            ? {
                ...window,
                name: getUniqueWindowName(prev, workspaceId, baseName, windowId),
                rootPane,
                activePaneId: rootPane.id,
                windowType: "terminal",
              }
            : window,
        ),
      });
    }),
  );

  return {
    id: windowId,
    name: baseName,
    rootPane,
    activePaneId: rootPane.id,
    windowType: "terminal",
  };
}

async function createTmuxServerWindow(
  controllerId: number,
  name: string | undefined,
  workspaceId: string | undefined,
): Promise<Window> {
  // Fire-and-forget — the actual `Window` row arrives via the
  // `tmux-window-added` listener.
  try {
    await tmuxTauri.createTmuxWindow(controllerId, name);
  } catch (e) {
    console.error("Failed to create tmux window:", e);
  }
  void workspaceId;
  return {
    id: generateId(),
    name: name ?? "Window",
    rootPane: createLeafPane(100),
    activePaneId: "",
    windowType: "terminal",
  };
}

export const _legacy_createWindowFromSession = createWindowFromSession;
export const _legacy_createInitWindow = createInitWindow;
export const _legacy_replaceInitWindowWithSession = replaceInitWindowWithSession;

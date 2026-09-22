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
import { assertSessionNotUsedElsewhere, getUniqueWindowName } from "../../app/rules/sessionRules";
import { createLeafPane, generateId, getDefaultWindowName } from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../service/legacy/contexts/session/paneUtils";
import type { InitWindow, TerminalWindow, Window } from "../../model/window";
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
  const window: TerminalWindow = {
    id: generateId(),
    name: baseName,
    kind: "terminal",
    rootPane,
    activePaneId: rootPane.id,
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

export function createInitWindow(): Window {
  const init: InitWindow = {
    id: generateId(),
    name: "New Session",
    activePaneId: null,
    kind: "init",
  };
  return init;
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
                kind: "terminal",
              }
            : window,
        ),
      });
    }),
  );

  return {
    id: windowId,
    name: baseName,
    kind: "terminal",
    rootPane,
    activePaneId: rootPane.id,
  };
}

async function createTmuxServerWindow(
  controllerId: number,
  name: string | undefined,
  workspaceId: string | undefined,
): Promise<Window> {
  try {
    await tmuxTauri.createTmuxWindow(controllerId, name);
  } catch (e) {
    console.error("Failed to create tmux window:", e);
  }
  void workspaceId;
  return {
    id: generateId(),
    name: name ?? "Window",
    kind: "terminal",
    rootPane: createLeafPane(100),
    activePaneId: "",
  };
}

/**
 * createWorkspace — create a new workspace (variants:
 *   - default: empty workspace with a single init window
 *   - fromSession: workspace wrapping a window for the given session
 *     (used by legacy `createWorkspaceFromSession`)
 *   - replacement: a regular workspace built by `loadWorkspace`
 *     (kept here so the `createWorkspace` API is a single entry point)
 */
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { createLeafPane, generateId } from "../../app/rules/paneTree";
import { createInitWindow } from "./createInitWindow";
import type { Workspace } from "../../model/entities";

export interface CreateWorkspaceInput {
  variant: "default" | "fromSession" | "replacement";
  name?: string;
  sessionId?: number;
  configId?: string;
  /** For variant=replacement: caller supplies the built workspace. */
  workspace?: Workspace;
}

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  const wsStore = useWorkspaceStore.getState();
  if (input.variant === "default") return createDefaultWorkspace();
  if (input.variant === "fromSession") {
    return createWorkspaceFromSession(input.sessionId!, input.configId!, input.name);
  }
  if (input.variant === "replacement" && input.workspace) {
    wsStore.addWorkspace(input.workspace);
    wsStore.setActiveWorkspace(input.workspace.id);
    return input.workspace;
  }
  throw new Error("Unknown createWorkspace variant");
}

/**
 * createDefaultWorkspace — add a new "default" workspace with an init
 * window. Reuses an existing default workspace if one is already
 * present.
 */
export function createDefaultWorkspace(): Workspace {
  const wsStore = useWorkspaceStore.getState();
  const existing = wsStore.workspaces.find((w) => w.name === "default");
  if (existing) {
    wsStore.setActiveWorkspace(existing.id);
    return existing;
  }

  const workspaceId = generateId();
  const init = createInitWindow();
  const workspace: Workspace = {
    id: workspaceId,
    name: "default",
    windows: [init],
    activeWindowId: init.id,
    sessionIds: [],
  };

  wsStore.addWorkspace(workspace);
  wsStore.setActiveWorkspace(workspaceId);
  return workspace;
}

function createWorkspaceFromSession(sessionId: number, configId: string, name?: string): Workspace {
  const wsStore = useWorkspaceStore.getState();
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  const workspaceId = generateId();
  const rootPane = createLeafPane(100, sessionId, configId);
  const workspace: Workspace = {
    id: workspaceId,
    name: name ?? session?.name ?? "Workspace",
    windows: [
      {
        id: generateId(),
        name: name ?? session?.name ?? "Window",
        rootPane,
        activePaneId: rootPane.id,
        windowType: "terminal",
      },
    ],
    activeWindowId: "",
    sessionIds: sessionId === undefined ? [] : [sessionId],
  };
  workspace.activeWindowId = workspace.windows[0].id;
  wsStore.addWorkspace(workspace);
  wsStore.setActiveWorkspace(workspaceId);
  return workspace;
}

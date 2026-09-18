/**
 * splitPane — split an existing pane in two. When the source session
 * is a tmux pane (supportsMultiplex), route to `infra.createTmuxPane`
 * and bind the new tmux pane to the new leaf. Otherwise create an
 * empty leaf that the user fills with a session from the dialog.
 *
 * TODO: legacy edge cases not ported —
 * - assertSessionNotUsedElsewhere for non-tmux splits.
 * - dedupe against async tmux-pane-added listener race.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import {
  createLeafPane,
  createSplitNode,
  findPaneNode,
  replacePaneNode,
} from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../app/rules/workspaceRules";
import type { Session, SplitDirection } from "../../model";

export interface SplitPaneInput {
  workspaceId: string;
  windowId: string;
  paneId: string;
  direction: SplitDirection;
  sessionId?: number;
  configId?: string;
}

export async function splitPane(input: SplitPaneInput): Promise<void> {
  const { workspaceId, windowId, paneId, direction, sessionId, configId } = input;

  // tmux path: backend creates the new pane and returns its SessionInfo.
  if (sessionId !== undefined) {
    const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
    if (session?.capabilities?.supportsMultiplex && session.tmuxControllerId !== undefined) {
      await splitTmuxPaneInternal(session, workspaceId, windowId, paneId, direction);
      return;
    }
  }

  // Plain UI split — empty leaf until the user picks a session.
  useWorkspaceStore.getState().setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      const window = workspace.windows.find((w) => w.id === windowId);
      if (!window) return workspace;
      const target = findPaneNode(window.rootPane, paneId);
      if (!target || target.type !== "leaf") return workspace;

      const halfSize = target.size / 2;
      const originalPane = { ...target, size: halfSize };
      const newPane = createLeafPane(halfSize, sessionId, configId);
      const splitNode = createSplitNode(direction, originalPane, newPane);
      const newRoot = replacePaneNode(window.rootPane, paneId, splitNode);

      return withRecomputedSessionIds({
        ...workspace,
        activeWindowId: windowId,
        windows: workspace.windows.map((win) =>
          win.id === windowId ? { ...win, rootPane: newRoot, activePaneId: newPane.id } : win,
        ),
      });
    }),
  );
}

async function splitTmuxPaneInternal(
  parent: Session,
  workspaceId: string,
  windowId: string,
  paneId: string,
  direction: SplitDirection,
): Promise<void> {
  const controllerId = parent.tmuxControllerId!;
  let info: Awaited<ReturnType<typeof tmuxTauri.createTmuxPane>>;
  try {
    info = await tmuxTauri.createTmuxPane(controllerId, parent.id, direction);
  } catch (e) {
    console.error("splitTmuxPane: backend create_tmux_pane failed:", e);
    return;
  }

  const newSessionId = info.id;
  const sessionStore = useSessionStore.getState();
  sessionStore.setSessions((prev) => {
    if (prev.some((s) => s.id === newSessionId)) return prev;
    return [
      ...prev,
      {
        id: newSessionId,
        configId: "",
        name: `tmux-${controllerId}:${parent.tmuxPaneId ?? "?"}`,
        type: "tmux-cc",
        isConnected: true,
        sessionType: { type: "tmux-cc", config: {} },
        tmuxPaneId: parent.tmuxPaneId,
        tmuxControllerId: controllerId,
        isHidden: false,
        capabilities: {
          supportsResize: true,
          supportsReconnect: true,
          supportsLocalEcho: false,
          supportsMultiplex: true,
        },
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    ];
  });

  useWorkspaceStore.getState().setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      const window = workspace.windows.find((w) => w.id === windowId);
      if (!window) return workspace;
      const target = findPaneNode(window.rootPane, paneId);
      if (!target || target.type !== "leaf") return workspace;
      const halfSize = target.size / 2;
      const originalPane = { ...target, size: halfSize };
      const newPane = createLeafPane(halfSize, newSessionId, "");
      const splitNode = createSplitNode(direction, originalPane, newPane);
      const newRoot = replacePaneNode(window.rootPane, paneId, splitNode);
      return withRecomputedSessionIds({
        ...workspace,
        activeWindowId: windowId,
        windows: workspace.windows.map((win) =>
          win.id === windowId ? { ...win, rootPane: newRoot, activePaneId: newPane.id } : win,
        ),
      });
    }),
  );
}

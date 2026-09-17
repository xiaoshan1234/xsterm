/**
 * closeWindow — drop a Window and close every leaf session attached
 * to it. Three branches:
 *
 * 1. tmux-control window: confirm-gated upstream. Closes every
 *    ordinary tmux-window in this workspace that belongs to the same
 *    controller, drops the control-window itself, and unmarks the
 *    attached tmux server.
 * 2. ordinary tmux-window (`xstermWindowId !== undefined`): just
 *    close the leaf sessions. No `kill_tmux_window` (destructive ops
 *    are explicit).
 * 3. everything else (init / non-tmux terminal): close leaf sessions
 *    + drop the Window.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { unmarkAttachedTmux } from "../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { clearSessionOutput } from "../../infra/buffers/sessionOutputBuffer";
import { forEachPane } from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../app/rules/workspaceRules";
import { createInitWindow } from "./createInitWindow";

export function closeWindow(workspaceId: string, windowId: string): void {
  const wsStore = useWorkspaceStore.getState();
  const workspace = wsStore.workspaces.find((w) => w.id === workspaceId);
  const window = workspace?.windows.find((w) => w.id === windowId);
  if (!window) return;

  // Branch 1: tmux-control window
  if (window.windowType === "tmux-control" && window.tmuxControlWindowId !== undefined) {
    const controllerId = window.tmuxControlWindowId;
    const sessionIdsToClose = new Set<number>();
    const windowsToDrop: string[] = [windowId];
    const siblingWindows = workspace?.windows ?? [];
    for (const w of siblingWindows) {
      if (w.id === windowId) continue;
      if (w.windowType === "tmux-control") continue;
      forEachPane(w.rootPane, (node) => {
        if (node.type === "leaf" && node.sessionId !== undefined) {
          sessionIdsToClose.add(node.sessionId);
        }
      });
      windowsToDrop.push(w.id);
    }

    wsStore.setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const remaining = ws.windows.filter((w) => !windowsToDrop.includes(w.id));
        let nextActiveId = ws.activeWindowId;
        let windows = remaining;
        if (remaining.length === 0) {
          const init = createInitWindow();
          windows = [init];
          nextActiveId = init.id;
        } else if (windowsToDrop.includes(ws.activeWindowId ?? "")) {
          const closedIndex = ws.windows.findIndex((w) => windowsToDrop.includes(w.id));
          const fallback =
            remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1];
          nextActiveId = fallback?.id ?? null;
        }
        return withRecomputedSessionIds({
          ...ws,
          windows,
          activeWindowId: nextActiveId,
        });
      }),
    );

    sessionIdsToClose.forEach((sessionId) => {
      tauri.closeSession(sessionId).catch((e) => console.error("Failed to close session:", e));
      clearSessionOutput(sessionId);
    });
    if (sessionIdsToClose.size > 0) {
      useSessionStore
        .getState()
        .setSessions((prev) => prev.filter((s) => !sessionIdsToClose.has(s.id)));
    }
    unmarkAttachedTmux(controllerId).catch((e: unknown) =>
      console.error("Failed to unmark tmux:", e),
    );
    return;
  }

  // Branches 2 & 3: ordinary tmux-window / non-tmux terminal
  const sessionIdsToClose = new Set<number>();
  forEachPane(window.rootPane, (node) => {
    if (node.type === "leaf" && node.sessionId !== undefined) {
      sessionIdsToClose.add(node.sessionId);
    }
  });

  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      const remaining = workspace.windows.filter((w) => w.id !== windowId);
      let nextActiveId = workspace.activeWindowId;
      let windows = remaining;
      if (remaining.length === 0) {
        const init = createInitWindow();
        windows = [init];
        nextActiveId = init.id;
      } else if (nextActiveId === windowId) {
        const closedIndex = workspace.windows.findIndex((w) => w.id === windowId);
        const fallback =
          remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1];
        nextActiveId = fallback?.id ?? null;
      }
      return withRecomputedSessionIds({ ...workspace, windows, activeWindowId: nextActiveId });
    }),
  );

  sessionIdsToClose.forEach((sessionId) => {
    tauri.closeSession(sessionId).catch((e) => console.error("Failed to close session:", e));
    clearSessionOutput(sessionId);
  });
  if (sessionIdsToClose.size > 0) {
    useSessionStore
      .getState()
      .setSessions((prev) => prev.filter((s) => !sessionIdsToClose.has(s.id)));
  }
}

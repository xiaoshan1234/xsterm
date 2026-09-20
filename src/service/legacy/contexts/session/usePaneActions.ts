/**
 * Pane actions — thin wrappers around the use cases in
 * `src/app/useCases/`. State lives in `src/service/`-star-`/store.ts`; the use
 * cases mutate it via `store.getState()`.
 *
 * **Legacy `splitPane`**: needed the `setSessions` / `setWorkspaces`
 * callbacks for the tmux-split branch. The new use case talks to the
 * session + workspace stores directly, so the hook no longer needs
 * those refs.
 *
 * **Legacy `updateWindowPaneTree`**: still local because it's a thin
 * passthrough to `useWorkspaceStore.getState().updateWindowPaneTree`.
 */
import { useCallback } from "react";
import type { PaneNode, Session, SplitDirection, Workspace } from "../../../../model";
import { splitPane as splitPaneUseCase } from "../../../../app/useCases/splitPane";
import { closePane as closePaneUseCase } from "../../../../app/useCases/closePane";
import { writeSession as writeSessionFn } from "../../../../infra/tauri/commands/sessions";
import { resizeSession as resizeSessionFn } from "../../../../infra/tauri/commands/sessions";
import { killTmuxPane as killTmuxPaneFn } from "../../../../infra/tauri/commands/tmux";
import { useWorkspaceStore } from "../../../../service/workspace/store";

interface UsePaneActionsDeps {
  sessionsRef: React.MutableRefObject<Session[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
}

export function usePaneActions(_deps: UsePaneActionsDeps) {
  const splitPane = useCallback(
    (
      workspaceId: string,
      windowId: string,
      paneId: string,
      direction: SplitDirection,
      sessionId?: number,
      configId?: string,
    ) => {
      void splitPaneUseCase({ workspaceId, windowId, paneId, direction, sessionId, configId });
    },
    [],
  );

  const closePane = useCallback(
    (workspaceId: string, windowId: string, paneId: string) =>
      closePaneUseCase(workspaceId, windowId, paneId),
    [],
  );

  const writeSession = useCallback((id: number, data: string) => writeSessionFn(id, data), []);

  const resizeSession = useCallback(
    (id: number, rows: number, cols: number) => resizeSessionFn(id, rows, cols),
    [],
  );

  const killTmuxPane = useCallback(
    (controllerId: number, tmuxPaneId: string) => void killTmuxPaneFn(controllerId, tmuxPaneId),
    [],
  );

  /**
   * `updateWindowPaneTree` is a local mutation that takes a user
   * function and applies it to the pane tree of a specific window. The
   * use case is just a thin pass-through to the workspace store's
   * `updateWindowPaneTree` action.
   */
  const updateWindowPaneTree = useCallback(
    (workspaceId: string, windowId: string, updater: (root: PaneNode) => PaneNode) => {
      useWorkspaceStore.getState().updateWindowPaneTree(workspaceId, windowId, updater);
    },
    [],
  );

  return {
    splitPane,
    updateWindowPaneTree,
    closePane,
    writeSession,
    resizeSession,
    killTmuxPane,
  };
}

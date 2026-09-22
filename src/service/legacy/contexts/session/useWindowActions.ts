/**
 * Window actions — thin wrappers around the use cases in
 * `src/app/useCases/` (for window-lifecycle operations that go through
 * the IPC layer) and direct service-store mutations (for the purely
 * synchronous UI helpers).
 *
 * State lives in `src/service/`-star-`/store.ts`; mutations happen via
 * `store.getState()`.
 */
import { useCallback } from "react";
import type { PaneLeafNode } from "../../../../model/pane";
import type { InitWindow, TerminalWindow, Window } from "../../../../model/window";
import type { SavedSessionConfig, Session, Workspace } from "../../../../model";
import { createLeafPane, generateId, getDefaultWindowName } from "../../../../app/rules/paneTree";
import {
  assertSessionNotUsedElsewhere,
  getUniqueWindowName,
} from "../../../../app/rules/sessionRules";
import { withRecomputedSessionIds } from "../../../../service/legacy/contexts/session/paneUtils";
import { createWindow as createWindowUseCase } from "../../../../app/useCases/createWindow";
import { createInitWindow as createInitWindowUseCase } from "../../../../app/useCases/createInitWindow";
import { replaceInitWindowWithSession as replaceInitWindowWithSessionUseCase } from "../../../../app/useCases/replaceInitWindowWithSession";
import { closeWindow as closeWindowUseCase } from "../../../../app/useCases/closeWindow";
import { reorderWindows as reorderWindowsUseCase } from "../../../../app/useCases/reorderWindows";
import { setActiveWindow as setActiveWindowUseCase } from "../../../../app/useCases/setActiveWindow";
import { setActivePane as setActivePaneUseCase } from "../../../../app/useCases/setActivePane";
import { renameWindow as renameWindowUseCase } from "../../../../app/useCases/renameWindow";
import { openSavedSession as openSavedSessionUseCase } from "../../../../app/useCases/openSavedSession";
import { createDefaultWorkspace as createDefaultWorkspaceUseCase } from "../../../../app/useCases/createWorkspace";
import * as tmuxTauri from "../../../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../../../service/session/store";
import { useWorkspaceStore } from "../../../../service/workspace/store";

interface UseWindowActionsDeps {
  savedConfigs: SavedSessionConfig[];
  sessionsRef: React.MutableRefObject<Session[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  activeWorkspaceId: string | null;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
}

export function useWindowActions(deps: UseWindowActionsDeps) {
  const { activeWorkspaceId } = deps;

  // --- createWindowFromSavedConfig -------------------------------------
  // Open the saved config (which creates the Session + adds it to the
  // session store), then create a Window for it.
  const createWindowFromSavedConfig = useCallback(
    async (configId: string, name?: string): Promise<Window> => {
      let activeId = activeWorkspaceId;
      if (!activeId) {
        const ws = createDefaultWorkspaceUseCase();
        activeId = ws.id;
      }
      const session = await openSavedSessionUseCase(configId);
      return createWindowUseCase({
        variant: "fromSession",
        sessionId: session.id,
        configId: session.configId,
        name: name ?? session.name,
        workspaceId: activeId ?? undefined,
      });
    },
    [activeWorkspaceId],
  );

  // --- createWindow ----------------------------------------------------
  // Polymorphic: branches on (tmuxControlWindowId?, sessionId?). The
  // legacy contract returns `Window` synchronously for the non-saved
  // paths, so we use the store / IPC directly instead of the async use
  // case.
  const createWindow = useCallback(
    (
      workspaceId: string,
      sessionId?: number,
      configId?: string,
      name?: string,
      windowType: "terminal" | "init" = "terminal",
      tmuxControlWindowId?: number,
    ): Window => {
      // Branch A: tmux-control window — fire-and-forget IPC; the actual
      // Window row arrives via the `tmux-window-added` listener.
      if (tmuxControlWindowId !== undefined) {
        tmuxTauri
          .createTmuxWindow(tmuxControlWindowId, name)
          .catch((e) => console.error("Failed to create tmux window:", e));
        const leafPane = createLeafPane(100, sessionId, configId);
        const placeholder: TerminalWindow = {
          id: generateId(),
          name: name ?? "Window",
          kind: "terminal",
          rootPane: leafPane,
          activePaneId: leafPane.id,
        };
        return placeholder;
      }
      // Branch B: fromSession — synchronous local mutation.
      if (sessionId !== undefined) {
        const wsStore = useWorkspaceStore.getState();
        assertSessionNotUsedElsewhere(wsStore.workspaces, workspaceId, null, sessionId);
        const rootPane: PaneLeafNode = createLeafPane(100, sessionId, configId);
        const sessionStore = useSessionStore.getState();
        const baseName =
          name ??
          getDefaultWindowName(
            rootPane,
            sessionStore.sessions,
            windowType === "init" ? "New Session" : "Window",
          );
        const window: TerminalWindow = {
          id: generateId(),
          name: baseName,
          kind: "terminal",
          rootPane,
          activePaneId: rootPane.id,
        };
        wsStore.setWorkspaces((prev) => {
          const uniqueName = getUniqueWindowName(prev, workspaceId, baseName);
          const finalWindow: TerminalWindow = { ...window, name: uniqueName };
          return prev.map((workspace) =>
            workspace.id === workspaceId
              ? withRecomputedSessionIds({
                  ...workspace,
                  windows: [...workspace.windows, finalWindow],
                  activeWindowId: finalWindow.id,
                })
              : workspace,
          );
        });
        return window;
      }
      // Branch C: no sessionId — return an init window.
      const init: InitWindow = {
        id: generateId(),
        name: "New Session",
        activePaneId: null,
        kind: "init",
      };
      return init;
    },
    [],
  );

  const createInitWindow = useCallback(() => createInitWindowUseCase(), []);

  const replaceInitWindowWithSession = useCallback(
    (workspaceId: string, windowId: string, session: Session) => {
      replaceInitWindowWithSessionUseCase(
        workspaceId,
        windowId,
        session.id,
        session.configId,
        session.name,
      );
    },
    [],
  );

  const closeWindow = useCallback(
    (workspaceId: string, windowId: string) => closeWindowUseCase(workspaceId, windowId),
    [],
  );

  const reorderWindows = useCallback(
    (workspaceId: string, fromIndex: number, toIndex: number) =>
      reorderWindowsUseCase(workspaceId, fromIndex, toIndex),
    [],
  );

  const setActiveWindow = useCallback(
    (workspaceId: string, windowId: string) => setActiveWindowUseCase(workspaceId, windowId),
    [],
  );

  const setActivePane = useCallback(
    (workspaceId: string, windowId: string, paneId: string) =>
      setActivePaneUseCase(workspaceId, windowId, paneId),
    [],
  );

  const renameWindow = useCallback(
    (workspaceId: string, windowId: string, name: string) =>
      renameWindowUseCase(workspaceId, windowId, name),
    [],
  );

  return {
    createWindowFromSavedConfig,
    createWindow,
    createInitWindow,
    replaceInitWindowWithSession,
    closeWindow,
    reorderWindows,
    setActiveWindow,
    setActivePane,
    renameWindow,
  };
}

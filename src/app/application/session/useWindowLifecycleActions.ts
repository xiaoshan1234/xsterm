import { useCallback } from "react";
import type { TerminalId, WindowId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { Window, Workspace } from "../../../features/workspace";
import {
  forEachPane,
  getUniqueWindowName,
  withRecomputedSessionIds,
} from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";

interface UseWindowLifecycleActionsOptions {
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<TerminalId>>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
  killTmuxWindow: (xstermWindowId: number) => Promise<void>;
  createInitWindow: () => Window;
}

export function useWindowLifecycleActions({
  workspacesRef,
  setSessions,
  setWorkspaces,
  establishingSessionsRef,
  closeTerminal,
  killTmuxWindow,
  createInitWindow,
}: UseWindowLifecycleActionsOptions) {
  return useCallback(
    (workspaceId: WorkspaceId, windowId: WindowId) => {
      const workspace = workspacesRef.current.find((candidate) => candidate.id === workspaceId);
      const window = workspace?.windows.find((candidate) => candidate.id === windowId);
      if (!window) return;

      const tmuxWindowId = window.xstermWindowId;
      const isTmuxWindow = tmuxWindowId !== undefined;
      if (tmuxWindowId !== undefined) {
        killTmuxWindow(tmuxWindowId).catch((error) =>
          console.error("Failed to kill tmux window:", error),
        );
      }

      const terminalIdsToClose = new Set<TerminalId>();
      forEachPane(window.rootPane, (node) => {
        if (node.type === "leaf" && node.terminalId !== undefined) {
          terminalIdsToClose.add(node.terminalId);
        }
      });

      setWorkspaces((previous) =>
        previous.map((candidate) => {
          if (candidate.id !== workspaceId) return candidate;
          const remaining = candidate.windows.filter((item) => item.id !== windowId);
          let nextActiveId = candidate.activeWindowId;
          let windows = remaining;
          if (remaining.length === 0) {
            const initWindow = createInitWindow();
            const uniqueName = getUniqueWindowName(previous, workspaceId, initWindow.name);
            windows = [{ ...initWindow, name: uniqueName }];
            nextActiveId = windows[0].id;
          } else if (nextActiveId === windowId) {
            const closedIndex = candidate.windows.findIndex((item) => item.id === windowId);
            const fallback =
              remaining[closedIndex - 1] ??
              remaining[closedIndex] ??
              remaining[remaining.length - 1];
            nextActiveId = fallback?.id ?? null;
          }
          return withRecomputedSessionIds({
            ...candidate,
            windows,
            activeWindowId: nextActiveId,
          });
        }),
      );

      terminalIdsToClose.forEach((terminalId) => {
        if (!isTmuxWindow) {
          closeTerminal(terminalId).catch((error) =>
            console.error("Failed to close terminal:", error),
          );
        }
        establishingSessionsRef.current.delete(terminalId);
        clearTerminalOutput(terminalId);
      });
      if (terminalIdsToClose.size > 0) {
        setSessions((previous) =>
          previous.filter((terminal) => !terminalIdsToClose.has(terminal.id)),
        );
      }
    },
    [
      closeTerminal,
      createInitWindow,
      establishingSessionsRef,
      killTmuxWindow,
      setSessions,
      setWorkspaces,
      workspacesRef,
    ],
  );
}

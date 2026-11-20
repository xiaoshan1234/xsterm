import { useCallback } from "react";
import type { PaneId, WindowId, WorkspaceId } from "../../../models";
import { isTmuxPaneTerminal, type Terminal } from "../../terminal";
import type { PaneIntentActions, Window, WorkspacePaneRuntimeActions } from "../contracts";

interface UsePaneRuntimeCommandsOptions {
  workspaceId: WorkspaceId;
  windowId: WindowId;
  paneId: PaneId;
  terminal?: Terminal;
  selectedWindow?: Window;
  paneIntents: Pick<PaneIntentActions, "closePane" | "closeTerminal">;
  paneRuntimeActions: WorkspacePaneRuntimeActions;
  reportError: (title: string, cause: unknown) => void;
}

export function usePaneRuntimeCommands({
  workspaceId,
  windowId,
  paneId,
  terminal,
  selectedWindow,
  paneIntents,
  paneRuntimeActions,
  reportError,
}: UsePaneRuntimeCommandsOptions) {
  const closeTerminal = useCallback(() => {
    if (terminal === undefined) return;
    void paneIntents
      .closeTerminal(terminal.id)
      .catch((error) => reportError("Failed to close terminal", error));
  }, [paneIntents, reportError, terminal]);

  const closePane = useCallback(() => {
    void paneIntents
      .closePane({ workspaceId, windowId, paneId })
      .catch((error) => reportError("Failed to close pane", error));
  }, [paneId, paneIntents, reportError, windowId, workspaceId]);

  const createMultiplexedWindow = useCallback(async () => {
    if (!terminal || !isTmuxPaneTerminal(terminal)) return;
    try {
      await paneRuntimeActions.createMultiplexedWindow(terminal.id);
    } catch (error) {
      reportError("Failed to create Tmux window", error);
    }
  }, [paneRuntimeActions, reportError, terminal]);

  const closeMultiplexedWindow = useCallback(async () => {
    const xstermWindowId = selectedWindow?.xstermWindowId;
    if (xstermWindowId === undefined) return;
    try {
      await paneRuntimeActions.closeMultiplexedWindow(xstermWindowId);
    } catch (error) {
      reportError("Failed to kill Tmux window", error);
    }
  }, [paneRuntimeActions, reportError, selectedWindow?.xstermWindowId]);

  const renameMultiplexedWindow = useCallback(
    async (name: string) => {
      const xstermWindowId = selectedWindow?.xstermWindowId;
      const trimmedName = name.trim();
      if (xstermWindowId === undefined || !trimmedName) return;
      try {
        await paneRuntimeActions.renameMultiplexedWindow(xstermWindowId, trimmedName);
      } catch (error) {
        reportError("Failed to rename Tmux window", error);
      }
    },
    [paneRuntimeActions, reportError, selectedWindow?.xstermWindowId],
  );

  return {
    closeMultiplexedWindow,
    closePane,
    closeTerminal,
    createMultiplexedWindow,
    renameMultiplexedWindow,
  };
}

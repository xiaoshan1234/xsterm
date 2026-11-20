import { useCallback, type MutableRefObject } from "react";
import { createApplicationError } from "../../../models/applicationError";
import { createWindowId, type TerminalId, type WorkspaceId } from "../../../models";
import type { SavedTerminalConfig } from "../../../features/launch-config";
import type { Terminal } from "../../../features/terminal";
import type { Window, Workspace } from "../../../features/workspace";
import { assertSessionNotUsedElsewhere, createLeafPane } from "../../../features/workspace";

interface UseWindowOpenActionsOptions {
  savedConfigs: SavedTerminalConfig[];
  workspacesRef: MutableRefObject<Workspace[]>;
  activeWorkspaceId: WorkspaceId | null;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  createWindowFromSession: (
    terminalId: TerminalId,
    configId: string,
    name?: string,
    targetWorkspaceId?: WorkspaceId,
  ) => Window;
}

export function useWindowOpenActions({
  savedConfigs,
  workspacesRef,
  activeWorkspaceId,
  createTerminalFromSavedConfig,
  createWindowFromSession,
}: UseWindowOpenActionsOptions) {
  return useCallback(
    async (configId: string, name?: string): Promise<Window> => {
      const config = savedConfigs.find((candidate) => candidate.id === configId);
      if (!config) throw createApplicationError("not-found", "Config not found");

      const terminal = await createTerminalFromSavedConfig(configId);
      if (config.type === "tmux-pane") {
        const rootPane = createLeafPane(100, terminal.id, terminal.configId);
        return {
          id: createWindowId(crypto.randomUUID()),
          name: name ?? config.name,
          rootPane,
          activePaneId: rootPane.id,
          windowType: "terminal",
        };
      }
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, terminal.id);
      return createWindowFromSession(
        terminal.id,
        terminal.configId,
        name ?? config.name,
        activeWorkspaceId ?? undefined,
      );
    },
    [
      activeWorkspaceId,
      createTerminalFromSavedConfig,
      createWindowFromSession,
      savedConfigs,
      workspacesRef,
    ],
  );
}

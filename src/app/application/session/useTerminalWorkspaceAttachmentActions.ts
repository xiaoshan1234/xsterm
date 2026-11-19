import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { TerminalId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import {
  assertSessionNotUsedElsewhere,
  createLeafPane,
  generateWindowId,
  generateWorkspaceId,
  getUniqueWindowName,
  withRecomputedSessionIds,
  type Window,
  type Workspace,
} from "../../../features/workspace";

interface UseTerminalWorkspaceAttachmentActionsOptions {
  terminalsRef: MutableRefObject<Terminal[]>;
  workspacesRef: MutableRefObject<Workspace[]>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: Dispatch<SetStateAction<WorkspaceId | null>>;
}

export function useTerminalWorkspaceAttachmentActions({
  terminalsRef,
  workspacesRef,
  setWorkspaces,
  setActiveWorkspaceId,
}: UseTerminalWorkspaceAttachmentActionsOptions) {
  const createWindowFromSession = useCallback(
    (
      terminalId: TerminalId,
      configId: string,
      name?: string,
      targetWorkspaceIdParam?: WorkspaceId,
    ): Window => {
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, terminalId);
      const rootPane = createLeafPane(100, terminalId, configId);
      const baseName = name ?? "Window";
      const window: Window = {
        id: generateWindowId(),
        name: baseName,
        rootPane,
        activePaneId: rootPane.id,
      };

      setWorkspaces((previous) => {
        const fallbackWorkspaceId = workspacesRef.current[0]?.id ?? previous[0]?.id ?? null;
        const targetWorkspaceId = targetWorkspaceIdParam ?? fallbackWorkspaceId;
        const workspaceExists =
          targetWorkspaceId !== null &&
          previous.some((workspace) => workspace.id === targetWorkspaceId);
        if (!targetWorkspaceId || !workspaceExists) {
          const uniqueName = getUniqueWindowName(previous, null, baseName);
          const finalWindow: Window = { ...window, name: uniqueName };
          const workspace: Workspace = {
            id: generateWorkspaceId(),
            name: "default",
            windows: [finalWindow],
            activeWindowId: finalWindow.id,
            terminalIds: [terminalId],
          };
          setActiveWorkspaceId(workspace.id);
          return [workspace];
        }
        const uniqueName = getUniqueWindowName(previous, targetWorkspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return previous.map((workspace) =>
          workspace.id === targetWorkspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, finalWindow],
                activeWindowId: finalWindow.id,
              })
            : workspace,
        );
      });
      return window;
    },
    [setActiveWorkspaceId, setWorkspaces, workspacesRef],
  );

  const createWorkspaceFromSession = useCallback(
    (terminalId: TerminalId, configId: string, name?: string): Workspace => {
      const terminal = terminalsRef.current.find((candidate) => candidate.id === terminalId);
      const windowName = name ?? terminal?.name ?? "Window";
      const rootPane = createLeafPane(100, terminalId, configId);
      const window: Window = {
        id: generateWindowId(),
        name: windowName,
        rootPane,
        activePaneId: rootPane.id,
      };
      const workspace: Workspace = {
        id: generateWorkspaceId(),
        name: name ?? terminal?.name ?? "Workspace",
        windows: [window],
        activeWindowId: window.id,
        terminalIds: [terminalId],
      };
      setWorkspaces((previous) => [...previous, workspace]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [setActiveWorkspaceId, setWorkspaces, terminalsRef],
  );

  return {
    createWindowFromSession,
    createWorkspaceFromSession,
  };
}

import { useCallback, useMemo } from "react";
import { createApplicationError, type TerminalId } from "../../models";
import { isTmuxPaneTerminal, useTerminalRuntime } from "../../features/terminal";
import { useTmuxRuntime } from "../../features/tmux";
import type { Workspace } from "../../features/workspace";
import {
  WorkspaceContainer,
  WorkspacePaneRuntimeActionsProvider,
  type WorkspacePaneRuntimeActions,
} from "../../features/workspace";
import { useTmuxWindowResize } from "./useTmuxWindowResize";

interface RuntimeMainAreaProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onCreateWorkspace: () => void;
}

export function RuntimeMainArea({
  workspaces,
  activeWorkspace,
  onCreateWorkspace,
}: RuntimeMainAreaProps) {
  const { terminals } = useTerminalRuntime();
  const { createTmuxWindow, killTmuxWindow, renameTmuxWindow } = useTmuxRuntime();
  const createMultiplexedWindow = useCallback(
    async (terminalId: TerminalId) => {
      const terminal = terminals.find((candidate) => candidate.id === terminalId);
      if (!terminal) {
        throw createApplicationError("not-found", "Terminal not found");
      }
      if (!isTmuxPaneTerminal(terminal)) {
        throw createApplicationError(
          "unsupported-operation",
          "Terminal does not support multiplexed windows",
        );
      }
      await createTmuxWindow(terminal.tmux.controllerId);
    },
    [createTmuxWindow, terminals],
  );
  const paneRuntimeActions = useMemo<WorkspacePaneRuntimeActions>(
    () => ({
      createMultiplexedWindow,
      closeMultiplexedWindow: killTmuxWindow,
      renameMultiplexedWindow: renameTmuxWindow,
    }),
    [createMultiplexedWindow, killTmuxWindow, renameTmuxWindow],
  );

  if (!activeWorkspace) {
    return (
      <div className="shell-empty-main">
        <h2>No workspace</h2>
        <p>Create a workspace to start using terminals.</p>
        <button type="button" className="btn btn--primary" onClick={onCreateWorkspace}>
          Create Workspace
        </button>
      </div>
    );
  }

  return (
    <WorkspacePaneRuntimeActionsProvider value={paneRuntimeActions}>
      <div className="shell-runtime-workspaces">
        {workspaces.map((workspace) => (
          <div
            key={workspace.id}
            className={`workspace-view ${
              workspace.id === activeWorkspace.id ? "workspace-view--active" : ""
            }`}
          >
            <RuntimeWorkspaceView workspace={workspace} />
          </div>
        ))}
      </div>
    </WorkspacePaneRuntimeActionsProvider>
  );
}

function RuntimeWorkspaceView({ workspace }: { workspace: Workspace }) {
  useTmuxWindowResize(workspace);
  return <WorkspaceContainer workspace={workspace} />;
}

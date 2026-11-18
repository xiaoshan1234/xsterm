import type { Workspace } from "../../features/workspace";
import { WorkspaceContainer } from "../../features/workspace";
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
  );
}

function RuntimeWorkspaceView({ workspace }: { workspace: Workspace }) {
  useTmuxWindowResize(workspace);
  return <WorkspaceContainer workspace={workspace} />;
}

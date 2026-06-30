import { useCallback } from "react";
import { Workspace, PaneNode } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { PaneTree } from "./PaneTree";

function updateNodeInTree(root: PaneNode, nodeId: string, updater: (node: PaneNode) => PaneNode): PaneNode {
  if (root.id === nodeId) {
    return updater(root);
  }
  if (!root.children) return root;
  return {
    ...root,
    children: root.children.map((child) => updateNodeInTree(child, nodeId, updater)),
  };
}

interface WorkspaceContainerProps {
  workspace: Workspace;
}

export function WorkspaceContainer({ workspace }: WorkspaceContainerProps) {
  const { setActivePane, setActiveWorkspace, updateWorkspacePaneTree } = useSession();

  const handleActivatePane = useCallback(
    (paneId: string) => {
      setActiveWorkspace(workspace.id);
      setActivePane(workspace.id, paneId);
    },
    [workspace.id, setActivePane, setActiveWorkspace]
  );

  const handleUpdateNode = useCallback(
    (nodeId: string, updater: (node: typeof workspace.rootPane) => typeof workspace.rootPane) => {
      updateWorkspacePaneTree(workspace.id, (root) => {
        if (root.id === nodeId) {
          return updater(root);
        }
        return updateNodeInTree(root, nodeId, updater);
      });
    },
    [workspace.id, updateWorkspacePaneTree]
  );

  return (
    <div className="workspace-container" onMouseDown={() => setActiveWorkspace(workspace.id)}>
      <PaneTree
        workspace={workspace}
        node={workspace.rootPane}
        isActive={true}
        activePaneId={workspace.activePaneId}
        onActivatePane={handleActivatePane}
        onUpdateNode={handleUpdateNode}
      />
    </div>
  );
}

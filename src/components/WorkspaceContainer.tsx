import { useCallback } from "react";
import { Workspace, PaneNode, Window } from "../types/session";
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
  const { setActiveWorkspace, setActiveWindow, setActivePane, updateWindowPaneTree } = useSession();

  const activeWindow = workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0] ?? null;

  const handleActivatePane = useCallback(
    (paneId: string) => {
      if (!activeWindow) return;
      setActiveWorkspace(workspace.id);
      setActiveWindow(workspace.id, activeWindow.id);
      setActivePane(workspace.id, activeWindow.id, paneId);
    },
    [workspace.id, activeWindow, setActiveWorkspace, setActiveWindow, setActivePane]
  );

  const handleUpdateNode = useCallback(
    (nodeId: string, updater: (node: typeof activeWindow.rootPane) => typeof activeWindow.rootPane) => {
      if (!activeWindow) return;
      updateWindowPaneTree(workspace.id, activeWindow.id, (root) => {
        if (root.id === nodeId) {
          return updater(root);
        }
        return updateNodeInTree(root, nodeId, updater);
      });
    },
    [workspace.id, activeWindow, updateWindowPaneTree]
  );

  return (
    <div className="workspace-container" onMouseDown={() => setActiveWorkspace(workspace.id)}>
      {workspace.windows.length > 1 && (
        <WindowTabBar
          windows={workspace.windows}
          activeWindowId={workspace.activeWindowId}
          onSelect={(windowId) => setActiveWindow(workspace.id, windowId)}
        />
      )}
      {activeWindow ? (
        <PaneTree
          workspace={workspace}
          windowId={activeWindow.id}
          node={activeWindow.rootPane}
          isActive={true}
          activePaneId={activeWindow.activePaneId}
          onActivatePane={handleActivatePane}
          onUpdateNode={handleUpdateNode}
        />
      ) : null}
    </div>
  );
}

interface WindowTabBarProps {
  windows: Window[];
  activeWindowId: string | null;
  onSelect: (windowId: string) => void;
}

function WindowTabBar({ windows, activeWindowId, onSelect }: WindowTabBarProps) {
  return (
    <div className="workspace-tabs window-tabs">
      {windows.map((window) => (
        <div
          key={window.id}
          className={`tab ${window.id === activeWindowId ? "active" : ""}`}
          role="tab"
          aria-selected={window.id === activeWindowId}
          tabIndex={0}
          onClick={() => onSelect(window.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(window.id);
            }
          }}
        >
          <span className="tab-title">{window.name}</span>
        </div>
      ))}
    </div>
  );
}


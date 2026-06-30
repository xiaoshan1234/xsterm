import { useShortcuts } from "./useShortcut";
import { useSession } from "../contexts/SessionContext";

export function useAppShortcuts({
  onCreateSession,
  onToggleLogs,
}: {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}) {
  const { workspaces, activeWorkspaceId, setActivePane, closeSession } = useSession();

  useShortcuts([
    { key: "n", ctrl: true, shift: true, handler: onCreateSession },
    {
      key: "Tab",
      ctrl: true,
      handler: () => {
        const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!workspace) return;
        const leafIds = collectLeafIds(workspace.rootPane);
        if (leafIds.length <= 1) return;
        const currentIndex = workspace.activePaneId
          ? leafIds.indexOf(workspace.activePaneId)
          : -1;
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % leafIds.length : 0;
        setActivePane(workspace.id, leafIds[nextIndex]);
      },
    },
    {
      key: "Tab",
      ctrl: true,
      shift: true,
      handler: () => {
        const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!workspace) return;
        const leafIds = collectLeafIds(workspace.rootPane);
        if (leafIds.length <= 1) return;
        const currentIndex = workspace.activePaneId
          ? leafIds.indexOf(workspace.activePaneId)
          : -1;
        const prevIndex = currentIndex >= 0
          ? (currentIndex - 1 + leafIds.length) % leafIds.length
          : leafIds.length - 1;
        setActivePane(workspace.id, leafIds[prevIndex]);
      },
    },
    {
      key: "w",
      ctrl: true,
      handler: () => {
        const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!workspace || !workspace.activePaneId) return;
        const pane = findPane(workspace.rootPane, workspace.activePaneId);
        if (pane?.sessionId !== undefined) {
          closeSession(pane.sessionId);
        }
      },
    },
    {
      key: "l",
      ctrl: true,
      handler: onToggleLogs,
    },
  ]);
}

function collectLeafIds(root: import("../types/session").PaneNode): string[] {
  const ids: string[] = [];
  const traverse = (node: import("../types/session").PaneNode) => {
    if (node.type === "leaf") {
      ids.push(node.id);
      return;
    }
    node.children?.forEach(traverse);
  };
  traverse(root);
  return ids;
}

function findPane(root: import("../types/session").PaneNode, id: string): import("../types/session").PaneNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findPane(child, id);
      if (found) return found;
    }
  }
  return null;
}

import { useShortcuts } from "./useShortcut";
import { useSession } from "../contexts/SessionContext";
import type { PaneNode, SplitDirection } from "../../../model/entities";

export function useAppShortcuts({
  onCreateSession,
  onToggleLogs,
}: {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}) {
  const { workspaces, activeWorkspaceId, setActivePane, closeSession, splitPane } = useSession();

  const activeWindowFor = (workspace: (typeof workspaces)[number]) =>
    workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0];

  // Ctrl+\ / Ctrl+Shift+\ split the active pane (vertical /
  // horizontal). The split is routed through `splitPane` which detects
  // tmux sessions via `supportsMultiplex` and dispatches to the
  // backend; non-multiplex sessions fall through to the existing
  // "open dialog and let the user pick a session" flow.
  const splitActivePane = (direction: SplitDirection): void => {
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!workspace) return;
    const window = activeWindowFor(workspace);
    if (!window || !window.activePaneId) return;
    const pane = findPane(window.rootPane, window.activePaneId);
    if (!pane || pane.type !== "leaf" || pane.sessionId === undefined) return;
    splitPane(workspace.id, window.id, pane.id, direction, pane.sessionId);
  };

  useShortcuts([
    { key: "n", ctrl: true, shift: true, handler: onCreateSession },
    {
      key: "Tab",
      ctrl: true,
      handler: () => {
        const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!workspace) return;
        const window = activeWindowFor(workspace);
        if (!window) return;
        const leafIds = collectLeafIds(window.rootPane);
        if (leafIds.length <= 1) return;
        const currentIndex = window.activePaneId ? leafIds.indexOf(window.activePaneId) : -1;
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % leafIds.length : 0;
        setActivePane(workspace.id, window.id, leafIds[nextIndex]);
      },
    },
    {
      key: "Tab",
      ctrl: true,
      shift: true,
      handler: () => {
        const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!workspace) return;
        const window = activeWindowFor(workspace);
        if (!window) return;
        const leafIds = collectLeafIds(window.rootPane);
        if (leafIds.length <= 1) return;
        const currentIndex = window.activePaneId ? leafIds.indexOf(window.activePaneId) : -1;
        const prevIndex =
          currentIndex >= 0
            ? (currentIndex - 1 + leafIds.length) % leafIds.length
            : leafIds.length - 1;
        setActivePane(workspace.id, window.id, leafIds[prevIndex]);
      },
    },
    {
      key: "w",
      ctrl: true,
      handler: () => {
        const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!workspace) return;
        const window = activeWindowFor(workspace);
        if (!window || !window.activePaneId) return;
        const pane = findPane(window.rootPane, window.activePaneId);
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
    {
      key: "\\",
      ctrl: true,
      handler: () => splitActivePane("vertical"),
    },
    {
      key: "\\",
      ctrl: true,
      shift: true,
      handler: () => splitActivePane("horizontal"),
    },
  ]);
}

function collectLeafIds(root: PaneNode): string[] {
  const ids: string[] = [];
  const traverse = (node: PaneNode) => {
    if (node.type === "leaf") {
      ids.push(node.id);
      return;
    }
    node.children?.forEach(traverse);
  };
  traverse(root);
  return ids;
}

function findPane(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findPane(child, id);
      if (found) return found;
    }
  }
  return null;
}

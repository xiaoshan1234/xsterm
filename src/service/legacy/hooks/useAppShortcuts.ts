import { useShortcuts } from "./useShortcut";
import { useSession } from "../contexts/SessionContext";
import type { PaneNode, SplitDirection } from "../../../model";
import type { Window } from "../../../model/window";

export function useAppShortcuts({
  onCreateSession,
  onToggleLogs,
}: {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}) {
  const { workspaces, activeWorkspaceId, setActivePane, closeSession, splitPane } = useSession();

  const activeWindowFor = (workspace: (typeof workspaces)[number]): Window | undefined =>
    workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0];

  const splitActivePane = (direction: SplitDirection): void => {
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!workspace) return;
    const window = activeWindowFor(workspace);
    if (!window || window.kind !== "terminal" || !window.activePaneId) return;
    const pane = findPane(window.rootPane, window.activePaneId);
    if (!pane || pane.kind !== "leaf" || pane.binding?.sessionId === undefined) return;
    splitPane(workspace.id, window.id, pane.id, direction, pane.binding.sessionId);
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
        if (!window || window.kind !== "terminal") return;
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
        if (!window || window.kind !== "terminal") return;
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
        if (!window || window.kind !== "terminal" || !window.activePaneId) return;
        const pane = findPane(window.rootPane, window.activePaneId);
        if (pane?.kind === "leaf" && pane.binding?.sessionId !== undefined) {
          closeSession(pane.binding.sessionId);
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
  const idList: string[] = [];
  const traverse = (node: PaneNode) => {
    if (node.kind === "leaf") {
      idList.push(node.id);
      return;
    }
    const children = node.kind === "split" ? node.layout.children : undefined;
    children?.forEach(traverse);
  };
  traverse(root);
  return idList;
}

function findPane(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  const children = root.kind === "split" ? root.layout.children : undefined;
  if (children) {
    for (const child of children) {
      const found = findPane(child, id);
      if (found) return found;
    }
  }
  return null;
}

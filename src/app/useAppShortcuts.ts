import { useShortcuts } from "../shared/hooks/useShortcut";
import { useTerminalRuntime, useWorkspaceLayout } from "../features/sessions";
import type { PaneNode, SplitDirection } from "../models/legacy/terminal";

export function useAppShortcuts({
  onCreateSession,
  onToggleLogs,
}: {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}) {
  const { closeTerminal } = useTerminalRuntime();
  const { workspaces, activeWorkspaceId, setActivePane, splitPane } = useWorkspaceLayout();

  const activeWindowFor = (workspace: (typeof workspaces)[number]) =>
    workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0];

  // Ctrl+\ / Ctrl+Shift+\ split the active pane (vertical /
  // horizontal). The split is routed through `splitPane` which detects
  // tmux terminals via `supportsMultiplex` and dispatches to the
  // backend; non-multiplex terminals fall through to the existing
  // "open dialog and let the user pick a terminal" flow.
  const splitActivePane = (direction: SplitDirection): void => {
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!workspace) return;
    const window = activeWindowFor(workspace);
    if (!window || !window.activePaneId) return;
    const pane = findPane(window.rootPane, window.activePaneId);
    if (!pane || pane.type !== "leaf" || pane.terminalId === undefined) return;
    splitPane(workspace.id, window.id, pane.id, direction, pane.terminalId);
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
        if (pane?.terminalId !== undefined) {
          closeTerminal(pane.terminalId);
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

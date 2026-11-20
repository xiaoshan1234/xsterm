import { useEffect, useMemo, useRef } from "react";
import type { PaneId } from "../../../models";
import {
  findMatchingKeybinding,
  useSessionPreferences,
  type AppKeybindingActionId,
} from "../../../features/settings";
import { useTerminalRuntime } from "../../../features/terminal";
import {
  useWorkspaceLayout,
  type EditablePaneNode,
  type PaneSplitDirection,
} from "../../../features/workspace";
import { chordFromKeyboardEvent } from "../../../shared/keyboard";

interface UseKeybindingDispatcherOptions {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}

export function useKeybindingDispatcher({
  onCreateSession,
  onToggleLogs,
}: UseKeybindingDispatcherOptions) {
  const { closeTerminal } = useTerminalRuntime();
  const { workspaces, activeWorkspaceId, setActivePane, splitPane } = useWorkspaceLayout();
  const { keybindings } = useSessionPreferences();

  const handlers = useMemo<Partial<Record<AppKeybindingActionId, () => void>>>(() => {
    const activeWindowFor = (workspace: (typeof workspaces)[number]) =>
      workspace.windows.find((window) => window.id === workspace.activeWindowId) ??
      workspace.windows[0];

    const splitActivePane = (direction: PaneSplitDirection): void => {
      const workspace = workspaces.find((candidate) => candidate.id === activeWorkspaceId);
      if (!workspace) return;
      const window = activeWindowFor(workspace);
      if (!window || !window.activePaneId) return;
      const pane = findPane(window.rootPane, window.activePaneId);
      if (!pane || pane.type !== "leaf" || pane.terminalId === undefined) return;
      splitPane(workspace.id, window.id, pane.id, direction, pane.terminalId);
    };

    const closeActivePane = (): void => {
      const workspace = workspaces.find((candidate) => candidate.id === activeWorkspaceId);
      if (!workspace) return;
      const window = activeWindowFor(workspace);
      if (!window || !window.activePaneId) return;
      const pane = findPane(window.rootPane, window.activePaneId);
      if (pane?.terminalId !== undefined) {
        closeTerminal(pane.terminalId);
      }
    };

    const cyclePane = (step: 1 | -1): void => {
      const workspace = workspaces.find((candidate) => candidate.id === activeWorkspaceId);
      if (!workspace) return;
      const window = activeWindowFor(workspace);
      if (!window) return;
      const leafIds = collectLeafIds(window.rootPane);
      if (leafIds.length <= 1) return;
      const currentIndex = window.activePaneId ? leafIds.indexOf(window.activePaneId) : -1;
      const nextIndex =
        currentIndex >= 0
          ? (currentIndex + step + leafIds.length) % leafIds.length
          : step === 1
            ? 0
            : leafIds.length - 1;
      setActivePane(workspace.id, window.id, leafIds[nextIndex]);
    };

    return {
      "app.newSession": onCreateSession,
      "app.closePane": closeActivePane,
      "app.toggleLogs": onToggleLogs,
      "app.nextPane": () => cyclePane(1),
      "app.prevPane": () => cyclePane(-1),
      "app.splitVertical": () => splitActivePane("vertical"),
      "app.splitHorizontal": () => splitActivePane("horizontal"),
    };
  }, [
    activeWorkspaceId,
    closeTerminal,
    onCreateSession,
    onToggleLogs,
    setActivePane,
    splitPane,
    workspaces,
  ]);

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTargetOutsideTerminal(event.target)) return;
      const chord = chordFromKeyboardEvent(event);
      const binding = findMatchingKeybinding(keybindings, chord, "app");
      if (!binding) return;
      event.preventDefault();
      handlersRef.current[binding.actionId as AppKeybindingActionId]?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keybindings]);
}

function isEditableTargetOutsideTerminal(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm")) return false;
  return target.closest("input, textarea, [contenteditable='true']") !== null;
}

function collectLeafIds(root: EditablePaneNode): PaneId[] {
  const leafIds: PaneId[] = [];
  const traverse = (node: EditablePaneNode) => {
    if (node.type === "leaf") {
      leafIds.push(node.id);
      return;
    }
    node.children?.forEach(traverse);
  };
  traverse(root);
  return leafIds;
}

function findPane(root: EditablePaneNode, id: PaneId): EditablePaneNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findPane(child, id);
    if (found) return found;
  }
  return null;
}

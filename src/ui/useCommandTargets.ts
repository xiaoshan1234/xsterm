import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaneNode } from "../model/pane";
import type { Window, Workspace } from "../model";
import {
  findFirstLeafWithSession,
  findPaneNode,
  forEachPane,
} from "../service/legacy/contexts/session/paneUtils";

function getLeafPanesWithSession(root: PaneNode): PaneNode[] {
  const panes: PaneNode[] = [];
  forEachPane(root, (node) => {
    if (node.kind === "leaf" && node.binding?.sessionId !== undefined) {
      panes.push(node);
    }
  });
  return panes;
}

function getTerminalRoot(window: Window): PaneNode | null {
  return window.kind === "terminal" ? window.rootPane : null;
}

function getDefaultPaneId(window: Window): string | null {
  const root = getTerminalRoot(window);
  if (!root) return null;
  if (window.activePaneId) {
    const pane = findPaneNode(root, window.activePaneId);
    if (pane?.kind === "leaf" && pane.binding?.sessionId !== undefined) {
      return pane.id;
    }
  }
  return findFirstLeafWithSession(root)?.id ?? null;
}

export interface CommandTargets {
  targetWindowId: string;
  setTargetWindowId: (id: string) => void;
  targetPaneId: string | null;
  setTargetPaneId: (id: string | null) => void;
  paneOptions: { pane: PaneNode; number: number }[];
  getTargetSessions: () => number[];
}

export function useCommandTargets(workspace: Workspace): CommandTargets {
  const [targetWindowId, setTargetWindowId] = useState<string>("active");
  const [targetPaneId, setTargetPaneId] = useState<string | null>("active");

  useEffect(() => {
    const resolvedWindowId =
      targetWindowId === "active" ? workspace.activeWindowId : targetWindowId;
    const selectedWindow = workspace.windows.find((w) => w.id === resolvedWindowId);

    if (!selectedWindow || selectedWindow.kind !== "terminal") {
      setTargetWindowId("active");
      setTargetPaneId("active");
      return;
    }

    const panes = getLeafPanesWithSession(selectedWindow.rootPane);
    if (panes.length === 0) {
      setTargetWindowId("active");
      setTargetPaneId("active");
      return;
    }

    if (targetPaneId !== "active") {
      const paneExists = panes.some((p) => p.id === targetPaneId);
      if (!paneExists) {
        setTargetPaneId("active");
      }
    }
  }, [workspace, targetWindowId, targetPaneId]);

  const getTargetSessions = useCallback((): number[] => {
    const resolvedWindowId =
      targetWindowId === "active" ? workspace.activeWindowId : targetWindowId;
    const selectedWindow = workspace.windows.find((w) => w.id === resolvedWindowId);
    if (!selectedWindow || selectedWindow.kind !== "terminal") return [];

    const resolvedPaneId = targetPaneId === "active" ? selectedWindow.activePaneId : targetPaneId;
    const pane = resolvedPaneId ? findPaneNode(selectedWindow.rootPane, resolvedPaneId) : null;
    if (pane && pane.kind === "leaf" && pane.binding?.sessionId !== undefined) {
      return [pane.binding.sessionId];
    }
    return [];
  }, [workspace, targetWindowId, targetPaneId]);

  const paneOptions = useMemo(() => {
    const resolvedWindowId =
      targetWindowId === "active" ? workspace.activeWindowId : targetWindowId;
    const selectedWindow = workspace.windows.find((w) => w.id === resolvedWindowId);
    if (!selectedWindow || selectedWindow.kind !== "terminal") return [];
    return getLeafPanesWithSession(selectedWindow.rootPane).map((pane, idx) => ({
      pane,
      number: idx + 1,
    }));
  }, [workspace, targetWindowId]);

  return {
    targetWindowId,
    setTargetWindowId,
    targetPaneId,
    setTargetPaneId,
    paneOptions,
    getTargetSessions,
  };
}

export { getLeafPanesWithSession, getDefaultPaneId };

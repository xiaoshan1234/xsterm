import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaneNode, Window, Workspace } from "../types/session";
import { findFirstLeafWithSession, findPaneNode, forEachPane } from "../contexts/session/paneUtils";

function getLeafPanesWithSession(root: PaneNode): PaneNode[] {
  const panes: PaneNode[] = [];
  forEachPane(root, (node) => {
    if (node.type === "leaf" && node.sessionId !== undefined) {
      panes.push(node);
    }
  });
  return panes;
}

function getDefaultPaneId(window: Window): string | null {
  if (window.activePaneId) {
    const pane = findPaneNode(window.rootPane, window.activePaneId);
    if (pane?.type === "leaf" && pane.sessionId !== undefined) {
      return pane.id;
    }
  }
  return findFirstLeafWithSession(window.rootPane)?.id ?? null;
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

    if (!selectedWindow) {
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
    if (!selectedWindow) return [];

    const resolvedPaneId =
      targetPaneId === "active" ? selectedWindow.activePaneId : targetPaneId;
    const pane = resolvedPaneId
      ? findPaneNode(selectedWindow.rootPane, resolvedPaneId)
      : null;
    if (pane && pane.type === "leaf" && pane.sessionId !== undefined) {
      return [pane.sessionId];
    }
    return [];
  }, [workspace, targetWindowId, targetPaneId]);

  const paneOptions = useMemo(() => {
    const resolvedWindowId =
      targetWindowId === "active" ? workspace.activeWindowId : targetWindowId;
    const selectedWindow = workspace.windows.find((w) => w.id === resolvedWindowId);
    if (!selectedWindow) return [];
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
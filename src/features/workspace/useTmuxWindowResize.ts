import { useEffect, useRef } from "react";
import { useTerminalRuntime } from "../sessions";
import { tmuxCommands, toBackendControllerHandle } from "../tmux/infrastructure";
import { type PaneNode, type Terminal, type Workspace } from "../../models/legacy/terminal";
import { computeTmuxWindowSize, type WindowSize } from "./tmuxWindowSize";

/**
 * Keep tmux window sizes in sync with the xsterm pane tree.
 *
 * Each leaf reports its fitted xterm dimensions. The root window size is the
 * bounding box of those leaves (sum along split axes, max across the other
 * axis). Sending `refresh-client -C` then lets tmux resize the attached window
 * instead of being stuck at the control client's spawn-time PTY size.
 */
export function useTmuxWindowResize(workspace: Workspace): void {
  const { terminals, terminalSizesRef, terminalSizesVersion } = useTerminalRuntime();
  const sentSizesRef = useRef<Map<string, WindowSize>>(new Map());

  useEffect(() => {
    // Coalesce per-pane resize reports so one container resize sends a single
    // final window size instead of a sequence of intermediate sizes.
    const timer = window.setTimeout(() => {
      const terminalsById = new Map(terminals.map((terminal) => [terminal.id, terminal]));

      for (const window of workspace.windows) {
        if (window.xstermWindowId === undefined) continue;
        const size = computeTmuxWindowSize(window.rootPane, terminalSizesRef.current);
        if (!size) continue;
        const controllerId = findControllerId(window.rootPane, terminalsById);
        if (controllerId === undefined) continue;

        const key = String(window.xstermWindowId);
        const previous = sentSizesRef.current.get(key);
        if (previous?.cols === size.cols && previous?.rows === size.rows) continue;
        sentSizesRef.current.set(key, size);

        void tmuxCommands
          .resizeTmuxWindow(toBackendControllerHandle(controllerId), size.cols, size.rows)
          .catch((error) => console.error("Failed to resize tmux window:", error));
      }
    }, 100);

    return () => window.clearTimeout(timer);
  }, [workspace, terminals, terminalSizesRef, terminalSizesVersion]);
}

function findControllerId(
  node: PaneNode,
  terminalsById: ReadonlyMap<number, Terminal>,
): number | undefined {
  if (node.type === "leaf") {
    if (node.terminalId === undefined) return undefined;
    return terminalsById.get(node.terminalId)?.tmuxSessionId;
  }
  for (const child of node.children ?? []) {
    const controllerId = findControllerId(child, terminalsById);
    if (controllerId !== undefined) return controllerId;
  }
  return undefined;
}

import { useEffect, useRef } from "react";
import { useTerminalRuntime } from "../../features/terminal";
import { useTmuxRuntime } from "../../features/tmux";
import { isTmuxPaneTerminal, type Terminal } from "../../features/terminal";
import type { EditablePaneNode, Workspace } from "../../features/workspace";
import { computeTmuxWindowSize, type WindowSize } from "../../features/workspace";

/**
 * Keep tmux window sizes in sync with the xsterm pane tree.
 *
 * Each leaf reports its fitted xterm dimensions. The root window size is the
 * bounding box of those leaves (sum along split axes, max across the other
 * axis). Sending `refresh-client -C` then lets tmux resize the attached window
 * instead of being stuck at the control client's spawn-time PTY size.
 */
export function useTmuxWindowResize(workspace: Workspace): void {
  const { terminals, getTerminalSize, terminalSizesVersion } = useTerminalRuntime();
  const { resizeTmuxWindow } = useTmuxRuntime();
  const sentSizesRef = useRef<Map<string, WindowSize>>(new Map());

  useEffect(() => {
    // Coalesce per-pane resize reports so one container resize sends a single
    // final window size instead of a sequence of intermediate sizes.
    const timer = window.setTimeout(() => {
      const terminalsById = new Map(terminals.map((terminal) => [terminal.id, terminal]));
      const terminalSizes = new Map(
        terminals.flatMap((terminal) => {
          const size = getTerminalSize(terminal.id);
          return size ? ([[terminal.id, size]] as const) : [];
        }),
      );

      for (const window of workspace.windows) {
        if (window.xstermWindowId === undefined) continue;
        const size = computeTmuxWindowSize(window.rootPane, terminalSizes);
        if (!size) continue;
        const controllerId = findControllerId(window.rootPane, terminalsById);
        if (controllerId === undefined) continue;

        const key = String(window.xstermWindowId);
        const previous = sentSizesRef.current.get(key);
        if (previous?.cols === size.cols && previous?.rows === size.rows) continue;
        sentSizesRef.current.set(key, size);

        void resizeTmuxWindow(controllerId, size.cols, size.rows).catch((error) =>
          console.error("Failed to resize tmux window:", error),
        );
      }
    }, 100);

    return () => window.clearTimeout(timer);
  }, [workspace, terminals, getTerminalSize, terminalSizesVersion, resizeTmuxWindow]);
}

function findControllerId(
  node: EditablePaneNode,
  terminalsById: ReadonlyMap<number, Terminal>,
): number | undefined {
  if (node.type === "leaf") {
    if (node.terminalId === undefined) return undefined;
    const terminal = terminalsById.get(node.terminalId);
    return terminal && isTmuxPaneTerminal(terminal) ? terminal.tmux.controllerId : undefined;
  }
  for (const child of node.children ?? []) {
    const controllerId = findControllerId(child, terminalsById);
    if (controllerId !== undefined) return controllerId;
  }
  return undefined;
}

import type { TerminalId } from "../../../models";
import type { EditablePaneNode } from "../../../features/workspace";
import {
  createEditableLeafPane,
  createEditableSplitNode,
  generatePaneId,
} from "../../../features/workspace";
import { parseTmuxGeometry, type TmuxGeometryNode } from "../../../features/tmux";

export interface TmuxPaneGeometry {
  terminalId: TerminalId;
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Build a frontend `EditablePaneNode` tree from tmux geometry, mapping each layout
 * leaf to a terminal via its rectangle. Falls back to a vertical stack so no
 * pane is hidden when the layout cannot be parsed.
 */
export function buildTmuxPaneTree(
  layout: string,
  panes: readonly TmuxPaneGeometry[],
  configId: string,
): EditablePaneNode | null {
  const geometry = parseTmuxGeometry(layout);
  if (!geometry || panes.length === 0) {
    return stackPanes(panes, configId);
  }

  const panesByRectangle = new Map(
    panes.map((pane) => [rectangleKey(pane.x, pane.y, pane.width, pane.height), pane]),
  );
  const node = buildNode(geometry, panesByRectangle, configId);
  return node ?? stackPanes(panes, configId);
}

function buildNode(
  geometry: TmuxGeometryNode,
  panesByRectangle: ReadonlyMap<string, TmuxPaneGeometry>,
  configId: string,
): EditablePaneNode | null {
  if (geometry.kind === "leaf") {
    const pane = panesByRectangle.get(
      rectangleKey(geometry.x, geometry.y, geometry.width, geometry.height),
    );
    if (!pane) return null;
    return createEditableLeafPane(generatePaneId(), 100, pane.terminalId, configId);
  }

  const first = buildNode(geometry.children[0], panesByRectangle, configId);
  const second = buildNode(geometry.children[1], panesByRectangle, configId);
  if (!first || !second) return null;

  const total = geometry.direction === "horizontal" ? geometry.width : geometry.height;
  const firstLength =
    geometry.direction === "horizontal" ? geometry.children[0].width : geometry.children[0].height;
  const firstPercent = total > 0 ? clampPercent(Math.round((firstLength / total) * 100)) : 50;
  first.size = firstPercent;
  second.size = 100 - firstPercent;
  return createEditableSplitNode(generatePaneId(), geometry.direction, first, second);
}

function stackPanes(panes: readonly TmuxPaneGeometry[], configId: string): EditablePaneNode | null {
  if (panes.length === 0) return null;
  if (panes.length === 1) {
    return createEditableLeafPane(generatePaneId(), 100, panes[0].terminalId, configId);
  }
  const percent = Math.floor(100 / panes.length);
  let root = createEditableLeafPane(generatePaneId(), percent, panes[0].terminalId, configId);
  for (let index = 1; index < panes.length; index++) {
    const size = index === panes.length - 1 ? 100 - percent * index : percent;
    const leaf = createEditableLeafPane(generatePaneId(), size, panes[index].terminalId, configId);
    root = createEditableSplitNode(generatePaneId(), "vertical", root, leaf);
  }
  return root;
}

function rectangleKey(x: number, y: number, width: number, height: number): string {
  return `${x},${y},${width},${height}`;
}

function clampPercent(value: number): number {
  return Math.max(10, Math.min(90, value));
}

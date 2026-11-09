import { type PaneNode, type SplitDirection } from "../../../models/legacy/terminal";
import { createLeafPane, createSplitNode } from "./paneUtils";

interface TmuxGeometryLeaf {
  kind: "leaf";
  width: number;
  height: number;
  x: number;
  y: number;
}

interface TmuxGeometrySplit {
  kind: "split";
  direction: SplitDirection;
  width: number;
  height: number;
  x: number;
  y: number;
  children: [TmuxGeometryNode, TmuxGeometryNode];
}

type TmuxGeometryNode = TmuxGeometryLeaf | TmuxGeometrySplit;

export interface TmuxPaneGeometry {
  terminalId: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface Cursor {
  pos: number;
}

/**
 * Parse tmux's `window_layout` string into a geometry tree. The layout string
 * describes only rectangles (`WxH,x,y` with nested `[child,child]` splits);
 * pane ids are matched separately from `list-panes` geometry.
 */
export function parseTmuxGeometry(layout: string): TmuxGeometryNode | null {
  const text = layout.trim();
  if (!text) return null;
  const firstComma = text.indexOf(",");
  const body = firstComma >= 0 ? text.slice(firstComma + 1) : text;
  return parseNode(body, { pos: 0 });
}

/**
 * Build a frontend `PaneNode` tree from tmux geometry, mapping each layout
 * leaf to a terminal via its rectangle. Falls back to a vertical stack so no
 * pane is hidden when the layout cannot be parsed.
 */
export function buildTmuxPaneTree(
  layout: string,
  panes: readonly TmuxPaneGeometry[],
  configId: string,
): PaneNode | null {
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
): PaneNode | null {
  if (geometry.kind === "leaf") {
    const pane = panesByRectangle.get(
      rectangleKey(geometry.x, geometry.y, geometry.width, geometry.height),
    );
    if (!pane) return null;
    return createLeafPane(100, pane.terminalId, configId);
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
  return createSplitNode(geometry.direction, first, second);
}

function stackPanes(panes: readonly TmuxPaneGeometry[], configId: string): PaneNode | null {
  if (panes.length === 0) return null;
  if (panes.length === 1) {
    return createLeafPane(100, panes[0].terminalId, configId);
  }
  const percent = Math.floor(100 / panes.length);
  let root = createLeafPane(percent, panes[0].terminalId, configId);
  for (let index = 1; index < panes.length; index++) {
    const size = index === panes.length - 1 ? 100 - percent * index : percent;
    const leaf = createLeafPane(size, panes[index].terminalId, configId);
    root = createSplitNode("vertical", root, leaf);
  }
  return root;
}

function parseNode(body: string, cursor: Cursor): TmuxGeometryNode | null {
  const size = parseSize(body, cursor);
  if (!size) return null;
  if (!consume(body, cursor, ",")) return null;
  const x = parseNumber(body, cursor);
  if (x === null) return null;
  if (!consume(body, cursor, ",")) return null;
  const y = parseNumber(body, cursor);
  if (y === null) return null;

  if (consume(body, cursor, ",")) {
    parseNumber(body, cursor);
    return { kind: "leaf", width: size.width, height: size.height, x, y };
  }

  if (consume(body, cursor, "[")) {
    const first = parseNode(body, cursor);
    if (!first || !consume(body, cursor, ",")) return null;
    const second = parseNode(body, cursor);
    if (!second || !consume(body, cursor, "]")) return null;
    return {
      kind: "split",
      direction: "vertical",
      width: size.width,
      height: size.height,
      x,
      y,
      children: [first, second],
    };
  }

  if (consume(body, cursor, "{")) {
    const first = parseNode(body, cursor);
    if (!first || !consume(body, cursor, ",")) return null;
    const second = parseNode(body, cursor);
    if (!second || !consume(body, cursor, "}")) return null;
    return {
      kind: "split",
      direction: "horizontal",
      width: size.width,
      height: size.height,
      x,
      y,
      children: [first, second],
    };
  }

  return null;
}

function parseSize(body: string, cursor: Cursor): { width: number; height: number } | null {
  const width = parseNumber(body, cursor);
  if (width === null) return null;
  if (!consume(body, cursor, "x")) return null;
  const height = parseNumber(body, cursor);
  if (height === null) return null;
  return { width, height };
}

function parseNumber(body: string, cursor: Cursor): number | null {
  const start = cursor.pos;
  while (cursor.pos < body.length && isDigit(body[cursor.pos])) {
    cursor.pos++;
  }
  if (cursor.pos === start) return null;
  return Number(body.slice(start, cursor.pos));
}

function consume(body: string, cursor: Cursor, expected: string): boolean {
  if (body[cursor.pos] === expected) {
    cursor.pos++;
    return true;
  }
  return false;
}

function rectangleKey(x: number, y: number, width: number, height: number): string {
  return `${x},${y},${width},${height}`;
}

function clampPercent(value: number): number {
  return Math.max(10, Math.min(90, value));
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

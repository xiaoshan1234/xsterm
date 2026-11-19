import type { SplitDirection } from "../../../models";

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

export type TmuxGeometryNode = TmuxGeometryLeaf | TmuxGeometrySplit;

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

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

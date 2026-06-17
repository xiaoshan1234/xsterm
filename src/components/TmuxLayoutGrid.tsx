import { TmuxPane } from "../types/session";
import Terminal from "./Terminal";
import "./TmuxLayoutGrid.css";

export interface LayoutCell {
  x: number;
  y: number;
  width: number;
  height: number;
  paneId?: string;
}

interface TmuxLayoutGridProps {
  sessionId: number;
  layout: string;
  panes: TmuxPane[];
  onClosePane?: (paneId: string) => void;
}

export function TmuxLayoutGrid({ sessionId, layout, panes, onClosePane }: TmuxLayoutGridProps) {
  const cells = parseTmuxLayout(layout);
  const paneMap = new Map(panes.map((p) => [p.id, p]));
  console.log("TmuxLayoutGrid cells:", cells.length, "paneIds:", cells.map((c) => c.paneId).join(","));

  return (
    <div className="tmux-layout-grid" style={{ position: "relative", width: "100%", height: "100%" }}>
      {cells
        .filter((cell) => cell.paneId && paneMap.has(cell.paneId))
        .map((cell) => {
          const pane = paneMap.get(cell.paneId!);
          return (
            <div
              key={cell.paneId}
              className="tmux-layout-cell"
              style={{
                position: "absolute",
                left: `${cell.x}%`,
                top: `${cell.y}%`,
                width: `${cell.width}%`,
                height: `${cell.height}%`,
              }}
            >
              <div className="tmux-pane-header">
                <span className="tmux-pane-title">
                  {pane?.inCopyMode && <span className="tmux-copy-mode-indicator">[COPY] </span>}
                  {pane?.title || cell.paneId}
                </span>
                {onClosePane && (
                  <button
                    className="tmux-pane-close"
                    onClick={() => onClosePane(cell.paneId!)}
                    title="Close pane"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="tmux-pane-terminal">
                <Terminal sessionId={sessionId} paneId={cell.paneId} />
              </div>
            </div>
          );
        })}
    </div>
  );
}

export function parseTmuxLayout(layout: string): LayoutCell[] {
  if (!layout) return [];

  // Layout format examples:
  // c226,200x56,0,0[200x27,0,0,0,200x28,0,28,1]
  // bb62,159x48,0,0{79x48,0,0,79x48,80,0}
  // First 4 hex chars are a checksum, then comma, then root cell description.
  const withoutChecksum = layout.replace(/^[0-9a-fA-F]{4},/, "");
  if (!withoutChecksum) return [];

  const root = parseCell(withoutChecksum);
  if (!root) return [];

  const cells: LayoutCell[] = [];
  collectLeafCells(root, cells);
  return cells;
}

interface ParsedCell {
  x: number;
  y: number;
  width: number;
  height: number;
  paneId?: string;
  children?: ParsedCell[];
}

function parseCell(input: string): ParsedCell | null {
  const match = input.match(/^([0-9]+)x([0-9]+),([0-9]+),([0-9]+)(?:,([0-9]+))?/);
  if (!match) return null;

  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  const x = parseInt(match[3], 10);
  const y = parseInt(match[4], 10);
  const paneId = match[5] ? `%${match[5]}` : undefined;

  let rest = input.slice(match[0].length);
  const children: ParsedCell[] = [];

  if (rest.startsWith("{") || rest.startsWith("[")) {
    const open = rest[0];
    const close = open === "{" ? "}" : "]";
    const innerEnd = findMatchingClose(rest, open, close);
    if (innerEnd < 0) return null;

    const inner = rest.slice(1, innerEnd);
    rest = rest.slice(innerEnd + 1);

    let childInput = inner;
    while (childInput.length > 0) {
      const child = parseCell(childInput);
      if (!child) break;
      children.push(child);
      const consumed = serializeCell(child);
      childInput = childInput.slice(consumed.length);
      if (childInput.startsWith(",")) {
        childInput = childInput.slice(1);
      } else {
        break;
      }
    }
  }

  return { x, y, width, height, paneId, children: children.length > 0 ? children : undefined };
}

function findMatchingClose(input: string, open: string, close: string): number {
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === open) depth++;
    else if (input[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function serializeCell(cell: ParsedCell): string {
  const panePart = cell.paneId ? `,${cell.paneId.slice(1)}` : "";
  let result = `${cell.width}x${cell.height},${cell.x},${cell.y}${panePart}`;
  if (cell.children) {
    const inner = cell.children.map(serializeCell).join(",");
    result += cell.children[0]?.x === cell.x ? `[${inner}]` : `{${inner}}`;
  }
  return result;
}

function collectLeafCells(cell: ParsedCell, out: LayoutCell[], parent?: ParsedCell) {
  const effectiveParent = parent || { x: 0, y: 0, width: cell.width, height: cell.height };

  if (!cell.children || cell.children.length === 0) {
    out.push({
      x: (cell.x / effectiveParent.width) * 100,
      y: (cell.y / effectiveParent.height) * 100,
      width: (cell.width / effectiveParent.width) * 100,
      height: (cell.height / effectiveParent.height) * 100,
      paneId: cell.paneId,
    });
    return;
  }

  for (const child of cell.children) {
    collectLeafCells(child, out, cell);
  }
}

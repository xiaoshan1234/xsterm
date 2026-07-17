import { useEffect, RefObject } from "react";
import { IDisposable, Terminal as XTerm } from "@xterm/xterm";

const HIGHLIGHT_BG = "#FFFF00";
const HIGHLIGHT_FG = "#000000";

export function parseKeywords(commaSeparated: string | undefined): string[] {
  if (!commaSeparated) return [];
  return commaSeparated
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

interface MatchRange {
  start: number;
  length: number;
}

function findKeywordRanges(text: string, keywords: string[]): MatchRange[] {
  const lowerText = text.toLowerCase();
  const ranges: MatchRange[] = [];

  for (const keyword of keywords) {
    const k = keyword.toLowerCase();
    let i = 0;
    while ((i = lowerText.indexOf(k, i)) !== -1) {
      ranges.push({ start: i, length: keyword.length });
      i += keyword.length;
    }
  }

  ranges.sort((a, b) => a.start - b.start);

  const merged: MatchRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.start + last.length) {
      const end = Math.max(last.start + last.length, r.start + r.length);
      last.length = end - last.start;
    } else {
      merged.push({ ...r });
    }
  }

  return merged;
}

function highlightLine(
  xterm: XTerm,
  lineY: number,
  keywords: string[],
  disposables: Set<IDisposable>
): void {
  const buffer = xterm.buffer.active;
  const line = buffer.getLine(lineY);
  if (!line) return;

  const text = line.translateToString(true);
  if (text.length === 0) return;

  const ranges = findKeywordRanges(text, keywords);
  if (ranges.length === 0) return;

  const cursorAbs = buffer.baseY + buffer.cursorY;
  const marker = xterm.registerMarker(lineY - cursorAbs);
  if (!marker || marker.isDisposed) return;
  disposables.add(marker);

  const cols = xterm.cols;
  for (const range of ranges) {
    const start = Math.max(0, Math.min(range.start, cols));
    const end = Math.min(range.start + range.length, cols);
    const width = Math.max(1, end - start);
    const decoration = xterm.registerDecoration({
      marker,
      x: start,
      width,
      backgroundColor: HIGHLIGHT_BG,
      foregroundColor: HIGHLIGHT_FG,
    });
    if (decoration) {
      disposables.add(decoration);
    }
  }
}

export function useKeywordHighlight(
  termRef: RefObject<XTerm | null>,
  keywords: string[]
): void {
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm || keywords.length === 0) return;

    const disposables = new Set<IDisposable>();

    const scanAll = () => {
      const buffer = xterm.buffer.active;
      for (let y = 0; y < buffer.length; y++) {
        highlightLine(xterm, y, keywords, disposables);
      }
    };

    const lineFeedDisposer = xterm.onLineFeed(() => {
      const buffer = xterm.buffer.active;
      const cursorAbs = buffer.baseY + buffer.cursorY;
      highlightLine(xterm, cursorAbs - 1, keywords, disposables);
    });

    scanAll();

    return () => {
      lineFeedDisposer.dispose();
      for (const d of disposables) {
        d.dispose();
      }
      disposables.clear();
    };
  }, [termRef, keywords]);
}

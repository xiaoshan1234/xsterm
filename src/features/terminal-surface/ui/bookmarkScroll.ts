import { type Terminal as XTerm } from "@xterm/xterm";

export interface BookmarkScrollTarget {
  line: number;
  text: string;
}

/**
 * Finds the absolute scrollback line whose text equals the needle (trailing
 * whitespace ignored), or undefined when no line matches.
 */
export function findLineIndexByText(term: XTerm, text: string): number | undefined {
  const needle = text.trimEnd();
  if (!needle) return undefined;
  const buffer = term.buffer.active;
  for (let y = buffer.baseY; y < buffer.baseY + buffer.length; y++) {
    const line = buffer.getLine(y);
    if (line && line.translateToString(true).trimEnd() === needle) return y;
  }
  return undefined;
}

/**
 * Scrolls to a bookmarked line. Falls back to a content search when the line
 * has been trimmed out of the scrollback buffer. Returns false when neither
 * the line nor the text can be located.
 */
export function scrollToBookmarkLine(term: XTerm, target: BookmarkScrollTarget): boolean {
  const buffer = term.buffer.active;
  if (buffer.getLine(target.line)) {
    term.scrollToLine(target.line);
    return true;
  }
  const found = findLineIndexByText(term, target.text);
  if (found !== undefined) {
    term.scrollToLine(found);
    return true;
  }
  return false;
}

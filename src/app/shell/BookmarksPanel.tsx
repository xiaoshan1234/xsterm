import type { TerminalId } from "../../models";
import "./BookmarksPanel.css";

export interface BookmarkItemViewData {
  id: string;
  line: number;
  text: string;
}

interface BookmarksPanelProps {
  terminalId?: TerminalId;
  items: readonly BookmarkItemViewData[];
  onJump: (line: number) => void;
}

function snippet(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "(empty)";
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

export function BookmarksPanel({ terminalId, items, onJump }: BookmarksPanelProps) {
  if (terminalId === undefined) {
    return <p className="bookmarks-panel-empty">No active terminal.</p>;
  }

  if (items.length === 0) {
    return (
      <p className="bookmarks-panel-empty">
        No bookmarks yet. Click a gutter line number to add one.
      </p>
    );
  }

  return (
    <ul className="bookmarks-panel-list">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="bookmarks-panel-item" onClick={() => onJump(item.line)}>
            <span className="bookmarks-panel-line">L{item.line + 1}</span>
            <span className="bookmarks-panel-tag">{snippet(item.text)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

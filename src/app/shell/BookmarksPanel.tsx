import type { TerminalId } from "../../models";
import { useBookmarkNavigation } from "./bookmarkNavigation";
import "./BookmarksPanel.css";

export interface BookmarkItemViewData {
  id: string;
  line: number;
  text: string;
}

interface BookmarksPanelProps {
  terminalId?: TerminalId;
  items: readonly BookmarkItemViewData[];
  onRemove: (line: number) => void;
  onClear: () => void;
}

function snippet(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "(empty)";
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

export function BookmarksPanel({ terminalId, items, onRemove, onClear }: BookmarksPanelProps) {
  const { currentLine, jumpTo } = useBookmarkNavigation();

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
    <>
      <button type="button" className="bookmarks-panel-clear" onClick={onClear}>
        Clear all
      </button>
      <ul className="bookmarks-panel-list">
        {items.map((item) => (
          <li key={item.id} className="bookmarks-panel-row">
            <button
              type="button"
              className={`bookmarks-panel-item${
                item.line === currentLine ? " bookmarks-panel-item--active" : ""
              }`}
              onClick={() => jumpTo(item.line, item.text)}
            >
              <span className="bookmarks-panel-line">L{item.line + 1}</span>
              <span className="bookmarks-panel-tag">{snippet(item.text)}</span>
            </button>
            <button
              type="button"
              className="bookmarks-panel-remove"
              aria-label={`Remove bookmark ${item.line + 1}`}
              title="Remove bookmark"
              onClick={() => onRemove(item.line)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

import { useState } from "react";
import { PlusIcon, CloseIcon } from "./icons/Icon";
import { TmuxWindow } from "../types/session";
import "./TmuxWindowTabs.css";

interface TmuxWindowTabsProps {
  windows: TmuxWindow[];
  activeWindowId: string | null;
  onSelect: (windowId: string) => void;
  onCreate: () => void;
  onClose: (windowId: string) => void;
}

export function TmuxWindowTabs({
  windows,
  activeWindowId,
  onSelect,
  onCreate,
  onClose,
}: TmuxWindowTabsProps) {
  const [closingId, setClosingId] = useState<string | null>(null);

  const handleClose = (e: React.MouseEvent, windowId: string) => {
    e.stopPropagation();
    if (closingId === windowId) {
      onClose(windowId);
      setClosingId(null);
    } else {
      setClosingId(windowId);
      setTimeout(() => setClosingId((current) => (current === windowId ? null : current)), 2000);
    }
  };

  return (
    <div className="tmux-window-tabs">
      {windows.map((window) => (
        <button
          key={window.id}
          className={`tmux-window-tab ${window.id === activeWindowId ? "active" : ""}`}
          onClick={() => onSelect(window.id)}
          title={window.name}
        >
          <span className="tmux-window-tab__name">{window.name || window.id}</span>
          <span
            className={`tmux-window-tab__close ${closingId === window.id ? "confirm" : ""}`}
            onClick={(e) => handleClose(e, window.id)}
            title={closingId === window.id ? "Click again to close" : "Close window"}
          >
            <CloseIcon size={10} />
          </span>
        </button>
      ))}
      <button className="tmux-window-tab tmux-window-tab--new" onClick={onCreate} title="New window">
        <PlusIcon size={10} />
      </button>
    </div>
  );
}

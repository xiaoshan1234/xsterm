import { PlusIcon, CloseIcon } from "./icons/Icon";
import { TmuxWindow } from "../types/tmux";
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
  const handleClose = (e: React.MouseEvent, windowId: string, windowName: string) => {
    e.stopPropagation();
    if (window.confirm(`Close window "${windowName || windowId}"?`)) {
      onClose(windowId);
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
            className="tmux-window-tab__close"
            onClick={(e) => handleClose(e, window.id, window.name)}
            title="Close window"
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

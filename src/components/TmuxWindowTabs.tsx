import { useRef } from "react";
import { PlusIcon, CloseIcon } from "./icons/Icon";
import { TmuxWindow, TmuxState } from "../types/tmux";
import { ContextMenu, ContextMenuItem, ContextMenuRef } from "./ui/ContextMenu";
import "./TmuxWindowTabs.css";

interface TmuxWindowTabsProps {
  tmuxState: TmuxState;
  windows: TmuxWindow[];
  activeWindowId: string | null;
  onSelect: (windowId: string) => void;
  onCreate: () => void;
  onClose: (windowId: string) => void;
}

export function TmuxWindowTabs({
  tmuxState,
  windows,
  activeWindowId,
  onSelect,
  onCreate,
  onClose,
}: TmuxWindowTabsProps) {
  const contextMenuRef = useRef<ContextMenuRef>(null);
  const handleClose = (e: React.MouseEvent, windowId: string, windowName: string) => {
    e.stopPropagation();
    if (window.confirm(`Close window "${windowName || windowId}"?`)) {
      onClose(windowId);
    }
  };

  const getWindowLabel = (window: TmuxWindow): string => {
    const session = tmuxState.sessions.get(window.sessionId);
    const sessionName = session?.name || window.sessionId;
    return `${sessionName}:${window.name || window.id}`;
  };

  const tabItems: ContextMenuItem[] = [
    { label: "New Window", onClick: onCreate },
  ];

  return (
    <ContextMenu ref={contextMenuRef} items={tabItems}>
      <div className="tmux-window-tabs">
        {windows.map((window) => (
          <button
            key={window.id}
            className={`tmux-window-tab ${window.id === activeWindowId ? "active" : ""}`}
            onClick={() => onSelect(window.id)}
            title={getWindowLabel(window)}
          >
            <span className="tmux-window-tab__name">{getWindowLabel(window)}</span>
            <span
              className="tmux-window-tab__close"
              onClick={(e) => handleClose(e, window.id, getWindowLabel(window))}
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
    </ContextMenu>
  );
}

import { useRef } from "react";
import type { Window } from "../types/session";
import { ContextMenu, type ContextMenuItem, type ContextMenuRef } from "./ui/ContextMenu";
import { PlusIcon, SaveIcon, CloseIcon } from "./icons/Icon";
import "./TabBar.css";

interface WindowTabBarProps {
  workspace: { windows: Window[]; name?: string };
  activeWindowId: string | null;
  onSelect: (windowId: string) => void;
  onAdd: () => void;
  onSaveAll: () => void;
  onSaveWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
  onRenameWindow: (windowId: string) => void;
}

export function WindowTabBar({
  workspace,
  activeWindowId,
  onSelect,
  onAdd,
  onSaveAll,
  onSaveWindow,
  onCloseWindow,
  onRenameWindow,
}: WindowTabBarProps) {
  return (
    <div className="workspace-tabs window-tabs">
      {workspace.windows.map((window) => (
        <WindowTab
          key={window.id}
          window={window}
          isActive={window.id === activeWindowId}
          onSelect={() => onSelect(window.id)}
          onSave={() => onSaveWindow(window.id)}
          onClose={() => onCloseWindow(window.id)}
          onRename={() => onRenameWindow(window.id)}
        />
      ))}
      <div className="window-tab-actions">
        <button className="window-tab-action" type="button" onClick={onAdd} title="New window">
          <PlusIcon size={14} />
        </button>
        <button
          className="window-tab-action"
          type="button"
          onClick={onSaveAll}
          title="Save all windows as workspace"
        >
          <SaveIcon size={14} />
        </button>
      </div>
    </div>
  );
}

interface WindowTabProps {
  window: Window;
  isActive: boolean;
  onSelect: () => void;
  onSave: () => void;
  onRename: () => void;
  onClose: () => void;
}

export function WindowTab({
  window,
  isActive,
  onSelect,
  onSave,
  onRename,
  onClose,
}: WindowTabProps) {
  const contextMenuRef = useRef<ContextMenuRef>(null);
  const contextMenuItems: ContextMenuItem[] = [
    { label: "Rename", onClick: onRename },
    { label: "Save as Window Config", onClick: onSave },
    { label: "Close", onClick: onClose, danger: true },
  ];

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <ContextMenu ref={contextMenuRef} items={contextMenuItems}>
      <div
        className={`tab ${isActive ? "active" : ""}`}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="tab-title">{window.name}</span>
        <button
          className="tab-close"
          type="button"
          onClick={handleCloseClick}
          aria-label={`Close window ${window.name}`}
          title="Close window"
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </ContextMenu>
  );
}

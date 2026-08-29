import { useRef, useState } from "react";
import type { Window } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { ContextMenu, type ContextMenuItem, type ContextMenuRef } from "./ui/ContextMenu";
import { PlusIcon, SaveIcon, CloseIcon } from "./icons/Icon";
import "./TabBar.css";

interface WindowTabBarProps {
  workspaceId: string;
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
  workspaceId,
  workspace,
  activeWindowId,
  onSelect,
  onAdd,
  onSaveAll,
  onSaveWindow,
  onCloseWindow,
  onRenameWindow,
}: WindowTabBarProps) {
  const { reorderWindows } = useSession();
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: "before" | "after" } | null>(
    null,
  );

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    setDraggingIndex(index);
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const position: "before" | "after" = e.clientX < midpoint ? "before" : "after";
    setDropTarget({ index, position });
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === index) {
      setDraggingIndex(null);
      setDropTarget(null);
      return;
    }
    const resolved = dropTarget?.index === index ? dropTarget : { index, position: "before" as const };
    let toIndex = resolved.position === "before" ? index : index + 1;
    // When dragging forward, removing the source shifts subsequent indices down by 1.
    if (draggingIndex < toIndex) toIndex -= 1;
    if (draggingIndex !== toIndex) {
      reorderWindows(workspaceId, draggingIndex, toIndex);
    }
    setDraggingIndex(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDropTarget(null);
  };

  return (
    <div
      ref={tabsContainerRef}
      className="workspace-tabs window-tabs"
      style={{ touchAction: "pan-y" }}
      onWheel={(e) => {
        // Respect native trackpad horizontal scroll
        if (Math.abs(e.deltaX) > 0) return;
        const el = tabsContainerRef.current;
        if (!el) return;
        // Only intercept when overflow exists
        if (el.scrollWidth <= el.clientWidth) return;
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }}
    >
      {workspace.windows.map((window, index) => (
        <WindowTab
          key={window.id}
          window={window}
          position={index + 1}
          isActive={window.id === activeWindowId}
          isDragging={draggingIndex === index}
          dropIndicatorPosition={dropTarget?.index === index ? dropTarget.position : null}
          onSelect={() => onSelect(window.id)}
          onSave={() => onSaveWindow(window.id)}
          onClose={() => onCloseWindow(window.id)}
          onRename={() => onRenameWindow(window.id)}
          onDragStart={handleDragStart(index)}
          onDragOver={handleDragOver(index)}
          onDrop={handleDrop(index)}
          onDragEnd={handleDragEnd}
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
  position: number;
  isActive: boolean;
  isDragging?: boolean;
  dropIndicatorPosition?: "before" | "after" | null;
  onSelect: () => void;
  onSave: () => void;
  onRename: () => void;
  onClose: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

export function WindowTab({
  window,
  position,
  isActive,
  isDragging,
  dropIndicatorPosition,
  onSelect,
  onSave,
  onRename,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
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

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    onDragStart?.(e);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onDragOver?.(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDrop?.(e);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    onDragEnd?.(e);
  };

  return (
    <ContextMenu ref={contextMenuRef} items={contextMenuItems}>
      <div
        className={`tab ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""}`}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        draggable={true}
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {dropIndicatorPosition === "before" && <div className="tab-drop-indicator" />}
        <span className="tab-title">{position}. {window.name}</span>
        <button
          className="tab-close"
          type="button"
          onClick={handleCloseClick}
          aria-label={`Close window ${window.name}`}
          title="Close window"
        >
          <CloseIcon size={12} />
        </button>
        {dropIndicatorPosition === "after" && <div className="tab-drop-indicator" />}
      </div>
    </ContextMenu>
  );
}

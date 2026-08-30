import { useRef, useState } from "react";
import type { Window } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { ContextMenu, type ContextMenuItem, type ContextMenuRef } from "./ui/ContextMenu";
import { PlusIcon, SaveIcon, CloseIcon } from "./icons/Icon";
import "./TabBar.css";

// Mouse-vs-drag movement threshold (px). Clicks below this are treated as
// plain clicks (→ onSelect), not drag-reorders.
const DRAG_CLICK_THRESHOLD_PX = 4;

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
  // Drag origin: which tab index was grabbed, and where the cursor started.
  // Using a ref so the document-level mousemove/mouseup handlers always see
  // the value at the moment the drag began (avoids stale closure captures).
  const dragStartRef = useRef<{ index: number; startX: number; startY: number } | null>(null);

  const handleMouseMove = (e: MouseEvent) => {
    const drag = dragStartRef.current;
    if (!drag) return;
    // Find which tab is under the cursor via [data-tab-index] hit-testing.
    const tabs = tabsContainerRef.current?.querySelectorAll<HTMLElement>("[data-tab-index]");
    if (!tabs) return;
    for (const tab of Array.from(tabs)) {
      const idx = Number(tab.dataset.tabIndex);
      const rect = tab.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        const midpoint = rect.left + rect.width / 2;
        const position: "before" | "after" = e.clientX < midpoint ? "before" : "after";
        setDropTarget({ index: idx, position });
        return;
      }
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    const drag = dragStartRef.current;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);

    if (!drag) {
      setDraggingIndex(null);
      setDropTarget(null);
      return;
    }

    // Click-vs-drag: only commit a reorder if the cursor moved beyond the
    // threshold between mousedown and mouseup. Anything below = plain click
    // (the synthetic onClick handler will still fire and run onSelect).
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const movedFar = Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD_PX;

    if (movedFar && dropTarget && dropTarget.index !== drag.index) {
      let toIndex = dropTarget.position === "before" ? dropTarget.index : dropTarget.index + 1;
      // When dragging forward, removing the source shifts subsequent indices down by 1.
      if (drag.index < toIndex) toIndex -= 1;
      if (drag.index !== toIndex) {
        reorderWindows(workspaceId, drag.index, toIndex);
      }
    }

    setDraggingIndex(null);
    setDropTarget(null);
    dragStartRef.current = null;
  };

  const handleTabMouseDown = (index: number) => (e: React.MouseEvent) => {
    // Only left-click initiates drag. Right-click is owned by ContextMenu,
    // middle-click by the close-on-wheel handler.
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartRef.current = { index, startX: e.clientX, startY: e.clientY };
    setDraggingIndex(index);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div className="window-tabs-wrapper">
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
            onMouseDown={handleTabMouseDown(index)}
          />
        ))}
      </div>
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
  onMouseDown?: (e: React.MouseEvent) => void;
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
  onMouseDown,
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
    onMouseDown?.(e);
  };

  return (
    <ContextMenu ref={contextMenuRef} items={contextMenuItems}>
      <div
        className={`tab ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""}`}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        data-tab-index={position - 1}
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

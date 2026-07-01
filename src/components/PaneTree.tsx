import { useCallback, useRef, useEffect, MouseEvent as ReactMouseEvent } from "react";
import { PaneNode, Workspace } from "../types/session";
import { Pane } from "./Pane";

interface PaneTreeProps {
  workspace: Workspace;
  node: PaneNode;
  isActive: boolean;
  activePaneId: string | null;
  onActivatePane: (paneId: string) => void;
  onUpdateNode: (nodeId: string, updater: (node: PaneNode) => PaneNode) => void;
}

export function PaneTree({
  workspace,
  node,
  isActive,
  activePaneId,
  onActivatePane,
  onUpdateNode,
}: PaneTreeProps) {
  if (node.type === "leaf") {
    return (
      <Pane
        workspace={workspace}
        pane={node}
        isActive={isActive && activePaneId === node.id}
        onActivate={() => onActivatePane(node.id)}
      />
    );
  }

  return (
    <SplitNode
      workspace={workspace}
      node={node}
      isActive={isActive}
      activePaneId={activePaneId}
      onActivatePane={onActivatePane}
      onUpdateNode={onUpdateNode}
    />
  );
}

interface SplitNodeProps {
  workspace: Workspace;
  node: PaneNode;
  isActive: boolean;
  activePaneId: string | null;
  onActivatePane: (paneId: string) => void;
  onUpdateNode: (nodeId: string, updater: (node: PaneNode) => PaneNode) => void;
}

function SplitNode({
  workspace,
  node,
  isActive,
  activePaneId,
  onActivatePane,
  onUpdateNode,
}: SplitNodeProps) {
  const direction = node.direction ?? "horizontal";
  const children = node.children ?? [];
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragHandlersRef = useRef<
    { move: (e: MouseEvent) => void; up: () => void } | null
  >(null);

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent, childIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const container = containerRef.current;
      if (!container || children.length < 2) return;

      const totalSize = children[childIndex].size + children[childIndex + 1].size;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const currentContainer = containerRef.current;
        if (!currentContainer) return;

        const rect = currentContainer.getBoundingClientRect();
        const clientXY = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
        const startXY = direction === "horizontal" ? rect.left : rect.top;
        const length = direction === "horizontal" ? rect.width : rect.height;
        if (length === 0) return;

        const pct = ((clientXY - startXY) / length) * 100;
        const clampedPct = Math.max(10, Math.min(totalSize - 10, pct));

        onUpdateNode(node.id, (current) => {
          if (!current.children) return current;
          const updatedChildren = [...current.children];
          updatedChildren[childIndex] = { ...updatedChildren[childIndex], size: clampedPct };
          updatedChildren[childIndex + 1] = {
            ...updatedChildren[childIndex + 1],
            size: totalSize - clampedPct,
          };
          return { ...current, children: updatedChildren };
        });
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        dragHandlersRef.current = null;
      };

      dragHandlersRef.current = { move: handleMouseMove, up: handleMouseUp };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [direction, children, node.id, onUpdateNode]
  );

  useEffect(() => {
    return () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (dragHandlersRef.current) {
        window.removeEventListener("mousemove", dragHandlersRef.current.move);
        window.removeEventListener("mouseup", dragHandlersRef.current.up);
        dragHandlersRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`pane-tree-split pane-tree-split--${direction}`}
    >
      {children.map((child, index) => (
        <div
          key={child.id}
          className="pane-tree-child"
          style={{
            [direction === "horizontal" ? "width" : "height"]: `${child.size}%`,
          }}
        >
          <PaneTree
            workspace={workspace}
            node={child}
            isActive={isActive}
            activePaneId={activePaneId}
            onActivatePane={onActivatePane}
            onUpdateNode={onUpdateNode}
          />
          {index < children.length - 1 && (
            <div
              className={`pane-tree-resize-handle pane-tree-resize-handle--${direction}`}
              onMouseDown={(e) => handleResizeStart(e, index)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

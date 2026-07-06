import { useCallback, useRef, MouseEvent as ReactMouseEvent } from "react";
import { PaneNode, Workspace } from "../types/session";
import { useDragResize } from "../hooks/useDragResize";
import { Pane } from "./Pane";

interface PaneTreeProps {
  workspace: Workspace;
  windowId: string;
  node: PaneNode;
  isActive: boolean;
  activePaneId: string | null;
  onActivatePane: (paneId: string) => void;
  onUpdateNode: (nodeId: string, updater: (node: PaneNode) => PaneNode) => void;
}

export function PaneTree({
  workspace,
  windowId,
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
        windowId={windowId}
        pane={node}
        isActive={isActive && activePaneId === node.id}
        onActivate={() => onActivatePane(node.id)}
      />
    );
  }

  return (
    <SplitNode
      workspace={workspace}
      windowId={windowId}
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
  windowId: string;
  node: PaneNode;
  isActive: boolean;
  activePaneId: string | null;
  onActivatePane: (paneId: string) => void;
  onUpdateNode: (nodeId: string, updater: (node: PaneNode) => PaneNode) => void;
}

function SplitNode({
  workspace,
  windowId,
  node,
  isActive,
  activePaneId,
  onActivatePane,
  onUpdateNode,
}: SplitNodeProps) {
  const direction = node.direction ?? "horizontal";
  const children = node.children ?? [];
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(0);

  const { start: startResize } = useDragResize({
    direction,
    onDelta: ({ clientX, clientY }) => {
      const container = containerRef.current;
      const childIndex = activeIndexRef.current;
      if (!container || children.length < 2) return;

      const rect = container.getBoundingClientRect();
      const clientXY = direction === "horizontal" ? clientX : clientY;
      const startXY = direction === "horizontal" ? rect.left : rect.top;
      const length = direction === "horizontal" ? rect.width : rect.height;
      if (length === 0) return;

      const pct = ((clientXY - startXY) / length) * 100;
      const totalSize = children[childIndex].size + children[childIndex + 1].size;
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
    },
  });

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent, childIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      activeIndexRef.current = childIndex;
      const totalSize = children[childIndex].size + children[childIndex + 1].size;
      startResize(totalSize, e);
    },
    [children, startResize]
  );

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
            windowId={windowId}
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

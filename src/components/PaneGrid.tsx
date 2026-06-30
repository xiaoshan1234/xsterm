import { useMemo, useRef, useCallback, useState, useEffect, type CSSProperties } from "react";
import { Session, SessionPane, PaneLayout } from "../types/session";
import { getVisiblePanes } from "../contexts/SessionContext";
import TabBar from "./TabBar";
import Terminal from "./Terminal";
import { TmuxSessionView } from "./TmuxSessionView";
import { useSession } from "../contexts/SessionContext";
import "../styles/layout.css";

interface PaneGridProps {
  sessions: Session[];
  activeSessionId: number | null;
  paneLayout: PaneLayout;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onReorder: (pane: SessionPane, fromIndex: number, toIndex: number) => void;
  onMoveToPane: (sessionId: number, pane: SessionPane) => void;
}

function getGridStyle(layout: PaneLayout, colSize: number, rowSize: number) {
  switch (layout) {
    case "1":
      return { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" };
    case "2-v":
      return { gridTemplateColumns: `${colSize}% ${100 - colSize}%`, gridTemplateRows: "1fr" };
    case "2-h":
      return { gridTemplateColumns: "1fr", gridTemplateRows: `${rowSize}% ${100 - rowSize}%` };
    case "3-left-big":
    case "3-right-big":
    case "3-top-big":
    case "3-bottom-big":
    case "4":
      return {
        gridTemplateColumns: `${colSize}% ${100 - colSize}%`,
        gridTemplateRows: `${rowSize}% ${100 - rowSize}%`,
      };
    default:
      return { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" };
  }
}

function getPanePlacement(pane: SessionPane, layout: PaneLayout) {
  switch (layout) {
    case "1":
      return { gridColumn: "1 / 2" as const, gridRow: "1 / 2" as const };
    case "2-v":
      return pane === 1
        ? { gridColumn: "1 / 2" as const, gridRow: "1 / 2" as const }
        : { gridColumn: "2 / 3" as const, gridRow: "1 / 2" as const };
    case "2-h":
      return pane === 1
        ? { gridColumn: "1 / 2" as const, gridRow: "1 / 2" as const }
        : { gridColumn: "1 / 2" as const, gridRow: "2 / 3" as const };
    case "3-left-big":
      if (pane === 1) return { gridColumn: "1 / 2" as const, gridRow: "1 / 3" as const };
      if (pane === 2) return { gridColumn: "2 / 3" as const, gridRow: "1 / 2" as const };
      return { gridColumn: "2 / 3" as const, gridRow: "2 / 3" as const };
    case "3-right-big":
      if (pane === 1) return { gridColumn: "1 / 2" as const, gridRow: "1 / 2" as const };
      if (pane === 2) return { gridColumn: "1 / 2" as const, gridRow: "2 / 3" as const };
      return { gridColumn: "2 / 3" as const, gridRow: "1 / 3" as const };
    case "3-top-big":
      if (pane === 1) return { gridColumn: "1 / 3" as const, gridRow: "1 / 2" as const };
      if (pane === 2) return { gridColumn: "1 / 2" as const, gridRow: "2 / 3" as const };
      return { gridColumn: "2 / 3" as const, gridRow: "2 / 3" as const };
    case "3-bottom-big":
      if (pane === 1) return { gridColumn: "1 / 2" as const, gridRow: "1 / 2" as const };
      if (pane === 2) return { gridColumn: "2 / 3" as const, gridRow: "1 / 2" as const };
      return { gridColumn: "1 / 3" as const, gridRow: "2 / 3" as const };
    case "4":
      if (pane === 1) return { gridColumn: "1 / 2" as const, gridRow: "1 / 2" as const };
      if (pane === 2) return { gridColumn: "2 / 3" as const, gridRow: "1 / 2" as const };
      if (pane === 3) return { gridColumn: "1 / 2" as const, gridRow: "2 / 3" as const };
      return { gridColumn: "2 / 3" as const, gridRow: "2 / 3" as const };
  }
}

export default function PaneGrid({
  sessions,
  activeSessionId,
  paneLayout,
  onSelect,
  onClose,
  onRename,
  onReorder,
  onMoveToPane,
}: PaneGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [colSize, setColSize] = useState(50);
  const [rowSize, setRowSize] = useState(50);
  const isDraggingColRef = useRef(false);
  const isDraggingRowRef = useRef(false);

  const visiblePanes = useMemo(() => getVisiblePanes(paneLayout), [paneLayout]);

  const sessionsByPane = useMemo(() => {
    const map = new Map<SessionPane, Session[]>();
    for (const pane of visiblePanes) {
      map.set(
        pane,
        sessions.filter((s) => (s.pane ?? 1) === pane)
      );
    }
    return map;
  }, [sessions, visiblePanes]);

  const handleColResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingColRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handleRowResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRowRef.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();

      if (isDraggingColRef.current) {
        const x = e.clientX - rect.left;
        const pct = Math.max(10, Math.min(90, (x / rect.width) * 100));
        setColSize(pct);
      }

      if (isDraggingRowRef.current) {
        const y = e.clientY - rect.top;
        const pct = Math.max(10, Math.min(90, (y / rect.height) * 100));
        setRowSize(pct);
      }
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    isDraggingColRef.current = false;
    isDraggingRowRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const gridStyle = getGridStyle(paneLayout, colSize, rowSize);
  const showColHandle =
    paneLayout === "2-v" ||
    paneLayout === "3-left-big" ||
    paneLayout === "3-right-big" ||
    paneLayout === "3-top-big" ||
    paneLayout === "3-bottom-big" ||
    paneLayout === "4";
  const showRowHandle =
    paneLayout === "2-h" ||
    paneLayout === "3-left-big" ||
    paneLayout === "3-right-big" ||
    paneLayout === "3-top-big" ||
    paneLayout === "3-bottom-big" ||
    paneLayout === "4";

  let colHandleStyle: CSSProperties = { left: `${colSize}%` };
  if (paneLayout === "3-top-big") {
    colHandleStyle = { left: `${colSize}%`, top: `${rowSize}%`, bottom: 0 };
  } else if (paneLayout === "3-bottom-big") {
    colHandleStyle = { left: `${colSize}%`, top: 0, bottom: `${100 - rowSize}%` };
  }

  let rowHandleStyle: CSSProperties = { top: `${rowSize}%` };
  if (paneLayout === "3-left-big") {
    rowHandleStyle = { top: `${rowSize}%`, left: `${colSize}%`, right: 0 };
  } else if (paneLayout === "3-right-big") {
    rowHandleStyle = { top: `${rowSize}%`, left: 0, right: `${100 - colSize}%` };
  }

  return (
    <div className="pane-grid" ref={gridRef} style={gridStyle}>
      {visiblePanes.map((pane) => {
        const placement = getPanePlacement(pane, paneLayout);
        return (
          <div key={pane} className="pane" style={{ gridColumn: placement.gridColumn, gridRow: placement.gridRow }}>
            <TabBar
              sessions={sessionsByPane.get(pane) ?? []}
              activeId={activeSessionId}
              activeView="terminal"
              showSettingsTab={false}
              pane={pane}
              visiblePanes={visiblePanes}
              onSelect={onSelect}
              onClose={onClose}
              onRename={onRename}
              onSelectSettings={() => {}}
              onReorder={(fromIndex, toIndex) => onReorder(pane, fromIndex, toIndex)}
              onMoveToPane={onMoveToPane}
            />
            <div className="pane-content">
              <PaneContent pane={pane} sessions={sessionsByPane.get(pane) ?? []} activeSessionId={activeSessionId} />
            </div>
          </div>
        );
      })}
      {showColHandle && (
        <div
          className="pane-resize-handle pane-resize-handle--col"
          style={colHandleStyle}
          onMouseDown={handleColResizeStart}
          title="拖拽调整列宽"
        />
      )}
      {showRowHandle && (
        <div
          className="pane-resize-handle pane-resize-handle--row"
          style={rowHandleStyle}
          onMouseDown={handleRowResizeStart}
          title="拖拽调整行高"
        />
      )}
    </div>
  );
}

interface PaneContentProps {
  pane: SessionPane;
  sessions: Session[];
  activeSessionId: number | null;
}

function PaneContent({ pane, sessions, activeSessionId }: PaneContentProps) {
  const {
    tmuxState,
    activeTmuxWindowIds,
    setActiveTmuxWindow,
    createTmuxWindow,
    closeTmuxWindow,
    closeTmuxPane,
  } = useSession();

  if (sessions.length === 0) {
    return (
      <div className="pane-empty">
        <span>Pane {pane}</span>
        <span className="pane-empty-hint">No sessions</span>
      </div>
    );
  }

  const session = sessions.find((s) => s.id === activeSessionId);

  if (!session) {
    return (
      <div className="pane-empty">
        <span>Select a tab</span>
      </div>
    );
  }

  if (session.type === "tmux" || session.type === "ssh_tmux") {
    return (
      <TmuxSessionView
        key={session.id}
        session={session}
        isActive={true}
        tmuxState={tmuxState}
        activeTmuxWindowIds={activeTmuxWindowIds}
        setActiveTmuxWindow={setActiveTmuxWindow}
        createTmuxWindow={createTmuxWindow}
        closeTmuxWindow={closeTmuxWindow}
        closeTmuxPane={closeTmuxPane}
      />
    );
  }

  return (
    <div key={session.id} className="terminal-pane terminal-pane--active">
      <Terminal sessionId={session.id} sessionType={session.type} />
    </div>
  );
}

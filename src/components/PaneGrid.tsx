import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { Session, SessionPane } from "../types/session";
import TabBar from "./TabBar";
import Terminal from "./Terminal";
import { TmuxSessionView } from "./TmuxSessionView";
import { useSession } from "../contexts/SessionContext";
import "../styles/layout.css";

interface PaneGridProps {
  sessions: Session[];
  activeSessionId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onReorder: (pane: SessionPane, fromIndex: number, toIndex: number) => void;
  onMoveToPane: (sessionId: number, pane: SessionPane) => void;
}

const PANES: SessionPane[] = [1, 2, 3, 4];

export default function PaneGrid({
  sessions,
  activeSessionId,
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

  const sessionsByPane = useMemo(() => {
    const map = new Map<SessionPane, Session[]>();
    for (const pane of PANES) {
      map.set(
        pane,
        sessions.filter((s) => (s.pane ?? 1) === pane)
      );
    }
    return map;
  }, [sessions]);

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

  const handleMouseMove = useCallback((e: MouseEvent) => {
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
  }, []);

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

  return (
    <div
      className="pane-grid"
      ref={gridRef}
      style={{
        gridTemplateColumns: `${colSize}% ${100 - colSize}%`,
        gridTemplateRows: `${rowSize}% ${100 - rowSize}%`,
      }}
    >
      {PANES.map((pane) => (
        <div key={pane} className="pane">
          <TabBar
            sessions={sessionsByPane.get(pane) ?? []}
            activeId={activeSessionId}
            activeView="terminal"
            showSettingsTab={false}
            pane={pane}
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
      ))}
      <div
        className="pane-resize-handle pane-resize-handle--col"
        style={{ left: `${colSize}%` }}
        onMouseDown={handleColResizeStart}
        title="拖拽调整列宽"
      />
      <div
        className="pane-resize-handle pane-resize-handle--row"
        style={{ top: `${rowSize}%` }}
        onMouseDown={handleRowResizeStart}
        title="拖拽调整行高"
      />
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

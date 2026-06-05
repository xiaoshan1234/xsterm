import { useState, MouseEvent, useEffect } from "react";
import { Session } from "../types/session";

interface TabBarProps {
  sessions: Session[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onRename?: (id: number, name: string) => void;
}

export default function TabBar({ sessions, activeId, onSelect, onClose, onRename }: TabBarProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || editingId !== null) return;
      if (e.key !== "Tab") return;

      e.preventDefault();
      if (sessions.length === 0) return;

      const currentIndex = sessions.findIndex((s) => s.id === activeId);
      if (currentIndex === -1) {
        onSelect(sessions[0].id);
        return;
      }

      if (e.shiftKey) {
        const prevIndex = currentIndex === 0 ? sessions.length - 1 : currentIndex - 1;
        onSelect(sessions[prevIndex].id);
      } else {
        const nextIndex = currentIndex === sessions.length - 1 ? 0 : currentIndex + 1;
        onSelect(sessions[nextIndex].id);
      }
    };

    const container = document.querySelector(".tab-bar") as HTMLElement | null;
    container?.addEventListener("keydown", handleKeyDown as EventListener);
    return () => container?.removeEventListener("keydown", handleKeyDown as EventListener);
  }, [sessions, activeId, onSelect, editingId]);

  const getIcon = (type: "local" | "ssh") => {
    return type === "local" ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  };

  const handleMiddleClick = (e: MouseEvent, sessionId: number) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(sessionId);
    }
  };

  const handleDoubleClick = (session: Session) => {
    setEditingId(session.id);
    setEditValue(session.name);
  };

  const handleEditSubmit = (sessionId: number) => {
    if (editValue.trim() && onRename) {
      onRename(sessionId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, sessionId: number) => {
    if (e.key === "Enter") {
      handleEditSubmit(sessionId);
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  return (
    <div className="tab-bar">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`tab ${session.id === activeId ? "active" : ""}`}
          onClick={() => onSelect(session.id)}
          onMouseDown={(e) => handleMiddleClick(e, session.id)}
          onDoubleClick={() => handleDoubleClick(session)}
        >
          <span className="tab-icon">{getIcon(session.type)}</span>
          {editingId === session.id ? (
            <input
              type="text"
              className="tab-title-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleEditSubmit(session.id)}
              onKeyDown={(e) => handleEditKeyDown(e, session.id)}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tab-title">{session.name}</span>
          )}
          {!session.is_connected && <span className="tab-disconnected">!</span>}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(session.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

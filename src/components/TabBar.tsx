import { MouseEvent, useState } from "react";
import { Session } from "../types/session";
import { LocalSessionIcon, SshSessionIcon, TmuxSessionIcon, SshTmuxSessionIcon, CloseIcon } from "./icons/Icon";
import "./TabBar.css";

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
          <span className="tab-icon">
            {session.type === "local" ? (
              <LocalSessionIcon size={14} />
            ) : session.type === "ssh" ? (
              <SshSessionIcon size={14} />
            ) : session.type === "tmux" ? (
              <TmuxSessionIcon size={14} />
            ) : (
              <SshTmuxSessionIcon size={14} />
            )}
          </span>
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
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

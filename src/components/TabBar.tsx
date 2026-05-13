import { Session } from "../types/session";

interface TabBarProps {
  sessions: Session[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
}

export default function TabBar({ sessions, activeId, onSelect, onClose }: TabBarProps) {
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

  return (
    <div className="tab-bar">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`tab ${session.id === activeId ? "active" : ""}`}
          onClick={() => onSelect(session.id)}
        >
          <span className="tab-icon">{getIcon(session.type)}</span>
          <span className="tab-title">{session.name}</span>
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
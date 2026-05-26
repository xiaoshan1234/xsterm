import { useState } from "react";
import { useSession } from "../contexts/SessionContext";

interface SidebarProps {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}

export default function Sidebar({ onCreateSession, onToggleLogs }: SidebarProps) {
  const { sessions, activeSessionId, setActiveSession } = useSession();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const ChatIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );

  const SettingsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );

  const LogIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );

  const LocalIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );

  const SshIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );

  const handleMenuClick = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  return (
    <div className={`sidebar ${activeMenu ? "expanded" : ""}`}>
      <div className="sidebar-toolbar">
        <div className="sidebar-section">
          <button
            className={`sidebar-btn ${activeMenu === "chat" ? "active" : ""}`}
            onClick={() => handleMenuClick("chat")}
            title="Session Manager"
          >
            <ChatIcon />
          </button>
          <button
            className="sidebar-btn"
            onClick={onToggleLogs}
            title="Toggle Logs (Ctrl+L)"
          >
            <LogIcon />
          </button>
          <button
            className={`sidebar-btn ${activeMenu === "settings" ? "active" : ""}`}
            onClick={() => handleMenuClick("settings")}
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section sidebar-sessions">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`sidebar-session-btn ${session.id === activeSessionId ? "active" : ""}`}
              onClick={() => setActiveSession(session.id)}
              title={session.name}
            >
              {session.type === "local" ? <LocalIcon /> : <SshIcon />}
            </button>
          ))}
        </div>
      </div>

      {activeMenu === "chat" && (
        <div className="sidebar-submenu">
          <div className="submenu-header">Session Manager</div>
          <button
            className="submenu-item"
            onClick={() => {
              setActiveMenu(null);
              onCreateSession();
            }}
          >
            New Session
          </button>
          <button className="submenu-item" onClick={() => setActiveMenu(null)}>
            Session History
          </button>
          <button className="submenu-item" onClick={() => setActiveMenu(null)}>
            Search Sessions
          </button>
        </div>
      )}

      {activeMenu === "settings" && (
        <div className="sidebar-submenu">
          <div className="submenu-header">Settings</div>
          <button className="submenu-item" onClick={() => setActiveMenu(null)}>
            Appearance
          </button>
          <button className="submenu-item" onClick={() => setActiveMenu(null)}>
            Terminal
          </button>
          <button className="submenu-item" onClick={() => setActiveMenu(null)}>
            Shortcuts
          </button>
          <button className="submenu-item" onClick={() => setActiveMenu(null)}>
            About
          </button>
        </div>
      )}
    </div>
  );
}

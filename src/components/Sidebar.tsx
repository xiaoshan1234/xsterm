import { useState, useRef, useCallback, useEffect } from "react";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { PRESET_THEMES } from "../types/theme";
import { SavedSessionConfig } from "../types/session";

interface SidebarProps {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}

const TOOLBAR_WIDTH = 48;
const MIN_SUBMENU_WIDTH = 140;
const MAX_SUBMENU_WIDTH = 400;
const DEFAULT_SUBMENU_WIDTH = 200;

function getConfigIcon(type: "local" | "ssh") {
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
}

export default function Sidebar({ onCreateSession, onToggleLogs }: SidebarProps) {
  const { sessions, savedConfigs, activeSessionId, setActiveSession, groups, connectConfig, removeConfig, createGroup, toggleGroup, closeSession } = useSession();
  const { currentTheme, currentThemeKey, setTheme, themeKeys } = useTheme();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [expandedSettingsItem, setExpandedSettingsItem] = useState<string | null>(null);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const [submenuWidth, setSubmenuWidth] = useState(DEFAULT_SUBMENU_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const isConnected = (config: SavedSessionConfig) =>
    sessions.some((s) => s.configId === config.id);

  const handleCreateGroup = () => {
    setGroupError("");
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setGroupError("Group name is required");
      return;
    }
    if (groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
      setGroupError("A group with this name already exists");
      return;
    }
    createGroup(trimmed);
    setNewGroupName("");
    setShowNewGroupDialog(false);
  };

  const handleConfigClick = (config: SavedSessionConfig) => {
    if (isConnected(config)) {
      const session = sessions.find((s) => s.configId === config.id);
      if (session) {
        setActiveSession(session.id);
        setActiveMenu(null);
      }
    } else {
      connectConfig(config.id).then(() => setActiveMenu(null)).catch(console.error);
    }
  };

  const handleConfigClose = (config: SavedSessionConfig) => {
    if (isConnected(config)) {
      const session = sessions.find((s) => s.configId === config.id);
      if (session) closeSession(session.id);
    } else {
      removeConfig(config.id);
    }
  };

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = submenuWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [submenuWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.max(MIN_SUBMENU_WIDTH, Math.min(MAX_SUBMENU_WIDTH, dragStartWidth.current + delta));
      setSubmenuWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

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

  const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );

  const FolderIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );

  const CloseIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );

  const PlusIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );

  const handleMenuClick = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const sidebarWidth = activeMenu ? TOOLBAR_WIDTH + submenuWidth : TOOLBAR_WIDTH;

  return (
    <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
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
              {getConfigIcon(session.type)}
            </button>
          ))}
        </div>
      </div>

      {activeMenu === "chat" && (
        <div className="sidebar-submenu" style={{ width: submenuWidth }}>
          <div className="submenu-header">Session Manager</div>
          <div className="session-history">
            {groups.map((group) => (
              <div key={group.id} className="session-group">
                <button
                  className="session-group-header"
                  onClick={() => toggleGroup(group.id)}
                >
                  <ChevronIcon expanded={!group.collapsed} />
                  <FolderIcon />
                  <span className="session-group-name">{group.name}</span>
                  <span className="session-group-count">{group.configIds.length}</span>
                </button>
                {!group.collapsed && (
                  <div className="session-group-items">
                    {savedConfigs
                      .filter((c) => group.configIds.includes(c.id))
                      .map((config) => (
                        <div key={config.id} className="session-item">
                          <span className="session-item-indent" />
                          {getConfigIcon(config.type)}
                          <span
                            className={`session-item-name ${!isConnected(config) ? "disconnected" : ""}`}
                            onClick={() => handleConfigClick(config)}
                          >
                            {config.name}
                          </span>
                          <button
                            className="session-item-close"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfigClose(config);
                            }}
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
            {savedConfigs
              .filter((c) => !groups.some((g) => g.configIds.includes(c.id)))
              .map((config) => (
                <div key={config.id} className="session-item uncategorized">
                  {getConfigIcon(config.type)}
                  <span
                    className={`session-item-name ${!isConnected(config) ? "disconnected" : ""}`}
                    onClick={() => handleConfigClick(config)}
                  >
                    {config.name}
                  </span>
                  <button
                    className="session-item-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConfigClose(config);
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            <div className="session-divider" />
            <button className="submenu-item new-group-btn" onClick={() => setShowNewGroupDialog(true)}>
              <PlusIcon />
              New Group
            </button>
            <button className="submenu-item new-session-btn" onClick={onCreateSession}>
              <PlusIcon />
              New Session
            </button>
          </div>
        </div>
      )}

      {activeMenu === "settings" && (
        <div className="sidebar-submenu" style={{ width: submenuWidth }}>
          <div className="submenu-header">Settings</div>
          <div className="submenu-item-with-submenu">
            <button
              className="submenu-item"
              onClick={() => setExpandedSettingsItem(expandedSettingsItem === "appearance" ? null : "appearance")}
            >
              Appearance
              <span className="submenu-item-arrow">{expandedSettingsItem === "appearance" ? "▲" : "▼"}</span>
            </button>
            {expandedSettingsItem === "appearance" && (
              <div className="submenu-nested">
                {themeKeys.map((key) => (
                  <button
                    key={key}
                    className={`submenu-item ${currentThemeKey === key ? "active" : ""}`}
                    onClick={() => {
                      setTheme(key);
                      setActiveMenu(null);
                    }}
                  >
                    <span
                      className="theme-color-preview"
                      style={{ backgroundColor: currentTheme.background, border: `1px solid ${currentTheme.foreground}` }}
                    />
                    {PRESET_THEMES[key].name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="submenu-item-with-submenu">
            <button
              className="submenu-item"
              onClick={() => setExpandedSettingsItem(expandedSettingsItem === "shortcuts" ? null : "shortcuts")}
            >
              Shortcuts
              <span className="submenu-item-arrow">{expandedSettingsItem === "shortcuts" ? "▲" : "▼"}</span>
            </button>
            {expandedSettingsItem === "shortcuts" && (
              <div className="submenu-nested shortcuts-list">
                <div className="shortcut-item">
                  <span className="shortcut-label">New session</span>
                  <span className="shortcut-keys">Ctrl+Shift+N</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">Next tab</span>
                  <span className="shortcut-keys">Ctrl+Tab</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">Previous tab</span>
                  <span className="shortcut-keys">Ctrl+Shift+Tab</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">Close current tab</span>
                  <span className="shortcut-keys">Ctrl+W</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">Open settings</span>
                  <span className="shortcut-keys">Ctrl+,</span>
                </div>
              </div>
            )}
          </div>
          <button className="submenu-item" onClick={() => setActiveMenu(null)}>
            About
          </button>
        </div>
      )}

      {activeMenu && (
        <div
          className="sidebar-resize-handle"
          onMouseDown={handleResizeMouseDown}
        />
      )}

      {showNewGroupDialog && (
        <div className="dialog-overlay" onClick={() => setShowNewGroupDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Create Group</h2>
              <button className="dialog-close" onClick={() => { setShowNewGroupDialog(false); setGroupError(""); }}>×</button>
            </div>
            {groupError && <div className="dialog-error">{groupError}</div>}
            <div className="dialog-content">
              <div className="form-group">
                <label>Group Name</label>
                <input
                  type="text"
                  placeholder="e.g., Work, Personal"
                  value={newGroupName}
                  onChange={(e) => { setNewGroupName(e.target.value); setGroupError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
                  autoFocus
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button className="btn-cancel" onClick={() => setShowNewGroupDialog(false)}>
                Cancel
              </button>
              <button className="btn-create" onClick={handleCreateGroup}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
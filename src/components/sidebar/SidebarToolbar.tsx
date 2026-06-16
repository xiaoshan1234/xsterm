import { useState, useRef, useCallback, useEffect } from "react";
import { ChatIcon, SettingsIcon, LogIcon, LocalSessionIcon, SshSessionIcon, TmuxSessionIcon } from "../icons/Icon";

export type SidebarMenu = "chat" | "settings";

interface SidebarToolbarProps {
  activeMenu: SidebarMenu | null;
  onMenuClick: (menu: SidebarMenu) => void;
  sessions: { id: number; type: "local" | "ssh" | "tmux"; name: string }[];
  activeSessionId: number | null;
  onSelectSession: (id: number) => void;
  onToggleLogs: () => void;
  onCreateSession: () => void;
}

export function SidebarToolbar({
  activeMenu,
  onMenuClick,
  sessions,
  activeSessionId,
  onSelectSession,
  onToggleLogs,
}: SidebarToolbarProps) {
  return (
    <div className="sidebar-toolbar">
      <div className="sidebar-section">
        <button
          className={`sidebar-btn ${activeMenu === "chat" ? "active" : ""}`}
          onClick={() => onMenuClick("chat")}
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
          onClick={() => onMenuClick("settings")}
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
            onClick={() => onSelectSession(session.id)}
            title={session.name}
          >
            {session.type === "local" ? (
              <LocalSessionIcon size={14} />
            ) : session.type === "ssh" ? (
              <SshSessionIcon size={14} />
            ) : (
              <TmuxSessionIcon size={14} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ResizeHandleProps {
  onResize: (width: number) => void;
  minWidth: number;
  maxWidth: number;
}

export function ResizeHandle({ onResize, minWidth, maxWidth }: ResizeHandleProps) {
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = 0; // Will be set by parent before drag starts via onResize
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    []
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, dragStartWidth.current + delta));
      onResize(newWidth);
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
  }, [minWidth, maxWidth, onResize]);

  return (
    <div
      className="sidebar-resize-handle"
      onMouseDown={handleMouseDown}
    />
  );
}

export function useSidebarResize(
  defaultWidth: number,
  minWidth: number,
  maxWidth: number
) {
  const [width, setWidth] = useState(defaultWidth);

  const handleResizeStart = useCallback((startWidth: number) => {
    // Placeholder for future external control if needed.
    void startWidth;
  }, []);

  return {
    width,
    setWidth,
    handleResizeStart,
    ResizeHandleComponent: (
      <ResizeHandle onResize={(newWidth) => {
        handleResizeStart(width);
        setWidth(newWidth);
      }} minWidth={minWidth} maxWidth={maxWidth} />
    ),
  };
}

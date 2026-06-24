import { useState, useCallback } from "react";
import { SidebarToolbar } from "./SidebarToolbar";
import { SessionManager } from "./SessionManager";
import { SettingsPanel } from "./SettingsPanel";
import "./Sidebar.css";

const TOOLBAR_WIDTH = 48;
const MIN_SUBMENU_WIDTH = 140;
const MAX_SUBMENU_WIDTH = 400;
const DEFAULT_SUBMENU_WIDTH = 200;

interface SidebarProps {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}

export default function Sidebar({ onCreateSession, onToggleLogs }: SidebarProps) {
  const [activeMenu, setActiveMenu] = useState<"chat" | "settings" | null>(null);
  const [submenuWidth, setSubmenuWidth] = useState(DEFAULT_SUBMENU_WIDTH);

  const handleMenuClick = (menu: "chat" | "settings") => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const handleResize = useCallback((newWidth: number) => {
    setSubmenuWidth(Math.max(MIN_SUBMENU_WIDTH, Math.min(MAX_SUBMENU_WIDTH, newWidth)));
  }, []);

  const sidebarWidth = activeMenu ? TOOLBAR_WIDTH + submenuWidth : TOOLBAR_WIDTH;

  return (
    <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <SidebarToolbar
        activeMenu={activeMenu}
        onMenuClick={handleMenuClick}
        onToggleLogs={onToggleLogs}
      />

      {activeMenu === "chat" && <SessionManager width={submenuWidth} onCreateSession={onCreateSession} />}
      {activeMenu === "settings" && <SettingsPanel onClose={() => setActiveMenu(null)} />}

      {activeMenu && (
        <div
          className="sidebar-resize-handle"
          onMouseDown={(e) => {
            e.preventDefault();
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            const startX = e.clientX;
            const startWidth = submenuWidth;

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const delta = moveEvent.clientX - startX;
              handleResize(startWidth + delta);
            };

            const handleMouseUp = () => {
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
        />
      )}
    </div>
  );
}

import { useState, useCallback, useRef, useEffect } from "react";
import { SavedWorkspace, Workspace } from "../../types/session";
import { SidebarToolbar, SidebarMenu } from "./SidebarToolbar";
import { SessionManager } from "./SessionManager";
import { WorkspaceManager } from "./WorkspaceManager";
import "./Sidebar.css";

const TOOLBAR_WIDTH = 48;
const MIN_SUBMENU_WIDTH = 140;
const MAX_SUBMENU_WIDTH = 400;
const DEFAULT_SUBMENU_WIDTH = 200;

type SettingsCategory = "appearance" | "shortcuts" | "about";

interface SidebarProps {
  onCreateSession: () => void;
  onCreateSessionWithGroup: (groupId: number) => void;
  onToggleLogs: () => void;
  sidebarPanel: SidebarMenu | null;
  onSidebarPanelChange: (panel: SidebarMenu | null) => void;
  activeSettingsCategory?: SettingsCategory;
  onSelectSettingsCategory?: (category: SettingsCategory) => void;
  savedWorkspaces: SavedWorkspace[];
  loadWorkspace: (id: string) => Promise<Workspace>;
  deleteSavedWorkspace: (id: string) => void;
  renameSavedWorkspace: (id: string, name: string) => void;
}

const SETTINGS_CATEGORIES: { key: SettingsCategory; label: string }[] = [
  { key: "appearance", label: "Appearance" },
  { key: "shortcuts", label: "Shortcuts" },
  { key: "about", label: "About" },
];

export default function Sidebar({
  onCreateSession,
  onCreateSessionWithGroup,
  onToggleLogs,
  sidebarPanel,
  onSidebarPanelChange,
  activeSettingsCategory = "appearance",
  onSelectSettingsCategory,
  savedWorkspaces,
  loadWorkspace,
  deleteSavedWorkspace,
  renameSavedWorkspace,
}: SidebarProps) {
  const [submenuWidth, setSubmenuWidth] = useState(DEFAULT_SUBMENU_WIDTH);
  const dragHandlersRef = useRef<
    { move: (e: MouseEvent) => void; up: () => void } | null
  >(null);

  useEffect(() => {
    return () => {
      if (dragHandlersRef.current) {
        document.removeEventListener("mousemove", dragHandlersRef.current.move);
        document.removeEventListener("mouseup", dragHandlersRef.current.up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        dragHandlersRef.current = null;
      }
    };
  }, []);

  const handleMenuClick = (menu: SidebarMenu) => {
    onSidebarPanelChange(sidebarPanel === menu ? null : menu);
  };

  const handleResize = useCallback((newWidth: number) => {
    setSubmenuWidth(Math.max(MIN_SUBMENU_WIDTH, Math.min(MAX_SUBMENU_WIDTH, newWidth)));
  }, []);

  const sidebarWidth = sidebarPanel ? TOOLBAR_WIDTH + submenuWidth : TOOLBAR_WIDTH;

  return (
    <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <SidebarToolbar
        activeMenu={sidebarPanel}
        onMenuClick={handleMenuClick}
        onToggleLogs={onToggleLogs}
      />

      {sidebarPanel === "chat" && (
        <div className="sidebar-submenu" style={{ width: submenuWidth }}>
          <SessionManager
            onCreateSession={onCreateSession}
            onCreateSessionWithGroup={onCreateSessionWithGroup}
          />
        </div>
      )}

      {sidebarPanel === "workspace" && (
        <div className="sidebar-submenu" style={{ width: submenuWidth }}>
          <WorkspaceManager
            savedWorkspaces={savedWorkspaces}
            loadWorkspace={loadWorkspace}
            deleteSavedWorkspace={deleteSavedWorkspace}
            renameSavedWorkspace={renameSavedWorkspace}
          />
        </div>
      )}

      {sidebarPanel === "settings" && (
        <div className="sidebar-submenu" style={{ width: submenuWidth }}>
          <div className="submenu-header">Settings</div>
          {SETTINGS_CATEGORIES.map((category) => (
            <button
              key={category.key}
              className={`submenu-item ${activeSettingsCategory === category.key ? "active" : ""}`}
              onClick={() => onSelectSettingsCategory?.(category.key)}
            >
              {category.label}
            </button>
          ))}
        </div>
      )}

      {sidebarPanel && (
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
              dragHandlersRef.current = null;
            };

            dragHandlersRef.current = { move: handleMouseMove, up: handleMouseUp };
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
        />
      )}
    </div>
  );
}

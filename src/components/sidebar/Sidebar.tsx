import { useState, useCallback } from "react";
import { SavedWindowConfig, SavedWorkspace, Workspace } from "../../types/session";
import { useDragResize } from "../../hooks/useDragResize";
import { SidebarToolbar, SidebarMenu } from "./SidebarToolbar";
import { SessionManager } from "./SessionManager";
import { WorkspaceManager } from "./WorkspaceManager";
import { WindowManager } from "./WindowManager";
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
  savedWindowConfigs: SavedWindowConfig[];
  loadWindow: (id: string) => Promise<void>;
  deleteSavedWindow: (id: string) => void;
  renameSavedWindow: (id: string, name: string) => void;
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
  savedWindowConfigs,
  loadWindow,
  deleteSavedWindow,
  renameSavedWindow,
}: SidebarProps) {
  const [submenuWidth, setSubmenuWidth] = useState(DEFAULT_SUBMENU_WIDTH);

  const handleMenuClick = (menu: SidebarMenu) => {
    onSidebarPanelChange(sidebarPanel === menu ? null : menu);
  };

  const handleResize = useCallback((newWidth: number) => {
    setSubmenuWidth(Math.max(MIN_SUBMENU_WIDTH, Math.min(MAX_SUBMENU_WIDTH, newWidth)));
  }, []);

  const { start: startResize } = useDragResize({
    direction: "horizontal",
    onDelta: ({ delta, initialValue }) => {
      handleResize(initialValue + delta);
    },
  });

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

      {sidebarPanel === "windows" && (
        <div className="sidebar-submenu" style={{ width: submenuWidth }}>
          <WindowManager
            savedWindowConfigs={savedWindowConfigs}
            loadWindow={loadWindow}
            deleteSavedWindow={deleteSavedWindow}
            renameSavedWindow={renameSavedWindow}
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
          onMouseDown={(e) => startResize(submenuWidth, e)}
        />
      )}
    </div>
  );
}

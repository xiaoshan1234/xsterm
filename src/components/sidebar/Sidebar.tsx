import { useState, useCallback } from "react";
import { Box, Drawer, Divider } from "@mui/material";
import { SidebarToolbar, SidebarMenu } from "./SidebarToolbar";
import { SessionManager } from "./SessionManager";
import { WorkspaceManager } from "./WorkspaceManager";
import { WindowManager } from "./WindowManager";
import { useDragResize } from "../../hooks/useDragResize";

const TOOLBAR_WIDTH = 48;
const MIN_SUBMENU_WIDTH = 200;
const MAX_SUBMENU_WIDTH = 500;
const DEFAULT_SUBMENU_WIDTH = 280;

type SettingsCategory = "appearance" | "shortcuts" | "about";

interface SidebarProps {
  sidebarPanel: SidebarMenu | null;
  onSidebarPanelChange: (panel: SidebarMenu | null) => void;
  onCreateSession: () => void;
  onCreateSessionWithGroup: (groupId: number) => void;
  onToggleLogs: () => void;
  activeSettingsCategory?: SettingsCategory;
  onSelectSettingsCategory?: (category: SettingsCategory) => void;
  savedWorkspaces: any[];
  loadWorkspace: (id: string) => Promise<any>;
  deleteSavedWorkspace: (id: string) => void;
  renameSavedWorkspace: (id: string, name: string) => void;
  savedWindowConfigs: any[];
  loadWindow: (id: string) => Promise<void>;
  deleteSavedWindow: (id: string) => void;
  renameSavedWindow: (id: string, name: string) => void;
}

export default function Sidebar({
  sidebarPanel,
  onSidebarPanelChange,
  onCreateSession,
  onCreateSessionWithGroup,
  onToggleLogs,
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

  const renderPanel = () => {
    switch (sidebarPanel) {
      case "chat":
        return (
          <SessionManager
            onCreateSession={onCreateSession}
            onCreateSessionWithGroup={onCreateSessionWithGroup}
          />
        );
      case "workspace":
        return (
          <WorkspaceManager
            savedWorkspaces={savedWorkspaces}
            loadWorkspace={loadWorkspace}
            deleteSavedWorkspace={deleteSavedWorkspace}
            renameSavedWorkspace={renameSavedWorkspace}
          />
        );
      case "windows":
        return (
          <WindowManager
            savedWindowConfigs={savedWindowConfigs}
            loadWindow={loadWindow}
            deleteSavedWindow={deleteSavedWindow}
            renameSavedWindow={renameSavedWindow}
          />
        );
      case "settings":
        return (
          <Box sx={{ p: 1 }}>
            <Box sx={{ px: 1, py: 0.5, fontWeight: 600, fontSize: 13 }}>Settings</Box>
            {(["appearance", "shortcuts", "about"] as SettingsCategory[]).map((category) => (
              <Box
                key={category}
                sx={{
                  px: 1,
                  py: 0.5,
                  cursor: "pointer",
                  borderRadius: 1,
                  fontSize: 13,
                  bgcolor: activeSettingsCategory === category ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={() => onSelectSettingsCategory?.(category)}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </Box>
            ))}
          </Box>
        );
      default:
        return null;
    }
  };

  return (
    <Drawer
      variant="permanent"
      anchor="left"
      sx={{
        width: sidebarWidth,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: sidebarWidth,
          position: "relative",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        },
      }}
    >
      <Box sx={{ display: "flex", flex: 1, minWidth: 0 }}>
        <SidebarToolbar
          activeMenu={sidebarPanel}
          onMenuClick={handleMenuClick}
          onToggleLogs={onToggleLogs}
        />
        {sidebarPanel && (
          <>
            <Divider orientation="vertical" />
            <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden", minWidth: 0 }}>
              {renderPanel()}
            </Box>
            <Box
              sx={{
                width: 4,
                cursor: "col-resize",
                flexShrink: 0,
                "&:hover": { bgcolor: "action.hover" },
              }}
              onMouseDown={(e) => startResize(submenuWidth, e)}
            />
          </>
        )}
      </Box>
    </Drawer>
  );
}

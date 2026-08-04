import { Box, IconButton, Tooltip } from "@mui/material";
import { ChatIcon, WorkspaceIcon, WindowIcon, LogIcon, SettingsIcon } from "../icons";

export type SidebarMenu = "chat" | "settings" | "workspace" | "windows";

interface SidebarToolbarProps {
  activeMenu: SidebarMenu | null;
  onMenuClick: (menu: SidebarMenu) => void;
  onToggleLogs: () => void;
}

export function SidebarToolbar({
  activeMenu,
  onMenuClick,
  onToggleLogs,
}: SidebarToolbarProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 48,
        flexShrink: 0,
        py: 1,
        gap: 0.5,
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
        <Tooltip title="Sessions" placement="right">
          <IconButton
            size="small"
            onClick={() => onMenuClick("chat")}
            color={activeMenu === "chat" ? "primary" : "default"}
          >
            <ChatIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Workspaces" placement="right">
          <IconButton
            size="small"
            onClick={() => onMenuClick("workspace")}
            color={activeMenu === "workspace" ? "primary" : "default"}
          >
            <WorkspaceIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Windows" placement="right">
          <IconButton
            size="small"
            onClick={() => onMenuClick("windows")}
            color={activeMenu === "windows" ? "primary" : "default"}
          >
            <WindowIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Logs" placement="right">
          <IconButton size="small" onClick={onToggleLogs}>
            <LogIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1 }} />
      <Tooltip title="Settings" placement="right">
        <IconButton
          size="small"
          onClick={() => onMenuClick("settings")}
          color={activeMenu === "settings" ? "primary" : "default"}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

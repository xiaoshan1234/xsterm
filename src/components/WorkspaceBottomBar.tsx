import { AppBar, Toolbar, Select, MenuItem, IconButton, Box, FormControl } from "@mui/material";
import { Close as CloseIcon, Terminal as TerminalIcon, Check as CheckIcon } from "@mui/icons-material";

export interface WorkspaceBottomBarProps {
  workspaceName: string;
  workspaces: { id: string; name: string }[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onCloseWorkspace: (id: string) => void;
  commandPanelOpen: boolean;
  onToggleCommandPanel: () => void;
}

export function WorkspaceBottomBar({
  workspaceName: _workspaceName,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCloseWorkspace,
  commandPanelOpen,
  onToggleCommandPanel,
}: WorkspaceBottomBarProps) {
  return (
    <AppBar position="static" elevation={0} sx={{ bgcolor: "background.paper", borderTop: 1, borderColor: "divider" }}>
      <Toolbar variant="dense" sx={{ minHeight: 32, display: "flex", gap: 1, px: 1 }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select
            value={activeWorkspaceId ?? ""}
            displayEmpty
            onChange={(e) => onSelectWorkspace(e.target.value as string)}
            sx={{ fontSize: "0.8125rem", height: 24 }}
          >
            {workspaces.map((w) => (
              <MenuItem key={w.id} value={w.id} sx={{ fontSize: "0.8125rem" }}>
                {w.id === activeWorkspaceId ? <CheckIcon fontSize="small" sx={{ mr: 0.5 }} /> : null}
                {w.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={onToggleCommandPanel} color={commandPanelOpen ? "primary" : "default"}>
          <TerminalIcon fontSize="small" />
        </IconButton>
        {activeWorkspaceId && (
          <IconButton size="small" onClick={() => onCloseWorkspace(activeWorkspaceId)} aria-label="Close workspace">
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Toolbar>
    </AppBar>
  );
}

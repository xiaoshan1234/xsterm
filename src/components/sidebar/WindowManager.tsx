import { useState } from "react";
import {
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Button,
} from "@mui/material";
import { Edit as EditIcon, Close as CloseIcon } from "@mui/icons-material";
import { SavedWindowConfig } from "../../types/session";
import { WindowIcon } from "../icons";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { ContextMenu } from "../ui/ContextMenu";

interface WindowManagerProps {
  savedWindowConfigs: SavedWindowConfig[];
  loadWindow: (id: string) => Promise<void>;
  deleteSavedWindow: (id: string) => void;
  renameSavedWindow: (id: string, name: string) => void;
}

export function WindowManager({
  savedWindowConfigs,
  loadWindow,
  deleteSavedWindow,
  renameSavedWindow,
}: WindowManagerProps) {
  const [renamingWindow, setRenamingWindow] = useState<SavedWindowConfig | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);

  const handleLoad = (window: SavedWindowConfig) => {
    loadWindow(window.id).catch(console.error);
  };

  const handleClick = (window: SavedWindowConfig) => {
    setSelectedWindowId(window.id);
  };

  const handleStartRename = (window: SavedWindowConfig) => {
    setRenamingWindow(window);
    setRenameValue(window.name);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (renamingWindow && trimmed) {
      renameSavedWindow(renamingWindow.id, trimmed);
    }
    setRenamingWindow(null);
    setRenameValue("");
  };

  return (
    <div className="workspace-manager">
      <div className="submenu-header">Windows</div>
      <List dense disablePadding className="workspace-list">
        {savedWindowConfigs.map((window) => (
          <ContextMenu
            key={window.id}
            items={[
              { label: "Load", onClick: () => handleLoad(window) },
              { label: "Rename", onClick: () => handleStartRename(window) },
              { label: "Delete", onClick: () => deleteSavedWindow(window.id), danger: true },
            ]}
          >
            <ListItem
              disablePadding
              secondaryAction={
                <>
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label="rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(window);
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label="delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSavedWindow(window.id);
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </>
              }
            >
              <ListItemButton
                selected={selectedWindowId === window.id}
                onClick={() => handleClick(window)}
                onDoubleClick={() => handleLoad(window)}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <WindowIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={window.name} />
              </ListItemButton>
            </ListItem>
          </ContextMenu>
        ))}
        {savedWindowConfigs.length === 0 && (
          <div className="workspace-list-empty">No saved windows</div>
        )}
      </List>

      {renamingWindow && (
        <Dialog
          isOpen={true}
          onClose={() => setRenamingWindow(null)}
          title="Rename Window"
          size="small"
          footer={
            <>
              <Button variant="outlined" size="small" onClick={() => setRenamingWindow(null)}>Cancel</Button>
              <Button variant="contained" size="small" onClick={handleRenameSubmit}>Rename</Button>
            </>
          }
        >
          <FormField label="Window Name">
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameSubmit()}
              autoFocus
            />
          </FormField>
        </Dialog>
      )}
    </div>
  );
}

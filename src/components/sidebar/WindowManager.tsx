import { useState } from "react";
import { SavedWindowConfig } from "../../types/session";
import { WindowIcon } from "../icons/Icon";
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
      <div className="workspace-list">
        {savedWindowConfigs.map((window) => (
          <ContextMenu
            key={window.id}
            items={[
              { label: "Load", onClick: () => handleLoad(window) },
              { label: "Rename", onClick: () => handleStartRename(window) },
              { label: "Delete", onClick: () => deleteSavedWindow(window.id), danger: true },
            ]}
          >
            <div
              className={`workspace-list-item ${selectedWindowId === window.id ? "selected" : ""}`}
              onClick={() => handleClick(window)}
              onDoubleClick={() => handleLoad(window)}
            >
              <span className="workspace-list-item-icon">
                <WindowIcon size={14} />
              </span>
              <span className="workspace-list-item-name">{window.name}</span>
            </div>
          </ContextMenu>
        ))}
        {savedWindowConfigs.length === 0 && (
          <div className="workspace-list-empty">No saved windows</div>
        )}
      </div>

      {renamingWindow && (
        <Dialog
          isOpen={true}
          onClose={() => setRenamingWindow(null)}
          title="Rename Window"
          size="small"
          footer={
            <div className="dialog-footer-buttons">
              <button className="btn btn--secondary" onClick={() => setRenamingWindow(null)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleRenameSubmit}>Rename</button>
            </div>
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

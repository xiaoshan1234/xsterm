import { useState } from "react";
import { SavedWorkspace, Workspace } from "../../types/session";
import { useSession } from "../../contexts/SessionContext";
import { LayoutIcon } from "../icons/Icon";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { ContextMenu } from "../ui/ContextMenu";

interface WorkspaceManagerProps {
  savedWorkspaces: SavedWorkspace[];
  loadWorkspace: (id: string) => Promise<Workspace>;
  deleteSavedWorkspace: (id: string) => void;
  renameSavedWorkspace: (id: string, name: string) => void;
}

/**
 * WorkspaceManager - 管理工作区列表，支持单击选中、双击加载/切换、右键菜单操作。
 * 单击：标记选中状态（高亮背景）。
 * 双击：若已存在同名实例则切换，否则加载新实例。
 */
export function WorkspaceManager({
  savedWorkspaces,
  loadWorkspace,
  deleteSavedWorkspace,
  renameSavedWorkspace,
}: WorkspaceManagerProps) {
  const { workspaces, setActiveWorkspace } = useSession();
  const [renamingWorkspace, setRenamingWorkspace] = useState<SavedWorkspace | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const handleOpen = (workspace: SavedWorkspace) => {
    const existing = workspaces.find((w) => w.name === workspace.name);
    if (existing) {
      setActiveWorkspace(existing.id);
    } else {
      loadWorkspace(workspace.id).catch(console.error);
    }
  };

  const handleWorkspaceClick = (workspace: SavedWorkspace) => {
    setSelectedWorkspaceId(workspace.id);
  };

  const handleStartRename = (workspace: SavedWorkspace) => {
    setRenamingWorkspace(workspace);
    setRenameValue(workspace.name);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (renamingWorkspace && trimmed) {
      renameSavedWorkspace(renamingWorkspace.id, trimmed);
    }
    setRenamingWorkspace(null);
    setRenameValue("");
  };

  return (
    <div className="workspace-manager">
      <div className="submenu-header">Workspaces</div>
      <div className="workspace-list">
        {savedWorkspaces.map((workspace) => {
          const isLoaded = workspaces.some((w) => w.name === workspace.name);
          return (
            <ContextMenu
              key={workspace.id}
              items={[
                { label: isLoaded ? "Switch" : "Load", onClick: () => handleOpen(workspace) },
                { label: "Rename", onClick: () => handleStartRename(workspace) },
                { label: "Delete", onClick: () => deleteSavedWorkspace(workspace.id), danger: true },
              ]}
            >
              <div
                className={`workspace-list-item ${selectedWorkspaceId === workspace.id ? "selected" : ""}`}
                onClick={() => handleWorkspaceClick(workspace)}
                onDoubleClick={() => handleOpen(workspace)}
              >
                <span className="workspace-list-item-icon">
                  <LayoutIcon size={14} />
                </span>
                <span className="workspace-list-item-name">{workspace.name}</span>
              </div>
            </ContextMenu>
          );
        })}
        {savedWorkspaces.length === 0 && (
          <div className="workspace-list-empty">No saved workspaces</div>
        )}
      </div>

      {renamingWorkspace && (
        <Dialog
          isOpen={true}
          onClose={() => setRenamingWorkspace(null)}
          title="Rename Workspace"
          size="small"
          footer={
            <div className="dialog-footer-buttons">
              <button className="btn btn--secondary" onClick={() => setRenamingWorkspace(null)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleRenameSubmit}>Rename</button>
            </div>
          }
        >
          <FormField label="Workspace Name">
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

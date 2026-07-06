import { useState } from "react";
import { SavedWorkspace, Workspace } from "../../types/session";
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
 * WorkspaceManager -管理工作区列表，支持单击选中、双击加载、右键菜单操作。
 * 单击：标记选中状态（高亮背景）。
 * 双击：立即加载对应工作区。
 */
export function WorkspaceManager({
  savedWorkspaces,
  loadWorkspace,
  deleteSavedWorkspace,
  renameSavedWorkspace,
}: WorkspaceManagerProps) {
  // renamingWorkspace: 当前正在重命名的项，为 null 时不显示重命名对话框
  const [renamingWorkspace, setRenamingWorkspace] = useState<SavedWorkspace | null>(null);
  // renameValue: 重命名输入框的当前值
  const [renameValue, setRenameValue] = useState("");
  // selectedWorkspaceId: 当前被单击选中的工作区 ID，用于高亮显示
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  // handleLoad - 双击或右键"Load"时触发，加载整个工作区配置（终端、分屏等）
  const handleLoad = (workspace: SavedWorkspace) => {
    loadWorkspace(workspace.id).catch(console.error);
  };

  // handleWorkspaceClick - 单击时设置选中状态（高亮），不影响已加载状态
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
        {savedWorkspaces.map((workspace) => (
          <ContextMenu
            key={workspace.id}
            // 右键菜单选项：Load（加载）、Rename（重命名）、Delete（删除）
            items={[
              { label: "Load", onClick: () => handleLoad(workspace) },
              { label: "Rename", onClick: () => handleStartRename(workspace) },
              { label: "Delete", onClick: () => deleteSavedWorkspace(workspace.id), danger: true },
            ]}
          >
            {/*
              单击：handleWorkspaceClick → 选中态高亮
              双击：handleLoad → 直接加载工作区
              selectedWorkspaceId === workspace.id 时添加 "selected" 类名实现高亮
            */}
            <div
              className={`workspace-list-item ${selectedWorkspaceId === workspace.id ? "selected" : ""}`}
              onClick={() => handleWorkspaceClick(workspace)}
              onDoubleClick={() => handleLoad(workspace)}
            >
              <span className="workspace-list-item-icon">
                <LayoutIcon size={14} />
              </span>
              <span className="workspace-list-item-name">{workspace.name}</span>
            </div>
          </ContextMenu>
        ))}
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

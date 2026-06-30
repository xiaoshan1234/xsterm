import { MouseEvent, KeyboardEvent } from "react";
import { Workspace } from "../types/session";
import { CloseIcon } from "./icons/Icon";
import { ContextMenu, ContextMenuItem } from "./ui/ContextMenu";
import "./TabBar.css";

interface TabBarProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onClose: (workspaceId: string) => void;
  onSave: (workspaceId: string) => void;
}

export default function TabBar({ workspaces, activeWorkspaceId, onSelect, onClose, onSave }: TabBarProps) {
  return (
    <div className="workspace-tabs">
      {workspaces.map((workspace) => (
        <WorkspaceTab
          key={workspace.id}
          workspace={workspace}
          isActive={workspace.id === activeWorkspaceId}
          onSelect={() => onSelect(workspace.id)}
          onClose={() => onClose(workspace.id)}
          onSave={() => onSave(workspace.id)}
        />
      ))}
    </div>
  );
}

interface WorkspaceTabProps {
  workspace: Workspace;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onSave: () => void;
}

function WorkspaceTab({ workspace, isActive, onSelect, onClose, onSave }: WorkspaceTabProps) {
  const handleCloseClick = (e: MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const contextMenuItems: ContextMenuItem[] = [
    { label: "Save as Workspace", onClick: onSave },
    { label: "Close", onClick: onClose, danger: true },
  ];

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <ContextMenu items={contextMenuItems}>
      <div className={`workspace-tab ${isActive ? "active" : ""}`}>
        <div
          className="workspace-tab-label"
          role="tab"
          aria-selected={isActive}
          tabIndex={0}
          onClick={onSelect}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose();
            }
          }}
          onKeyDown={handleKeyDown}
        >
          {workspace.name}
        </div>
        <button
          className="workspace-tab-close"
          type="button"
          onClick={handleCloseClick}
          aria-label="Close workspace"
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </ContextMenu>
  );
}

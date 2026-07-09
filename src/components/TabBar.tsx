import { MouseEvent, KeyboardEvent } from "react";
import { Workspace, PaneNode, Session } from "../types/session";
import {
  CloseIcon,
  LocalSessionIcon,
  SshSessionIcon,
  LayoutIcon,
} from "./icons/Icon";
import { ContextMenu, ContextMenuItem } from "./ui/ContextMenu";
import "./TabBar.css";

interface TabBarProps {
  workspaces: Workspace[];
  sessions: Session[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onClose: (workspaceId: string) => void;
  onSave: (workspaceId: string) => void;
}

export default function TabBar({ workspaces, sessions, activeWorkspaceId, onSelect, onClose, onSave }: TabBarProps) {
  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    if (a.name === "default") return -1;
    if (b.name === "default") return 1;
    return 0;
  });

  return (
    <div className="workspace-tabs">
      {sortedWorkspaces.map((workspace) => (
        <WorkspaceTab
          key={workspace.id}
          workspace={workspace}
          sessions={sessions}
          isActive={workspace.id === activeWorkspaceId}
          isDefault={workspace.name === "default"}
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
  sessions: Session[];
  isActive: boolean;
  isDefault: boolean;
  onSelect: () => void;
  onClose: () => void;
  onSave: () => void;
}

function findPaneNode(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findPaneNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function getFirstLeafWithSession(root: PaneNode): PaneNode | null {
  if (root.type === "leaf" && root.sessionId !== undefined) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = getFirstLeafWithSession(child);
      if (found) return found;
    }
  }
  return null;
}

function getWorkspaceSessionType(workspace: Workspace, sessions: Session[]): Session["type"] | null {
  const activeWindow = workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0];
  if (!activeWindow) return null;
  let leaf: PaneNode | null = null;
  if (activeWindow.activePaneId) {
    leaf = findPaneNode(activeWindow.rootPane, activeWindow.activePaneId);
  }
  if (!leaf || leaf.sessionId === undefined) {
    leaf = getFirstLeafWithSession(activeWindow.rootPane);
  }
  if (!leaf || leaf.sessionId === undefined) return null;
  return sessions.find((s) => s.id === leaf!.sessionId)?.type ?? null;
}

function SessionTypeIcon({ type, size }: { type: Session["type"]; size: number }) {
  switch (type) {
    case "local":
      return <LocalSessionIcon size={size} />;
    case "ssh":
      return <SshSessionIcon size={size} />;
    default:
      return <LayoutIcon size={size} />;
  }
}

function WorkspaceTab({ workspace, sessions, isActive, isDefault, onSelect, onClose, onSave }: WorkspaceTabProps) {
  const handleCloseClick = (e: MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const contextMenuItems: ContextMenuItem[] = [
    { label: "Save as Workspace", onClick: onSave },
    ...(isDefault ? [] : [{ label: "Close", onClick: onClose, danger: true }]),
  ];

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };

  const sessionType = getWorkspaceSessionType(workspace, sessions);

  return (
    <ContextMenu items={contextMenuItems}>
      <div
        className={`tab ${isActive ? "active" : ""}`}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        onClick={onSelect}
        onMouseDown={(e) => {
          if (e.button === 1 && !isDefault) {
            e.preventDefault();
            onClose();
          }
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="tab-icon">
          {sessionType ? <SessionTypeIcon type={sessionType} size={14} /> : <LayoutIcon size={14} />}
        </span>
        <span className="tab-title">{workspace.name}</span>
        {!isDefault && (
          <button
            className="tab-close"
            type="button"
            onClick={handleCloseClick}
            aria-label="Close workspace"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
    </ContextMenu>
  );
}

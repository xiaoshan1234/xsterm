import { type MouseEvent, type KeyboardEvent } from "react";
import { type Workspace, type PaneNode, type Terminal } from "../../types/terminal";
import { CloseIcon, ShellIcon, SshIcon, LayoutIcon } from "../../shared/icons/Icon";
import { ContextMenu, type ContextMenuItem } from "../../shared/ui/ContextMenu";
import "./TabBar.css";

interface TabBarProps {
  workspaces: Workspace[];
  terminals: Terminal[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onClose: (workspaceId: string) => void;
  onSave: (workspaceId: string) => void;
}

export default function TabBar({
  workspaces,
  terminals,
  activeWorkspaceId,
  onSelect,
  onClose,
  onSave,
}: TabBarProps) {
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
          terminals={terminals}
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
  terminals: Terminal[];
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
  if (root.type === "leaf" && root.terminalId !== undefined) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = getFirstLeafWithSession(child);
      if (found) return found;
    }
  }
  return null;
}

function getWorkspaceTerminalKind(
  workspace: Workspace,
  terminals: Terminal[],
): Terminal["type"] | null {
  const activeWindow =
    workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0];
  if (!activeWindow) return null;
  let leaf: PaneNode | null = null;
  if (activeWindow.activePaneId) {
    leaf = findPaneNode(activeWindow.rootPane, activeWindow.activePaneId);
  }
  if (!leaf || leaf.terminalId === undefined) {
    leaf = getFirstLeafWithSession(activeWindow.rootPane);
  }
  if (!leaf || leaf.terminalId === undefined) return null;
  return terminals.find((s) => s.id === leaf!.terminalId)?.type ?? null;
}

function TerminalKindIcon({ type, size }: { type: Terminal["type"]; size: number }) {
  switch (type) {
    case "local":
      return <ShellIcon size={size} />;
    case "ssh":
      return <SshIcon size={size} />;
    default:
      return <LayoutIcon size={size} />;
  }
}

function WorkspaceTab({
  workspace,
  terminals,
  isActive,
  isDefault,
  onSelect,
  onClose,
  onSave,
}: WorkspaceTabProps) {
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

  const kind = getWorkspaceTerminalKind(workspace, terminals);

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
          {kind ? <TerminalKindIcon type={kind} size={14} /> : <LayoutIcon size={14} />}
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

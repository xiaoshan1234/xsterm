import { useCallback, useEffect, useRef, useState } from "react";
import { Workspace, PaneNode, Window } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { PaneTree } from "./PaneTree";
import { InitWindowView } from "./InitWindowView";
import CommandSendPanel from "./CommandSendPanel";
import { ContextMenu, ContextMenuItem, ContextMenuRef } from "./ui/ContextMenu";
import { SaveDialog } from "./dialogs/SaveDialog";
import { SaveWorkspaceDialog } from "./dialogs/SaveWorkspaceDialog";
import { PlusIcon, SaveIcon, CloseIcon } from "./icons/Icon";
import "./WorkspaceContainer.css";
import "./TabBar.css";

function updateNodeInTree(root: PaneNode, nodeId: string, updater: (node: PaneNode) => PaneNode): PaneNode {
  if (root.id === nodeId) {
    return updater(root);
  }
  if (!root.children) return root;
  return {
    ...root,
    children: root.children.map((child) => updateNodeInTree(child, nodeId, updater)),
  };
}

interface WorkspaceContainerProps {
  workspace: Workspace;
}

export function WorkspaceContainer({ workspace }: WorkspaceContainerProps) {
  const {
    sessions,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    setActiveWindow,
    setActivePane,
    updateWindowPaneTree,
    createWindow,
    closeWindow,
    saveWindow,
    saveWorkspace,
    writeSession,
    savedWorkspaces,
  } = useSession();

  const activeWindow = workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0] ?? null;

  const [savingWindowId, setSavingWindowId] = useState<string | null>(null);
  const [showSaveWorkspaceDialog, setShowSaveWorkspaceDialog] = useState(false);
  const [showCommandPanel, setShowCommandPanel] = useState(false);

  const handleActivatePane = useCallback(
    (paneId: string) => {
      if (!activeWindow) return;
      setActiveWorkspace(workspace.id);
      setActiveWindow(workspace.id, activeWindow.id);
      setActivePane(workspace.id, activeWindow.id, paneId);
    },
    [workspace.id, activeWindow, setActiveWorkspace, setActiveWindow, setActivePane]
  );

  const handleUpdateNode = useCallback(
    (nodeId: string, updater: (node: typeof activeWindow.rootPane) => typeof activeWindow.rootPane) => {
      if (!activeWindow) return;
      updateWindowPaneTree(workspace.id, activeWindow.id, (root) => {
        if (root.id === nodeId) {
          return updater(root);
        }
        return updateNodeInTree(root, nodeId, updater);
      });
    },
    [workspace.id, activeWindow, updateWindowPaneTree]
  );

  const handleSaveAll = useCallback(() => {
    if (workspace.name === "Default") {
      setShowSaveWorkspaceDialog(true);
    } else {
      try {
        saveWorkspace(workspace.id, workspace.name);
      } catch (e) {
        if (e instanceof Error && e.message === "Workspace name already exists") {
          window.alert("Workspace name already exists");
        }
      }
    }
  }, [workspace.name, workspace.id, saveWorkspace]);

  const activeSessionId = activeWindow
    ? (() => {
        const findActiveSession = (node: typeof activeWindow.rootPane): number | null => {
          if (node.type === "leaf") return node.sessionId ?? null;
          for (const child of node.children ?? []) {
            const found = findActiveSession(child);
            if (found !== null) return found;
          }
          return null;
        };
        return activeWindow.activePaneId
          ? (() => {
              const node = findPane(activeWindow.rootPane, activeWindow.activePaneId);
              return node?.sessionId ?? findActiveSession(activeWindow.rootPane);
            })()
          : findActiveSession(activeWindow.rootPane);
      })()
    : null;

  return (
    <div className="workspace-container" onMouseDown={() => setActiveWorkspace(workspace.id)}>
      <WindowTabBar
        workspace={workspace}
        activeWindowId={workspace.activeWindowId}
        onSelect={(windowId) => setActiveWindow(workspace.id, windowId)}
        onAdd={() => createWindow(workspace.id, undefined, undefined, "init")}
        onSaveAll={handleSaveAll}
        onSaveWindow={(windowId) => setSavingWindowId(windowId)}
        onCloseWindow={(windowId) => closeWindow(workspace.id, windowId)}
      />
      {activeWindow ? (
        activeWindow.windowType === "init" ? (
          <InitWindowView workspace={workspace} windowId={activeWindow.id} />
        ) : (
          <PaneTree
            workspace={workspace}
            windowId={activeWindow.id}
            node={activeWindow.rootPane}
            isActive={true}
            activePaneId={activeWindow.activePaneId}
            onActivatePane={handleActivatePane}
            onUpdateNode={handleUpdateNode}
          />
        )
      ) : null}
      {showCommandPanel && (
        <CommandSendPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          writeSession={writeSession}
        />
      )}
      <WorkspaceBottomBar
        workspaceName={workspace.name}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={setActiveWorkspace}
        onToggleCommandPanel={() => setShowCommandPanel((prev) => !prev)}
        commandPanelOpen={showCommandPanel}
      />
      {savingWindowId && (
        <SaveDialog
          isOpen={true}
          onClose={() => setSavingWindowId(null)}
          onSave={(name) => {
            saveWindow(workspace.id, savingWindowId, name);
            setSavingWindowId(null);
          }}
          defaultName={activeWindow?.name ?? "Window"}
          title="Save Window Config"
        />
      )}
      <SaveWorkspaceDialog
        isOpen={showSaveWorkspaceDialog}
        onClose={() => setShowSaveWorkspaceDialog(false)}
        onSave={(name) => {
          saveWorkspace(workspace.id, name);
          setShowSaveWorkspaceDialog(false);
        }}
        defaultName={workspace.name}
        savedWorkspaces={savedWorkspaces}
      />
    </div>
  );
}

interface WorkspaceBottomBarProps {
  workspaceName: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleCommandPanel: () => void;
  commandPanelOpen: boolean;
}

function WorkspaceBottomBar({
  workspaceName,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onToggleCommandPanel,
  commandPanelOpen,
}: WorkspaceBottomBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleToggle = () => {
    setMenuOpen((prev) => !prev);
  };

  const handleSelect = (id: string) => {
    onSelectWorkspace(id);
    setMenuOpen(false);
  };

  return (
    <div className="workspace-bottom-bar">
      <div className="workspace-bottom-bar-start">
        <button
          className="workspace-bottom-bar-button"
          type="button"
          onClick={onToggleCommandPanel}
          title={commandPanelOpen ? "Hide command panel" : "Show command panel"}
        >
          {commandPanelOpen ? "▼" : "▲"}
          <span>Command</span>
        </button>
      </div>
      <div className="workspace-bottom-bar-end">
        <div className="workspace-switcher">
          <button
            ref={triggerRef}
            className="workspace-switcher-trigger"
            type="button"
            onClick={handleToggle}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="Switch workspace"
          >
            <span className="workspace-bottom-bar-label">Workspace:</span>
            <span className="workspace-bottom-bar-name">{workspaceName}</span>
          </button>
          {menuOpen && (
            <div ref={menuRef} className="workspace-switcher-menu" role="menu">
              {workspaces.map((w) => {
                const isActive = w.id === activeWorkspaceId;
                return (
                  <button
                    key={w.id}
                    className={`workspace-switcher-item ${isActive ? "active" : ""}`}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(w.id)}
                  >
                    <span className="workspace-switcher-item-name">{w.name}</span>
                    {isActive && <span className="workspace-switcher-check" aria-hidden="true">●</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface WindowTabBarProps {
  workspace: Workspace;
  activeWindowId: string | null;
  onSelect: (windowId: string) => void;
  onAdd: () => void;
  onSaveAll: () => void;
  onSaveWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
}

function WindowTabBar({ workspace, activeWindowId, onSelect, onAdd, onSaveAll, onSaveWindow, onCloseWindow }: WindowTabBarProps) {
  return (
    <div className="workspace-tabs window-tabs">
      {workspace.windows.map((window) => (
        <WindowTab
          key={window.id}
          window={window}
          isActive={window.id === activeWindowId}
          onSelect={() => onSelect(window.id)}
          onSave={() => onSaveWindow(window.id)}
          onClose={() => onCloseWindow(window.id)}
        />
      ))}
      <div className="window-tab-actions">
        <button className="window-tab-action" type="button" onClick={onAdd} title="New window">
          <PlusIcon size={14} />
        </button>
        <button className="window-tab-action" type="button" onClick={onSaveAll} title="Save all windows as workspace">
          <SaveIcon size={14} />
        </button>
      </div>
    </div>
  );
}

interface WindowTabProps {
  window: Window;
  isActive: boolean;
  onSelect: () => void;
  onSave: () => void;
  onClose: () => void;
}

function WindowTab({ window, isActive, onSelect, onSave, onClose }: WindowTabProps) {
  const contextMenuRef = useRef<ContextMenuRef>(null);
  const contextMenuItems: ContextMenuItem[] = [
    { label: "Save as Window Config", onClick: onSave },
    { label: "Close", onClick: onClose, danger: true },
  ];

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <ContextMenu ref={contextMenuRef} items={contextMenuItems}>
      <div
        className={`tab ${isActive ? "active" : ""}`}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="tab-title">{window.name}</span>
        <button
          className="tab-close"
          type="button"
          onClick={handleCloseClick}
          aria-label={`Close window ${window.name}`}
          title="Close window"
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </ContextMenu>
  );
}

function findPane(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findPane(child, id);
      if (found) return found;
    }
  }
  return null;
}

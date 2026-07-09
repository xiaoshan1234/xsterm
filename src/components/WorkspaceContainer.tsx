import { useCallback, useRef, useState } from "react";
import { Workspace, PaneNode, Window } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { PaneTree } from "./PaneTree";
import { InitWindowView } from "./InitWindowView";
import CommandSendPanel from "./CommandSendPanel";
import { ContextMenu, ContextMenuItem, ContextMenuRef } from "./ui/ContextMenu";
import { SaveDialog } from "./dialogs/SaveDialog";
import { SaveWorkspaceDialog } from "./dialogs/SaveWorkspaceDialog";
import { PlusIcon, SaveIcon, CloseIcon } from "./icons/Icon";
import { forEachPane } from "../contexts/session/paneUtils";
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
  commandPanelOpen: boolean;
}

export function WorkspaceContainer({ workspace, commandPanelOpen }: WorkspaceContainerProps) {
  const {
    sessions,
    setActiveWorkspace,
    setActiveWindow,
    setActivePane,
    updateWindowPaneTree,
    createWindow,
    closeWindow,
    closeTmuxWindow,
    createTmuxWindow,
    renameWindow,
    saveWindow,
    saveWorkspace,
    writeSession,
    savedWorkspaces,
  } = useSession();

  const activeWindow = workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0] ?? null;

  const [savingWindowId, setSavingWindowId] = useState<string | null>(null);
  const [renamingWindow, setRenamingWindow] = useState<{ id: string; name: string } | null>(null);
  const [showSaveWorkspaceDialog, setShowSaveWorkspaceDialog] = useState(false);

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
    if (workspace.name === "default") {
      setShowSaveWorkspaceDialog(true);
    } else {
      try {
        saveWorkspace(workspace.id, workspace.name);
      } catch (e) {
        if (e instanceof Error) {
          if (e.message === "Workspace name already exists" || e.message === "Workspace name is reserved") {
            window.alert(e.message);
          }
        }
      }
    }
  }, [workspace.name, workspace.id, saveWorkspace]);

  const handleCloseWindow = useCallback(
    (windowId: string) => {
      const window = workspace.windows.find((w) => w.id === windowId);
      if (!window) return;

      let tmuxWindowToClose: { sessionId: number; windowId: string } | null = null;
      forEachPane(window.rootPane, (node) => {
        if (node.type === "leaf" && node.sessionId !== undefined && node.tmuxWindowId) {
          const session = sessions.find((s) => s.id === node.sessionId);
          if (session?.type === "tmux" || session?.type === "ssh_tmux") {
            tmuxWindowToClose = { sessionId: node.sessionId, windowId: node.tmuxWindowId };
          }
        }
      });

      if (tmuxWindowToClose) {
        const { sessionId, windowId } = tmuxWindowToClose;
        closeTmuxWindow(sessionId, windowId).catch(console.error);
      }

      closeWindow(workspace.id, windowId);
    },
    [workspace, closeTmuxWindow, closeWindow, sessions]
  );

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
        sessions={sessions}
        onSelect={(windowId) => setActiveWindow(workspace.id, windowId)}
        onAdd={() => createWindow(workspace.id, undefined, undefined, undefined, "init")}
        onSaveAll={handleSaveAll}
        onSaveWindow={(windowId) => setSavingWindowId(windowId)}
        onCloseWindow={handleCloseWindow}
        onRenameWindow={(windowId) => {
          const window = workspace.windows.find((w) => w.id === windowId);
          if (window) {
            setRenamingWindow({ id: windowId, name: window.name });
          }
        }}
        onCreateTmuxWindow={(sessionId) => createTmuxWindow(sessionId)}
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
      {commandPanelOpen && (
        <CommandSendPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          writeSession={writeSession}
        />
      )}
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
      {renamingWindow && (
        <SaveDialog
          isOpen={true}
          onClose={() => setRenamingWindow(null)}
          onSave={(name) => {
            renameWindow(workspace.id, renamingWindow.id, name);
            setRenamingWindow(null);
          }}
          defaultName={renamingWindow.name}
          title="Rename Window"
          label="Window Name"
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

interface WindowTabBarProps {
  workspace: Workspace;
  sessions: ReturnType<typeof useSession>["sessions"];
  activeWindowId: string | null;
  onSelect: (windowId: string) => void;
  onAdd: () => void;
  onSaveAll: () => void;
  onSaveWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
  onRenameWindow: (windowId: string) => void;
  onCreateTmuxWindow: (sessionId: number) => void;
}

function WindowTabBar({ workspace, sessions, activeWindowId, onSelect, onAdd, onSaveAll, onSaveWindow, onCloseWindow, onRenameWindow, onCreateTmuxWindow }: WindowTabBarProps) {
  return (
    <div className="workspace-tabs window-tabs">
      {workspace.windows.map((window) => (
        <WindowTab
          key={window.id}
          window={window}
          sessions={sessions}
          isActive={window.id === activeWindowId}
          onSelect={() => onSelect(window.id)}
          onSave={() => onSaveWindow(window.id)}
          onClose={() => onCloseWindow(window.id)}
          onRename={() => onRenameWindow(window.id)}
          onCreateTmuxWindow={onCreateTmuxWindow}
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
  sessions: ReturnType<typeof useSession>["sessions"];
  isActive: boolean;
  onSelect: () => void;
  onSave: () => void;
  onRename: () => void;
  onClose: () => void;
  onCreateTmuxWindow: (sessionId: number) => void;
}

function WindowTab({ window, sessions, isActive, onSelect, onSave, onRename, onClose, onCreateTmuxWindow }: WindowTabProps) {
  const contextMenuRef = useRef<ContextMenuRef>(null);

  let underlaySessionId: number | null = null;
  forEachPane(window.rootPane, (node) => {
    if (node.type === "leaf" && node.sessionId !== undefined && !node.tmuxWindowId) {
      const session = sessions.find((s) => s.id === node.sessionId);
      if (session?.type === "tmux" || session?.type === "ssh_tmux") {
        underlaySessionId = node.sessionId;
      }
    }
  });

  const contextMenuItems: ContextMenuItem[] = [
    { label: "Rename", onClick: onRename },
    { label: "Save as Window Config", onClick: onSave },
  ];
  if (underlaySessionId !== null) {
    contextMenuItems.push({
      label: "New Tmux Window",
      onClick: () => onCreateTmuxWindow(underlaySessionId!),
    });
  }
  contextMenuItems.push({ label: "Close", onClick: onClose, danger: true });

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

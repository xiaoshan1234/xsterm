import { useCallback, useRef, useState } from "react";
import { Workspace, PaneNode, Window } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { PaneTree } from "./PaneTree";
import CommandSendPanel from "./CommandSendPanel";
import { ContextMenu, ContextMenuItem, ContextMenuRef } from "./ui/ContextMenu";
import { SaveDialog } from "./dialogs/SaveDialog";
import { PlusIcon, SaveIcon } from "./icons/Icon";

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
    setActiveWorkspace,
    setActiveWindow,
    setActivePane,
    updateWindowPaneTree,
    createWindow,
    saveWindow,
    saveAllWindows,
    writeSession,
  } = useSession();

  const activeWindow = workspace.windows.find((w) => w.id === workspace.activeWindowId) ?? workspace.windows[0] ?? null;

  const [savingWindowId, setSavingWindowId] = useState<string | null>(null);

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
        onAdd={() => createWindow(workspace.id)}
        onSaveAll={() => saveAllWindows(workspace.id)}
        onSaveWindow={(windowId) => setSavingWindowId(windowId)}
      />
      {activeWindow ? (
        <PaneTree
          workspace={workspace}
          windowId={activeWindow.id}
          node={activeWindow.rootPane}
          isActive={true}
          activePaneId={activeWindow.activePaneId}
          onActivatePane={handleActivatePane}
          onUpdateNode={handleUpdateNode}
        />
      ) : null}
      <CommandSendPanel
        sessions={sessions}
        activeSessionId={activeSessionId}
        writeSession={writeSession}
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
}

function WindowTabBar({ workspace, activeWindowId, onSelect, onAdd, onSaveAll, onSaveWindow }: WindowTabBarProps) {
  return (
    <div className="workspace-tabs window-tabs">
      {workspace.windows.map((window) => (
        <WindowTab
          key={window.id}
          window={window}
          isActive={window.id === activeWindowId}
          onSelect={() => onSelect(window.id)}
          onSave={() => onSaveWindow(window.id)}
        />
      ))}
      <div className="window-tab-actions">
        <button className="window-tab-action" type="button" onClick={onAdd} title="New window">
          <PlusIcon size={14} />
        </button>
        <button className="window-tab-action" type="button" onClick={onSaveAll} title="Save all windows">
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
}

function WindowTab({ window, isActive, onSelect, onSave }: WindowTabProps) {
  const contextMenuRef = useRef<ContextMenuRef>(null);
  const contextMenuItems: ContextMenuItem[] = [
    { label: "Save as Window Config", onClick: onSave },
  ];

  return (
    <ContextMenu ref={contextMenuRef} items={contextMenuItems}>
      <div
        className={`tab ${isActive ? "active" : ""}`}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="tab-title">{window.name}</span>
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

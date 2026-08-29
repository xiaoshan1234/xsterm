import { useCallback, useRef, useState } from "react";
import { type Workspace, type PaneNode } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { useClampedPanelHeight } from "../hooks/useClampedPanelHeight";
import { PaneTree } from "./PaneTree";
import { InitWindowView } from "./InitWindowView";
import { WindowTabBar } from "./WindowTabBar";
import CommandSendPanel from "./CommandSendPanel";
import { SaveDialog } from "./dialogs/SaveDialog";
import { SaveWorkspaceDialog } from "./dialogs/SaveWorkspaceDialog";
import "./TabBar.css";

function updateNodeInTree(
  root: PaneNode,
  nodeId: string,
  updater: (node: PaneNode) => PaneNode,
): PaneNode {
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
    renameWindow,
    saveWindow,
    saveWorkspace,
    writeSession,
    savedWorkspaces,
  } = useSession();

  const activeWindow =
    workspace.windows.find((w) => w.id === workspace.activeWindowId) ??
    workspace.windows[0] ??
    null;

  const [savingWindowId, setSavingWindowId] = useState<string | null>(null);
  const [renamingWindow, setRenamingWindow] = useState<{ id: string; name: string } | null>(null);
  const [showSaveWorkspaceDialog, setShowSaveWorkspaceDialog] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const { height: commandPanelHeight, onHeightChange: handlePanelHeightChange } =
    useClampedPanelHeight({
      containerRef,
    });

  const handleActivatePane = useCallback(
    (windowId: string, paneId: string) => {
      setActiveWorkspace(workspace.id);
      setActiveWindow(workspace.id, windowId);
      setActivePane(workspace.id, windowId, paneId);
    },
    [workspace.id, setActiveWorkspace, setActiveWindow, setActivePane],
  );

  const handleUpdateNode = useCallback(
    (windowId: string, nodeId: string, updater: (node: PaneNode) => PaneNode) => {
      updateWindowPaneTree(workspace.id, windowId, (root) => {
        if (root.id === nodeId) {
          return updater(root);
        }
        return updateNodeInTree(root, nodeId, updater);
      });
    },
    [workspace.id, updateWindowPaneTree],
  );

  const handleSaveAll = useCallback(() => {
    if (workspace.name === "default") {
      setShowSaveWorkspaceDialog(true);
    } else {
      try {
        saveWorkspace(workspace.id, workspace.name);
      } catch (e) {
        if (e instanceof Error) {
          if (
            e.message === "Workspace name already exists" ||
            e.message === "Workspace name is reserved"
          ) {
            window.alert(e.message);
          }
        }
      }
    }
  }, [workspace.name, workspace.id, saveWorkspace]);

  return (
    <div
      className="workspace-container"
      ref={containerRef}
      onMouseDown={() => setActiveWorkspace(workspace.id)}
    >
      <WindowTabBar
        workspaceId={workspace.id}
        workspace={workspace}
        activeWindowId={workspace.activeWindowId}
        onSelect={(windowId) => setActiveWindow(workspace.id, windowId)}
        onAdd={() => createWindow(workspace.id, undefined, undefined, undefined, "init")}
        onSaveAll={handleSaveAll}
        onSaveWindow={(windowId) => setSavingWindowId(windowId)}
        onCloseWindow={(windowId) => closeWindow(workspace.id, windowId)}
        onRenameWindow={(windowId) => {
          const window = workspace.windows.find((w) => w.id === windowId);
          if (window) {
            setRenamingWindow({ id: windowId, name: window.name });
          }
        }}
      />
      {workspace.windows.map((window) => (
        <div
          key={window.id}
          className={`terminal-pane ${window.id === activeWindow?.id ? "terminal-pane--active" : ""}`}
        >
          {window.windowType === "init" ? (
            <InitWindowView workspace={workspace} windowId={window.id} />
          ) : (
            <PaneTree
              workspace={workspace}
              windowId={window.id}
              node={window.rootPane}
              isActive={true}
              isWindowActive={window.id === activeWindow?.id}
              activePaneId={window.activePaneId}
              onActivatePane={handleActivatePane}
              onUpdateNode={handleUpdateNode}
            />
          )}
        </div>
      ))}
      {commandPanelOpen && (
        <CommandSendPanel
          workspace={workspace}
          sessions={sessions}
          writeSession={writeSession}
          style={{ height: commandPanelHeight, minHeight: 120 }}
          onHeightChange={handlePanelHeightChange}
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

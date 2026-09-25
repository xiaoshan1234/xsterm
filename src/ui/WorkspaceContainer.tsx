import { useCallback, useRef, useState } from "react";
import { type PaneNode } from "../model/pane";
import { type Workspace } from "../model";
import { useSession } from "../service/legacy/contexts/SessionContext";
import { useClampedPanelHeight } from "../service/hooks/panels/useClampedPanelHeight";
import { PaneTree } from "./PaneTree";
import { InitWindowView } from "./InitWindowView";
import { WindowTabBar } from "./WindowTabBar";
import { TmuxControlWindowView } from "./TmuxControlWindowView";
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
  if (root.kind !== "split") return root;
  return {
    ...root,
    layout: {
      ...root.layout,
      children: root.layout.children.map((child) => updateNodeInTree(child, nodeId, updater)),
    },
  };
}

interface WorkspaceContainerProps {
  workspace: Workspace;
  isCommandPanelOpen: boolean;
}

export function WorkspaceContainer({ workspace, isCommandPanelOpen }: WorkspaceContainerProps) {
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

  // The "+" button on the tab bar creates a tmux window on the
  // server when the active window is a tmux-control-window
  // (ADR 0009 §2.4 "windows-control + New Window" + Phase E). For
  // any other active window we keep the legacy behaviour (open a
  // local init Window that prompts the user to attach / create a
  // session).
  const handleAdd = useCallback(() => {
    if (activeWindow?.kind === "tmux-control" && activeWindow.tmuxControllerId !== undefined) {
      createWindow(
        workspace.id,
        undefined,
        undefined,
        undefined,
        "terminal",
        activeWindow.tmuxControllerId,
      );
      return;
    }
    createWindow(workspace.id, undefined, undefined, undefined, "init");
  }, [activeWindow, createWindow, workspace.id]);

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
        onAdd={handleAdd}
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
          {window.kind === "init" ? (
            <InitWindowView workspace={workspace} windowId={window.id} />
          ) : window.kind === "tmux-control" ? (
            <TmuxControlWindowView window={window} />
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
      {isCommandPanelOpen && (
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

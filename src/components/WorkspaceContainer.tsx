import { useCallback, useEffect, useRef, useState } from "react";
import { Workspace, PaneNode } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import { PaneTree } from "./PaneTree";
import { InitWindowView } from "./InitWindowView";
import CommandSendPanel from "./CommandSendPanel";
import { SaveDialog } from "./dialogs/SaveDialog";
import { SaveWorkspaceDialog } from "./dialogs/SaveWorkspaceDialog";
import { PlusIcon, SaveIcon } from "./icons";
import { TabBar } from "./TabBar";
import { Box, IconButton, Menu, MenuItem } from "@mui/material";

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

  const containerRef = useRef<HTMLDivElement>(null);
  const [commandPanelHeight, setCommandPanelHeight] = useState(160);
  const [maxPanelHeight, setMaxPanelHeight] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateMax = () => {
      setMaxPanelHeight(el.clientHeight);
    };

    updateMax();

    const observer = new ResizeObserver(updateMax);
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  const handlePanelHeightChange = useCallback((newHeight: number) => {
    setCommandPanelHeight(Math.min(Math.max(newHeight, 120), Math.max(maxPanelHeight, 120)));
  }, [maxPanelHeight]);

  const handleActivatePane = useCallback(
    (windowId: string, paneId: string) => {
      setActiveWorkspace(workspace.id);
      setActiveWindow(workspace.id, windowId);
      setActivePane(workspace.id, windowId, paneId);
    },
    [workspace.id, setActiveWorkspace, setActiveWindow, setActivePane]
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
    [workspace.id, updateWindowPaneTree]
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

  return (
    <Box className="workspace-container" ref={containerRef} sx={{ display: "flex", flexDirection: "column", height: "100%", bgcolor: "background.default" }} onMouseDown={() => setActiveWorkspace(workspace.id)}>
      <WindowTabBar
        workspace={workspace}
        activeWindowId={workspace.activeWindowId}
        onSelect={(windowId) => setActiveWindow(workspace.id, windowId)}
        onAdd={() => createWindow(workspace.id, undefined, undefined, undefined, "init")}
        onSaveAll={handleSaveAll}
        onSaveWindow={(windowId) => setSavingWindowId(windowId)}
        onCloseWindow={(windowId) => closeWindow(workspace.id, windowId)}
        onRenameWindow={(windowId) => {
          const win = workspace.windows.find((w) => w.id === windowId);
          if (win) {
            setRenamingWindow({ id: windowId, name: win.name });
          }
        }}
      />
      {workspace.windows.map((window) => (
        <Box
          key={window.id}
          className={`terminal-pane ${window.id === activeWindow?.id ? "terminal-pane--active" : ""}`}
          sx={{ flex: 1, minHeight: 0, display: window.id === activeWindow?.id ? "flex" : "none", flexDirection: "column" }}
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
        </Box>
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
    </Box>
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
  onRenameWindow: (windowId: string) => void;
}

function WindowTabBar({ workspace, activeWindowId, onSelect, onAdd, onSaveAll, onSaveWindow, onCloseWindow, onRenameWindow }: WindowTabBarProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; windowId: string } | null>(null);

  const tabs = workspace.windows.map((w) => ({
    id: w.id,
    label: w.name,
    closable: true,
  }));

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, windowId: id });
  };

  const handleCloseCtxMenu = () => setCtxMenu(null);

  const handleRename = () => {
    if (ctxMenu) onRenameWindow(ctxMenu.windowId);
    handleCloseCtxMenu();
  };

  const handleSave = () => {
    if (ctxMenu) onSaveWindow(ctxMenu.windowId);
    handleCloseCtxMenu();
  };

  const handleClose = () => {
    if (ctxMenu) onCloseWindow(ctxMenu.windowId);
    handleCloseCtxMenu();
  };

  return (
    <Box sx={{ display: "flex", alignItems: "stretch", borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <TabBar
          tabs={tabs}
          activeTab={activeWindowId}
          onSelect={onSelect}
          onClose={onCloseWindow}
          onContextMenu={handleContextMenu}
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, borderLeft: 1, borderColor: "divider" }}>
        <IconButton size="small" onClick={onAdd} title="New window" sx={{ p: 0.5 }}>
          <PlusIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={onSaveAll} title="Save all windows as workspace" sx={{ p: 0.5 }}>
          <SaveIcon fontSize="small" />
        </IconButton>
      </Box>
      <Menu
        open={Boolean(ctxMenu)}
        onClose={handleCloseCtxMenu}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { top: ctxMenu.y, left: ctxMenu.x } : undefined}
      >
        <MenuItem onClick={handleRename}>Rename</MenuItem>
        <MenuItem onClick={handleSave}>Save as Window Config</MenuItem>
        <MenuItem onClick={handleClose} sx={{ color: "error.main" }}>Close</MenuItem>
      </Menu>
    </Box>
  );
}

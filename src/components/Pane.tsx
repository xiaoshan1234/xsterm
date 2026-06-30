import { useCallback, useRef, useState } from "react";
import { PaneNode, SplitDirection, Workspace } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import Terminal, { TerminalRef } from "./Terminal";
import { ContextMenu, ContextMenuItem, ContextMenuRef } from "./ui/ContextMenu";
import { SelectSessionDialog } from "./dialogs/SelectSessionDialog";
import { TmuxSessionView } from "./TmuxSessionView";

interface PaneProps {
  workspace: Workspace;
  pane: PaneNode;
  isActive: boolean;
  onActivate: () => void;
}

type DialogMode = "split" | "attach";

function replacePaneNode(root: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (root.id === targetId) return replacement;
  if (!root.children) return root;
  return {
    ...root,
    children: root.children.map((child) => replacePaneNode(child, targetId, replacement)),
  };
}

export function Pane({ workspace, pane, isActive, onActivate }: PaneProps) {
  const {
    sessions,
    splitPane,
    closeSession,
    createSessionFromSavedConfig,
    tmuxState,
    activeTmuxWindowIds,
    setActiveTmuxWindow,
    createTmuxWindow,
    closeTmuxWindow,
    closeTmuxPane,
    updateWorkspacePaneTree,
  } = useSession();
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [pendingSplit, setPendingSplit] = useState<SplitDirection | null>(null);
  const contextMenuRef = useRef<ContextMenuRef>(null);
  const terminalRef = useRef<TerminalRef>(null);

  const session = pane.sessionId !== undefined ? sessions.find((s) => s.id === pane.sessionId) : undefined;

  const handleStartSplit = useCallback((direction: SplitDirection) => {
    setPendingSplit(direction);
    setDialogMode("split");
    setShowSessionDialog(true);
  }, []);

  const handleStartAttach = useCallback(() => {
    setPendingSplit(null);
    setDialogMode("attach");
    setShowSessionDialog(true);
  }, []);

  const attachSessionToPane = useCallback(
    (sessionId: number) => {
      const attachedSession = sessions.find((s) => s.id === sessionId);
      updateWorkspacePaneTree(workspace.id, (root) =>
        replacePaneNode(root, pane.id, {
          ...pane,
          sessionId,
          configId: attachedSession?.configId,
        })
      );
      onActivate();
    },
    [workspace.id, pane, sessions, updateWorkspacePaneTree, onActivate]
  );

  const handleSelectSession = useCallback(
    (sessionId: number) => {
      if (dialogMode === "split" && pendingSplit) {
        splitPane(workspace.id, pane.id, pendingSplit, sessionId);
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } else if (dialogMode === "attach") {
        attachSessionToPane(sessionId);
        setDialogMode(null);
        setShowSessionDialog(false);
      }
    },
    [dialogMode, pendingSplit, workspace.id, pane.id, splitPane, attachSessionToPane]
  );

  const handleSelectConfig = useCallback(
    async (configId: string) => {
      if (dialogMode === "split" && pendingSplit) {
        try {
          const session = await createSessionFromSavedConfig(configId);
          splitPane(workspace.id, pane.id, pendingSplit, session.id);
        } catch (e) {
          console.error("Failed to create session for split:", e);
        } finally {
          setPendingSplit(null);
          setDialogMode(null);
          setShowSessionDialog(false);
        }
      } else if (dialogMode === "attach") {
        try {
          const session = await createSessionFromSavedConfig(configId);
          attachSessionToPane(session.id);
        } catch (e) {
          console.error("Failed to create session for attach:", e);
        } finally {
          setDialogMode(null);
          setShowSessionDialog(false);
        }
      }
    },
    [dialogMode, pendingSplit, workspace.id, pane.id, splitPane, createSessionFromSavedConfig, attachSessionToPane]
  );

  const handleCloseSession = useCallback(() => {
    if (pane.sessionId !== undefined) {
      closeSession(pane.sessionId);
    }
  }, [pane.sessionId, closeSession]);

  const handleSelectAll = useCallback(() => {
    terminalRef.current?.selectAll();
  }, []);

  const handleCopy = useCallback(async () => {
    await terminalRef.current?.copySelection();
  }, []);

  const handleContextMenuCapture = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuRef.current?.open(e.clientX, e.clientY);
  }, []);

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: "Split Horizontal",
      onClick: () => handleStartSplit("horizontal"),
    },
    {
      label: "Split Vertical",
      onClick: () => handleStartSplit("vertical"),
    },
  ];

  if (!session) {
    contextMenuItems.push({
      label: "Attach Session",
      onClick: handleStartAttach,
    });
  }

  if (session) {
    contextMenuItems.push(
      {
        label: "Select All",
        onClick: handleSelectAll,
      },
      {
        label: "Copy",
        onClick: handleCopy,
      },
      {
        label: "Close Session",
        onClick: handleCloseSession,
        danger: true,
      }
    );
  }

  return (
    <>
      <div className="pane-leaf">
        <ContextMenu ref={contextMenuRef} items={contextMenuItems}>
          <div
            className={`workspace-pane ${isActive ? "workspace-pane--active" : ""}`}
            onMouseDown={onActivate}
            onContextMenuCapture={handleContextMenuCapture}
          >
            {session ? (
              session.type === "tmux" || session.type === "ssh_tmux" ? (
                <div className="workspace-pane-content" onMouseDown={onActivate}>
                  <TmuxSessionView
                    session={session}
                    isActive={isActive}
                    tmuxState={tmuxState}
                    activeTmuxWindowIds={activeTmuxWindowIds}
                    setActiveTmuxWindow={setActiveTmuxWindow}
                    createTmuxWindow={createTmuxWindow}
                    closeTmuxWindow={closeTmuxWindow}
                    closeTmuxPane={closeTmuxPane}
                  />
                </div>
              ) : (
                <Terminal ref={terminalRef} sessionId={session.id} sessionType={session.type} isActive={isActive} onFocus={onActivate} />
              )
            ) : (
              <div className="workspace-pane-empty">
                <span>No session</span>
                <span className="workspace-pane-empty-hint">Right-click to split</span>
              </div>
            )}
          </div>
        </ContextMenu>
      </div>
      <SelectSessionDialog
        isOpen={showSessionDialog}
        onClose={() => {
          setShowSessionDialog(false);
          setPendingSplit(null);
          setDialogMode(null);
        }}
        onSelectSession={handleSelectSession}
        onSelectConfig={handleSelectConfig}
      />
    </>
  );
}

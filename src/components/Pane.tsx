import { useCallback, useRef, useState } from "react";
import { PaneNode, SplitDirection, Workspace } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import * as paneTree from "../utils/paneTree";
import { isSessionUsedInOtherWindow } from "../contexts/session/paneUtils";
import Terminal, { TerminalRef } from "./Terminal";
import { ContextMenu, ContextMenuItem, ContextMenuRef } from "./ui/ContextMenu";
import { SelectSessionDialog } from "./dialogs/SelectSessionDialog";
import { TmuxSessionView } from "./TmuxSessionView";
import { PaneInitCard } from "./PaneInitCard";

interface PaneProps {
  workspace: Workspace;
  windowId: string;
  pane: PaneNode;
  isActive: boolean;
  onActivate: () => void;
}

type DialogMode = "split" | "attach";

export function Pane({ workspace, windowId, pane, isActive, onActivate }: PaneProps) {
  const {
    sessions,
    workspaces,
    splitPane,
    closeSession,
    createSessionFromSavedConfig,
    tmuxState,
    activeTmuxWindowIds,
    setActiveTmuxWindow,
    createTmuxWindow,
    closeTmuxWindow,
    closeTmuxPane,
    updateWindowPaneTree,
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
      if (isSessionUsedInOtherWindow(workspaces, workspace.id, windowId, sessionId)) {
        window.alert("Session is already used in another window");
        return;
      }
      const attachedSession = sessions.find((s) => s.id === sessionId);
      updateWindowPaneTree(workspace.id, windowId, (root) =>
        paneTree.replacePaneNode(root, pane.id, {
          ...pane,
          sessionId,
          configId: attachedSession?.configId,
        })
      );
      onActivate();
    },
    [workspaces, workspace.id, windowId, pane, sessions, updateWindowPaneTree, onActivate]
  );

  const handleSelectSession = useCallback(
    (sessionId: number) => {
      if (dialogMode === "split" && pendingSplit) {
        try {
          splitPane(workspace.id, windowId, pane.id, pendingSplit, sessionId);
        } catch (e) {
          if (e instanceof Error && e.message === "Session is already used in another window") {
            window.alert("Session is already used in another window");
          } else {
            throw e;
          }
        }
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } else if (dialogMode === "attach") {
        attachSessionToPane(sessionId);
        setDialogMode(null);
        setShowSessionDialog(false);
      }
    },
    [dialogMode, pendingSplit, workspace.id, windowId, pane.id, splitPane, attachSessionToPane]
  );

  const handleSelectConfig = useCallback(
    async (configId: string) => {
      if (dialogMode === "split" && pendingSplit) {
        try {
          const session = await createSessionFromSavedConfig(configId);
          splitPane(workspace.id, windowId, pane.id, pendingSplit, session.id);
        } catch (e) {
          if (e instanceof Error && e.message === "Session is already used in another window") {
            window.alert("Session is already used in another window");
          } else {
            console.error("Failed to create session for split:", e);
          }
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
          if (e instanceof Error && e.message === "Session is already used in another window") {
            window.alert("Session is already used in another window");
          } else {
            console.error("Failed to create session for attach:", e);
          }
        } finally {
          setDialogMode(null);
          setShowSessionDialog(false);
        }
      }
    },
    [dialogMode, pendingSplit, workspace.id, windowId, pane.id, splitPane, createSessionFromSavedConfig, attachSessionToPane]
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
      <ContextMenu ref={contextMenuRef} items={contextMenuItems} className="pane-leaf">
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
              <PaneInitCard
                onSessionCreated={(session) => attachSessionToPane(session.id)}
                title="No session"
                subtitle="Create or open a session"
              />
            )}
          </div>
        </ContextMenu>
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

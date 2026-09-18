import { useCallback, useRef, useState } from "react";
import { type PaneNode, type SplitDirection, type Workspace } from "../model";
import { useSession } from "../service/legacy/contexts/SessionContext";
import * as paneTree from "../app/rules/paneTree";
import {
  isSessionUsedInOtherWindow,
  getPaneNumber,
} from "../service/legacy/contexts/session/paneUtils";
import { useTheme } from "../service/legacy/contexts/ThemeContext";
import Terminal, { type TerminalRef } from "./Terminal";
import { ContextMenu, type ContextMenuRef } from "./primitives/ContextMenu";
import { SelectSessionDialog } from "./dialogs/SelectSessionDialog";
import { PaneInitCard } from "./PaneInitCard";
import { buildPaneContextMenu } from "./dialogs/paneContextMenu";
import { TmuxControllerErrorBanner } from "./TmuxControllerErrorBanner";
import * as sessionService from "../service/legacy/services/sessionService";
import "./Pane.css";

interface PaneProps {
  workspace: Workspace;
  windowId: string;
  pane: PaneNode;
  isActive: boolean;
  isWindowActive: boolean;
  onActivate: () => void;
}

type DialogMode = "split" | "attach";

export function Pane({
  workspace,
  windowId,
  pane,
  isActive,
  isWindowActive,
  onActivate,
}: PaneProps) {
  const {
    sessions,
    workspaces,
    splitPane,
    closeSession,
    closePane,
    createSessionFromSavedConfig,
    updateWindowPaneTree,
  } = useSession();
  const { currentTheme } = useTheme();
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [pendingSplit, setPendingSplit] = useState<SplitDirection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const contextMenuRef = useRef<ContextMenuRef>(null);
  const terminalRef = useRef<TerminalRef>(null);

  const startSubmitting = () => {
    if (isSubmittingRef.current) return false;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    return true;
  };

  const endSubmitting = () => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  };

  const session =
    pane.sessionId !== undefined ? sessions.find((s) => s.id === pane.sessionId) : undefined;
  const selectedWindow = workspace.windows.find((w) => w.id === windowId);
  const paneNumber = selectedWindow ? getPaneNumber(selectedWindow.rootPane, pane.id) : null;

  // hidden panes (from tmux -CC attach) are suppressed. MVP panes have is_hidden = false.
  if (session?.isHidden) {
    return null;
  }

  const handleStartSplit = useCallback(
    (direction: SplitDirection) => {
      // tmux panes (supportsMultiplex) split immediately
      // through the backend — no "pick a session from the dialog"
      // step because the new pane IS the new tmux pane. The
      // `tmux-pane-added` listener / `splitTmuxPaneInternal` updates
      // React state and the pane tree.
      if (
        session?.capabilities?.supportsMultiplex &&
        session.id !== undefined &&
        pane.sessionId !== undefined
      ) {
        splitPane(workspace.id, windowId, pane.id, direction, pane.sessionId);
        return;
      }
      // Non-multiplex path: open the dialog so the user picks what
      // session to attach to the new leaf.
      setPendingSplit(direction);
      setDialogMode("split");
      setShowSessionDialog(true);
    },
    [session, pane.sessionId, splitPane, workspace.id, windowId, pane.id],
  );

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
        }),
      );
      onActivate();
    },
    [workspaces, workspace.id, windowId, pane, sessions, updateWindowPaneTree, onActivate],
  );

  const handleSelectSession = useCallback(
    (sessionId: number) => {
      if (!startSubmitting()) return;
      try {
        if (dialogMode === "split" && pendingSplit) {
          const sessionConfigId = sessions.find((s) => s.id === sessionId)?.configId;
          splitPane(workspace.id, windowId, pane.id, pendingSplit, sessionId, sessionConfigId);
        } else if (dialogMode === "attach") {
          attachSessionToPane(sessionId);
        }
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } catch (e) {
        if (e instanceof Error && e.message === "Session is already used in another window") {
          window.alert("Session is already used in another window");
        } else {
          window.alert(`Failed to attach session: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        endSubmitting();
      }
    },
    [
      dialogMode,
      pendingSplit,
      workspace.id,
      windowId,
      pane.id,
      splitPane,
      attachSessionToPane,
      sessions,
    ],
  );

  const handleSelectConfig = useCallback(
    async (configId: string) => {
      if (!startSubmitting()) return;
      try {
        const session = await createSessionFromSavedConfig(configId);
        if (dialogMode === "split" && pendingSplit) {
          splitPane(workspace.id, windowId, pane.id, pendingSplit, session.id, session.configId);
        } else if (dialogMode === "attach") {
          attachSessionToPane(session.id);
        }
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } catch (e) {
        if (e instanceof Error && e.message === "Session is already used in another window") {
          window.alert("Session is already used in another window");
        } else {
          window.alert(`Failed to create session: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        endSubmitting();
      }
    },
    [
      dialogMode,
      pendingSplit,
      workspace.id,
      windowId,
      pane.id,
      splitPane,
      createSessionFromSavedConfig,
      attachSessionToPane,
    ],
  );

  const handleCloseSession = useCallback(() => {
    if (pane.sessionId !== undefined) {
      closeSession(pane.sessionId);
    }
  }, [pane.sessionId, closeSession]);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const handleSelectAll = useCallback(() => {
    terminalRef.current?.selectAll();
  }, []);

  const handleCopy = useCallback(async () => {
    await terminalRef.current?.copySelection();
  }, []);

  const handlePaste = useCallback(async () => {
    await terminalRef.current?.pasteFromClipboard();
  }, []);

  const handleContextMenuCapture = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuRef.current?.open(e.clientX, e.clientY);
  }, []);

  const handleClosePane = useCallback(() => {
    closePane(workspace.id, windowId, pane.id);
  }, [closePane, workspace.id, windowId, pane.id]);

  const handleCreateTmuxWindow = useCallback(async () => {
    if (session?.tmuxControllerId === undefined) return;
    try {
      await sessionService.createTmuxWindow(session.tmuxControllerId);
    } catch (e) {
      console.error("Failed to create tmux window:", e);
      window.alert(`Failed to create tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [session?.tmuxControllerId]);

  const handleKillTmuxWindow = useCallback(async () => {
    const xid = selectedWindow?.xstermWindowId;
    if (xid === undefined) return;
    try {
      await sessionService.killTmuxWindow(xid);
    } catch (e) {
      console.error("Failed to kill tmux window:", e);
      window.alert(`Failed to kill tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedWindow?.xstermWindowId]);

  const handleRenameTmuxWindow = useCallback(async () => {
    const xid = selectedWindow?.xstermWindowId;
    if (xid === undefined) return;
    const name = window.prompt("Rename tmux window:");
    if (name === null || name.trim() === "") return;
    try {
      await sessionService.renameTmuxWindow(xid, name.trim());
    } catch (e) {
      console.error("Failed to rename tmux window:", e);
      window.alert(`Failed to rename tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedWindow?.xstermWindowId]);

  const contextMenuItems = buildPaneContextMenu(
    session,
    {
      startSplit: handleStartSplit,
      startAttach: handleStartAttach,
      selectAll: handleSelectAll,
      copy: handleCopy,
      paste: handlePaste,
      clear: handleClear,
      closePane: handleClosePane,
      closeSession: handleCloseSession,
      createTmuxWindow: handleCreateTmuxWindow,
      killTmuxWindow: handleKillTmuxWindow,
      renameTmuxWindow: handleRenameTmuxWindow,
    },
    selectedWindow,
  );

  return (
    <>
      <ContextMenu ref={contextMenuRef} items={contextMenuItems} className="pane-leaf">
        <div
          className={`workspace-pane ${isActive ? "workspace-pane--active" : ""}`}
          onMouseDown={onActivate}
          onContextMenuCapture={handleContextMenuCapture}
        >
          {paneNumber !== null && (
            <div className="pane-number-badge" style={{ background: currentTheme.background }}>
              {paneNumber}
            </div>
          )}
          {session ? (
            <div className="pane-session-container">
              {!session.isConnected && (
                <div className="pane-disconnect-banner">
                  Connection lost. Press Enter to reconnect.
                </div>
              )}
              <TmuxControllerErrorBanner paneSessions={[session]} />
              <div className="pane-terminal-wrapper">
                <Terminal
                  ref={terminalRef}
                  sessionId={session.id}
                  sessionType={session.type}
                  isActive={isActive && isWindowActive}
                  isWindowActive={isWindowActive}
                  onFocus={onActivate}
                  isConnected={session.isConnected}
                  configId={session.configId}
                  displayConfig={session.displayConfig}
                />
              </div>
            </div>
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
          if (isSubmitting) return;
          setShowSessionDialog(false);
          setPendingSplit(null);
          setDialogMode(null);
        }}
        onSelectSession={handleSelectSession}
        onSelectConfig={handleSelectConfig}
        disabled={isSubmitting}
      />
    </>
  );
}

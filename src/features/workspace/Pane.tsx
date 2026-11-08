import { useCallback, useRef, useState } from "react";
import { type PaneNode, type SplitDirection, type Workspace } from "../../models/legacy/terminal";
import { useTerminalRuntime, useWorkspaceLayout } from "../sessions";
import * as paneTree from "../../shared/utils/paneTreeUtils";
import { getPaneNumber, isSessionUsedInOtherWindow } from "../sessions";
import { useTheme } from "../../shared/theme/ThemeContext";
import Terminal, { type TerminalRef } from "../terminal/view/Terminal";
import { ContextMenu, type ContextMenuRef } from "../../shared/ui/ContextMenu";
import { SelectTerminalDialog } from "../terminal/ui/dialogs/SelectTerminalDialog";
import { PaneInitCard } from "./PaneInitCard";
import { buildPaneContextMenu } from "./paneContextMenu";
import { TmuxControllerErrorBanner } from "../terminal/view/TmuxControllerErrorBanner";
import {
  tmuxCommands,
  toBackendControllerHandle,
  toBackendWindowHandle,
} from "../tmux/infrastructure";
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
  const { terminals, closeTerminal, createTerminalFromSavedConfig } = useTerminalRuntime();
  const { workspaces, splitPane, closePane, updateWindowPaneTree } = useWorkspaceLayout();
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

  const terminal =
    pane.terminalId !== undefined ? terminals.find((s) => s.id === pane.terminalId) : undefined;
  const selectedWindow = workspace.windows.find((w) => w.id === windowId);
  const paneNumber = selectedWindow ? getPaneNumber(selectedWindow.rootPane, pane.id) : null;

  const handleStartSplit = useCallback(
    (direction: SplitDirection) => {
      // tmux panes (supportsMultiplex) split immediately
      // through the backend — no "pick a terminal from the dialog"
      // step because the new pane IS the new tmux pane. The
      // `tmux-pane-added` listener / `splitTmuxPaneInternal` updates
      // React state and the pane tree.
      if (
        terminal?.capabilities?.supportsMultiplex &&
        terminal.id !== undefined &&
        pane.terminalId !== undefined
      ) {
        splitPane(workspace.id, windowId, pane.id, direction, pane.terminalId);
        return;
      }
      // Non-multiplex path: open the dialog so the user picks what
      // terminal to attach to the new leaf.
      setPendingSplit(direction);
      setDialogMode("split");
      setShowSessionDialog(true);
    },
    [terminal, pane.terminalId, splitPane, workspace.id, windowId, pane.id],
  );

  const handleStartAttach = useCallback(() => {
    setPendingSplit(null);
    setDialogMode("attach");
    setShowSessionDialog(true);
  }, []);

  const attachTerminalToPane = useCallback(
    (terminalId: number) => {
      if (isSessionUsedInOtherWindow(workspaces, workspace.id, windowId, terminalId)) {
        window.alert("Terminal is already used in another window");
        return;
      }
      const attachedSession = terminals.find((s) => s.id === terminalId);
      updateWindowPaneTree(workspace.id, windowId, (root) =>
        paneTree.replacePaneNode(root, pane.id, {
          ...pane,
          terminalId,
          configId: attachedSession?.configId,
        }),
      );
      onActivate();
    },
    [workspaces, workspace.id, windowId, pane, terminals, updateWindowPaneTree, onActivate],
  );

  const handleSelectSession = useCallback(
    (terminalId: number) => {
      if (!startSubmitting()) return;
      try {
        if (dialogMode === "split" && pendingSplit) {
          const sessionConfigId = terminals.find((s) => s.id === terminalId)?.configId;
          splitPane(workspace.id, windowId, pane.id, pendingSplit, terminalId, sessionConfigId);
        } else if (dialogMode === "attach") {
          attachTerminalToPane(terminalId);
        }
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } catch (e) {
        if (e instanceof Error && e.message === "Terminal is already used in another window") {
          window.alert("Terminal is already used in another window");
        } else {
          window.alert(`Failed to attach terminal: ${e instanceof Error ? e.message : String(e)}`);
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
      attachTerminalToPane,
      terminals,
    ],
  );

  const handleSelectConfig = useCallback(
    async (configId: string) => {
      if (!startSubmitting()) return;
      try {
        const terminal = await createTerminalFromSavedConfig(configId);
        if (dialogMode === "split" && pendingSplit) {
          splitPane(workspace.id, windowId, pane.id, pendingSplit, terminal.id, terminal.configId);
        } else if (dialogMode === "attach") {
          attachTerminalToPane(terminal.id);
        }
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } catch (e) {
        if (e instanceof Error && e.message === "Terminal is already used in another window") {
          window.alert("Terminal is already used in another window");
        } else {
          window.alert(`Failed to create terminal: ${e instanceof Error ? e.message : String(e)}`);
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
      createTerminalFromSavedConfig,
      attachTerminalToPane,
    ],
  );

  const handleCloseSession = useCallback(() => {
    if (pane.terminalId !== undefined) {
      closeTerminal(pane.terminalId);
    }
  }, [pane.terminalId, closeTerminal]);

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
    if (terminal?.tmuxSessionId === undefined) return;
    try {
      await tmuxCommands.createTmuxWindow(toBackendControllerHandle(terminal.tmuxSessionId));
    } catch (e) {
      console.error("Failed to create tmux window:", e);
      window.alert(`Failed to create tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [terminal?.tmuxSessionId]);

  const handleKillTmuxWindow = useCallback(async () => {
    const xid = selectedWindow?.xstermWindowId;
    if (xid === undefined) return;
    try {
      await tmuxCommands.killTmuxWindow(toBackendWindowHandle(xid));
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
      await tmuxCommands.renameTmuxWindow(toBackendWindowHandle(xid), name.trim());
    } catch (e) {
      console.error("Failed to rename tmux window:", e);
      window.alert(`Failed to rename tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedWindow?.xstermWindowId]);

  const contextMenuItems = buildPaneContextMenu(
    terminal,
    {
      startSplit: handleStartSplit,
      startAttach: handleStartAttach,
      selectAll: handleSelectAll,
      copy: handleCopy,
      paste: handlePaste,
      clear: handleClear,
      closePane: handleClosePane,
      closeTerminal: handleCloseSession,
      createTmuxWindow: handleCreateTmuxWindow,
      killTmuxWindow: handleKillTmuxWindow,
      renameTmuxWindow: handleRenameTmuxWindow,
    },
    selectedWindow,
  );

  // hidden panes (from tmux -CC attach) are suppressed. MVP panes have is_hidden = false.
  if (terminal?.isHidden) {
    return null;
  }

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
          {terminal ? (
            <div className="pane-terminal-container">
              {!terminal.isConnected && (
                <div className="pane-disconnect-banner">
                  Connection lost. Press Enter to reconnect.
                </div>
              )}
              <TmuxControllerErrorBanner paneSessions={[terminal]} />
              <div className="pane-terminal-wrapper">
                <Terminal
                  ref={terminalRef}
                  terminalId={terminal.id}
                  kind={terminal.type}
                  isActive={isActive && isWindowActive}
                  isWindowActive={isWindowActive}
                  onFocus={onActivate}
                  isConnected={terminal.isConnected}
                  configId={terminal.configId}
                  displayConfig={terminal.displayConfig}
                />
              </div>
            </div>
          ) : (
            <PaneInitCard
              onTerminalCreated={(terminal) => attachTerminalToPane(terminal.id)}
              title="No terminal"
              subtitle="Create or open a terminal"
            />
          )}
        </div>
      </ContextMenu>
      <SelectTerminalDialog
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

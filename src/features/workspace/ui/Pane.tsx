import { useCallback, useRef, useState } from "react";
import type { PaneNode, SplitDirection } from "../../../models/runtime/pane";
import type { Workspace } from "../../../models/runtime/workspace";
import { isApplicationError } from "../../../models/applicationError";
import { useTerminalRuntime } from "../../terminal";
import { getPaneNumber } from "../application/paneTreeOperations";
import { useTheme } from "../../../shared/theme/ThemeContext";
import { Terminal, TmuxControllerErrorBanner, type TerminalRef } from "../../terminal-surface";
import { ContextMenu, type ContextMenuRef } from "../../../shared/ui/ContextMenu";
import { usePaneIntents } from "../state/PaneIntentContext";
import { PaneInitCard } from "./PaneInitCard";
import { buildPaneContextMenu } from "./paneContextMenu";
import { SelectTerminalDialog } from "./dialogs/SelectTerminalDialog";
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
  const { terminals } = useTerminalRuntime();
  const paneIntents = usePaneIntents();
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
        void paneIntents
          .splitPaneWithTerminal({
            workspaceId: workspace.id,
            windowId,
            paneId: pane.id,
            direction,
            terminalId: pane.terminalId,
            configId: pane.configId,
          })
          .catch((error) => {
            window.alert(
              `Failed to split terminal: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        return;
      }
      // Non-multiplex path: open the dialog so the user picks what
      // terminal to attach to the new leaf.
      setPendingSplit(direction);
      setDialogMode("split");
      setShowSessionDialog(true);
    },
    [terminal, pane.terminalId, pane.configId, paneIntents, workspace.id, windowId, pane.id],
  );

  const handleStartAttach = useCallback(() => {
    setPendingSplit(null);
    setDialogMode("attach");
    setShowSessionDialog(true);
  }, []);

  const attachTerminalToPane = useCallback(
    (terminalId: number) =>
      paneIntents.attachExistingTerminal({
        workspaceId: workspace.id,
        windowId,
        paneId: pane.id,
        terminalId,
      }),
    [paneIntents, workspace.id, windowId, pane.id],
  );

  const handleSelectSession = useCallback(
    async (terminalId: number) => {
      if (!startSubmitting()) return;
      try {
        if (dialogMode === "split" && pendingSplit) {
          const terminalConfigId = terminals.find((s) => s.id === terminalId)?.configId;
          await paneIntents.splitPaneWithTerminal({
            workspaceId: workspace.id,
            windowId,
            paneId: pane.id,
            direction: pendingSplit,
            terminalId,
            configId: terminalConfigId,
          });
        } else if (dialogMode === "attach") {
          await attachTerminalToPane(terminalId);
        }
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } catch (e) {
        if (isApplicationError(e, "terminal-already-attached")) {
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
      paneIntents,
      attachTerminalToPane,
      terminals,
    ],
  );

  const handleSelectConfig = useCallback(
    async (configId: string) => {
      if (!startSubmitting()) return;
      try {
        if (dialogMode === "split" && pendingSplit) {
          await paneIntents.splitPaneWithSavedConfig({
            workspaceId: workspace.id,
            windowId,
            paneId: pane.id,
            direction: pendingSplit,
            configId,
          });
        } else if (dialogMode === "attach") {
          await paneIntents.attachSavedConfigToPane({
            workspaceId: workspace.id,
            windowId,
            paneId: pane.id,
            configId,
          });
        }
        setPendingSplit(null);
        setDialogMode(null);
        setShowSessionDialog(false);
      } catch (e) {
        if (isApplicationError(e, "terminal-already-attached")) {
          window.alert("Terminal is already used in another window");
        } else {
          window.alert(`Failed to create terminal: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        endSubmitting();
      }
    },
    [dialogMode, pendingSplit, workspace.id, windowId, pane.id, paneIntents],
  );

  const handleCloseSession = useCallback(() => {
    if (pane.terminalId !== undefined) {
      void paneIntents.closeTerminal(pane.terminalId).catch((error) => {
        window.alert(
          `Failed to close terminal: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }, [pane.terminalId, paneIntents]);

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
    void paneIntents
      .closePane({
        workspaceId: workspace.id,
        windowId,
        paneId: pane.id,
      })
      .catch((error) => {
        window.alert(
          `Failed to close pane: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [paneIntents, workspace.id, windowId, pane.id]);

  const handleCreateTmuxWindow = useCallback(async () => {
    if (terminal?.tmuxSessionId === undefined) return;
    try {
      await paneIntents.createTmuxWindow(terminal.id);
    } catch (e) {
      console.error("Failed to create tmux window:", e);
      window.alert(`Failed to create Tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [paneIntents, terminal]);

  const handleKillTmuxWindow = useCallback(async () => {
    const xid = selectedWindow?.xstermWindowId;
    if (xid === undefined) return;
    try {
      await paneIntents.killTmuxWindow(xid);
    } catch (e) {
      console.error("Failed to kill tmux window:", e);
      window.alert(`Failed to kill Tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [paneIntents, selectedWindow?.xstermWindowId]);

  const handleRenameTmuxWindow = useCallback(async () => {
    const xid = selectedWindow?.xstermWindowId;
    if (xid === undefined) return;
    const name = window.prompt("Rename Tmux window:");
    if (name === null || name.trim() === "") return;
    try {
      await paneIntents.renameTmuxWindow(xid, name.trim());
    } catch (e) {
      console.error("Failed to rename tmux window:", e);
      window.alert(`Failed to rename Tmux window: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [paneIntents, selectedWindow?.xstermWindowId]);

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

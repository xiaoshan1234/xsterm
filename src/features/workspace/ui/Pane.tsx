import { useCallback, useRef } from "react";
import type { WindowId } from "../../../models";
import type { EditablePaneNode, Workspace } from "../contracts";
import { useTerminalRuntime } from "../../terminal";
import { getPaneNumber } from "../application/paneTreeOperations";
import { useTheme } from "../../../shared/theme/ThemeContext";
import { Terminal, TmuxControllerErrorBanner, type TerminalRef } from "../../terminal-surface";
import { ContextMenu, type ContextMenuRef } from "../../../shared/ui/ContextMenu";
import { usePaneIntents } from "../state/PaneIntentContext";
import { usePaneSessionIntents } from "../state/PaneSessionIntentContext";
import { useWorkspacePaneRuntimeActions } from "../state/WorkspacePaneRuntimeActionsContext";
import { PaneInitCard } from "./PaneInitCard";
import { buildPaneContextMenu } from "./paneContextMenu";
import { SelectTerminalDialog } from "./dialogs/SelectTerminalDialog";
import { usePaneRuntimeCommands } from "./usePaneRuntimeCommands";
import { usePaneSessionDialogController } from "./usePaneSessionDialogController";
import "./Pane.css";

interface PaneProps {
  workspace: Workspace;
  windowId: WindowId;
  pane: EditablePaneNode;
  isActive: boolean;
  isWindowActive: boolean;
  onActivate: () => void;
}

export function Pane({
  workspace,
  windowId,
  pane,
  isActive,
  isWindowActive,
  onActivate,
}: PaneProps) {
  const { terminals, applyDisplayConfigToLiveSession } = useTerminalRuntime();
  const paneRuntimeActions = useWorkspacePaneRuntimeActions();
  const paneIntents = usePaneIntents();
  const paneSessionIntents = usePaneSessionIntents();
  const { currentTheme } = useTheme();
  const contextMenuRef = useRef<ContextMenuRef>(null);
  const terminalRef = useRef<TerminalRef>(null);

  const terminal =
    pane.terminalId !== undefined
      ? terminals.find((session) => session.id === pane.terminalId)
      : undefined;
  const selectedWindow = workspace.windows.find((candidate) => candidate.id === windowId);
  const paneNumber = selectedWindow ? getPaneNumber(selectedWindow.rootPane, pane.id) : null;
  const reportError = useCallback((title: string, cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    window.alert(`${title}: ${message}`);
  }, []);

  const sessionDialog = usePaneSessionDialogController({
    workspaceId: workspace.id,
    windowId,
    paneId: pane.id,
    terminal,
    paneTerminalId: pane.terminalId,
    paneConfigId: pane.configId,
    terminals,
    paneIntents,
    paneSessionIntents,
    reportError,
  });
  const runtimeCommands = usePaneRuntimeCommands({
    workspaceId: workspace.id,
    windowId,
    paneId: pane.id,
    terminal,
    selectedWindow,
    paneIntents,
    paneRuntimeActions,
    reportError,
  });

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const toggleGutter = useCallback(() => {
    if (!terminal) return;
    applyDisplayConfigToLiveSession(terminal.id, {
      gutterEnabled: !(terminal.displayConfig?.gutterEnabled ?? true),
    });
  }, [applyDisplayConfigToLiveSession, terminal]);

  const selectAll = useCallback(() => {
    terminalRef.current?.selectAll();
  }, []);

  const copySelection = useCallback(async () => {
    await terminalRef.current?.copySelection();
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    await terminalRef.current?.pasteFromClipboard();
  }, []);

  const handleContextMenuCapture = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    contextMenuRef.current?.open(event.clientX, event.clientY);
  }, []);

  const renameMultiplexedWindow = useCallback(async () => {
    const name = window.prompt("Rename Tmux window:");
    if (name !== null) {
      await runtimeCommands.renameMultiplexedWindow(name);
    }
  }, [runtimeCommands]);

  const contextMenuItems = buildPaneContextMenu(
    terminal,
    {
      startSplit: sessionDialog.startSplit,
      startAttach: sessionDialog.startAttach,
      selectAll,
      copy: copySelection,
      paste: pasteFromClipboard,
      clear: clearTerminal,
      toggleGutter,
      closePane: runtimeCommands.closePane,
      closeTerminal: runtimeCommands.closeTerminal,
      createTmuxWindow: runtimeCommands.createMultiplexedWindow,
      killTmuxWindow: runtimeCommands.closeMultiplexedWindow,
      renameTmuxWindow: renameMultiplexedWindow,
    },
    selectedWindow,
  );

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
                  bookmarks={terminal.bookmarks}
                />
              </div>
            </div>
          ) : (
            <PaneInitCard
              onAttachExistingTerminal={sessionDialog.attachTerminalToPane}
              onCreateLocal={(config, save) =>
                paneSessionIntents.createLocalTerminalForPane({
                  workspaceId: workspace.id,
                  windowId,
                  paneId: pane.id,
                  config,
                  save,
                })
              }
              onCreateSsh={(config, save) =>
                paneSessionIntents.createSshTerminalForPane({
                  workspaceId: workspace.id,
                  windowId,
                  paneId: pane.id,
                  config,
                  save,
                })
              }
              onCreateFromSavedConfig={(configId) =>
                paneSessionIntents.attachSavedConfigToPane({
                  workspaceId: workspace.id,
                  windowId,
                  paneId: pane.id,
                  configId,
                })
              }
              title="No terminal"
              subtitle="Create or open a terminal"
            />
          )}
        </div>
      </ContextMenu>
      <SelectTerminalDialog
        isOpen={sessionDialog.showSessionDialog}
        onClose={sessionDialog.closeDialog}
        onSelectSession={sessionDialog.selectSession}
        onSelectConfig={sessionDialog.selectConfig}
        disabled={sessionDialog.isSubmitting}
      />
    </>
  );
}

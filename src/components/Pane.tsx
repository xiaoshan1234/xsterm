import { useCallback, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { PaneNode, SplitDirection, Workspace } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import * as paneTree from "../utils/paneTree";
import { isSessionUsedInOtherWindow, getPaneNumber } from "../contexts/session/paneUtils";
import { useTheme } from "../contexts/ThemeContext";
import Terminal, { TerminalRef } from "./Terminal";
import { ContextMenu, ContextMenuItem, ContextMenuRef } from "./ui/ContextMenu";
import { SelectSessionDialog } from "./dialogs/SelectSessionDialog";
import { PaneInitCard } from "./PaneInitCard";

interface PaneProps {
  workspace: Workspace;
  windowId: string;
  pane: PaneNode;
  isActive: boolean;
  isWindowActive: boolean;
  onActivate: () => void;
}

type DialogMode = "split" | "attach";

export function Pane({ workspace, windowId, pane, isActive, isWindowActive, onActivate }: PaneProps) {
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

  const session = pane.sessionId !== undefined ? sessions.find((s) => s.id === pane.sessionId) : undefined;
  const selectedWindow = workspace.windows.find((w) => w.id === windowId);
  const paneNumber = selectedWindow ? getPaneNumber(selectedWindow.rootPane, pane.id) : null;

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
    [dialogMode, pendingSplit, workspace.id, windowId, pane.id, splitPane, attachSessionToPane, sessions]
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
    [dialogMode, pendingSplit, workspace.id, windowId, pane.id, splitPane, createSessionFromSavedConfig, attachSessionToPane]
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
      }
    );

    if (session.is_connected) {
      contextMenuItems.push({
        label: "Paste",
        onClick: handlePaste,
      });
    }

    contextMenuItems.push({
      label: "Clear Pane",
      onClick: handleClear,
    });
  }

  contextMenuItems.push({
    label: "Close Pane",
    onClick: () => closePane(workspace.id, windowId, pane.id),
    danger: true,
  });

  if (session) {
    contextMenuItems.push({
      label: "Close Session",
      onClick: handleCloseSession,
      danger: true,
    });
  }

  return (
    <>
      <ContextMenu ref={contextMenuRef} items={contextMenuItems} className="pane-leaf">
        <Box
          sx={{
            flex: 1,
            overflow: "hidden",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            width: "100%",
            height: "100%",
            background: "var(--bg-primary)",
            ...(isActive && {
              outline: "2px solid var(--accent)",
              outlineOffset: "-2px",
            }),
          }}
          onMouseDown={onActivate}
          onContextMenuCapture={handleContextMenuCapture}
        >
          {paneNumber !== null && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                right: 0,
                zIndex: 20,
                padding: "1px 4px",
                fontSize: "10px",
                fontWeight: 600,
                lineHeight: 1,
                color: "var(--text-muted)",
                borderTop: "1px solid transparent",
                borderRight: "1px solid var(--border-color)",
                borderBottom: "1px solid var(--border-color)",
                borderLeft: "1px solid var(--border-color)",
                borderRadius: 0,
                pointerEvents: "none",
                userSelect: "none",
                opacity: 0.9,
                width: "auto",
                background: currentTheme.background,
              }}
            >
              {paneNumber}
            </Box>
          )}
          {session ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                minWidth: 0,
                minHeight: 0,
                flex: 1,
                width: "100%",
              }}
            >
              {!session.is_connected && (
                <Box
                  sx={{
                    flexShrink: 0,
                    padding: "8px 12px",
                    background: "var(--error-bg)",
                    color: "var(--error)",
                    fontSize: "13px",
                    fontWeight: 500,
                    textAlign: "center",
                    borderBottom: "1px solid var(--error)",
                    userSelect: "none",
                    pointerEvents: "none",
                  }}
                >
                  连接已经断开，输入回车重新进行连接
                </Box>
              )}
              <Box
                sx={{
                  flex: 1,
                  overflow: "hidden",
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                <Terminal ref={terminalRef} sessionId={session.id} sessionType={session.type} isActive={isActive && isWindowActive} isWindowActive={isWindowActive} onFocus={onActivate} isConnected={session.is_connected} configId={session.configId} displayConfig={session.displayConfig} />
              </Box>
            </Box>
          ) : (
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                width: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <PaneInitCard
                onSessionCreated={(session) => attachSessionToPane(session.id)}
                title="No session"
                subtitle="Create or open a session"
              />
            </Box>
          )}
          </Box>
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

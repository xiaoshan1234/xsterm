import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GROUP_ID } from "../../features/launch-config";
import { AppShell, type AppShellProps } from "./AppShell";
import { useTerminalRuntime } from "../../features/terminal";
import { TerminalViewportProvider, useTerminalViewport } from "../../features/terminal-surface";
import { GlobalTextSender } from "../../features/command-sender";
import { TOOL_TITLES } from "./types";
import { RuntimeOverlays } from "./RuntimeOverlays";
import { useKeybindingDispatcher } from "../application/keybindings";
import { useShellModel } from "../application/shellModel/useShellModel";
import { RuntimeTerminalSurfacePortsProvider } from "../application/terminalSurface/TerminalSurfacePortsProvider";
import { RuntimeToolPanelContainer } from "./RuntimeToolPanelContainer";
import { RuntimeNavBarContainer } from "./RuntimeNavBarContainer";
import { RuntimeMainArea } from "./RuntimeMainArea";
import { useRuntimeTextSender } from "./useRuntimeTextSender";
import { ApplicationFeedbackProvider } from "../../shared/ui/ApplicationFeedbackContext";
import { useApplicationPersistenceStatus } from "../application/assembly";
import { useRuntimeOverlayController } from "./useRuntimeOverlayController";
import { useRuntimeShellUiState } from "./useRuntimeShellUiState";

type RuntimeAppShellProps = Omit<
  AppShellProps,
  "bookmarkCount" | "bookmarkIndex" | "onPrevBookmark" | "onNextBookmark"
>;

function RuntimeAppShell(props: RuntimeAppShellProps) {
  const { terminals } = useTerminalRuntime();
  const viewport = useTerminalViewport();
  const { runtimeStatus } = props;
  const [currentBookmarkIndex, setCurrentBookmarkIndex] = useState(0);

  const bookmarkLines = useMemo(() => {
    if (!runtimeStatus) return [];
    const terminal = terminals.find((candidate) => candidate.id === runtimeStatus.terminalId);
    return terminal?.bookmarks
      ? terminal.bookmarks.map((bookmark) => bookmark.line).sort((a, b) => a - b)
      : [];
  }, [runtimeStatus, terminals]);

  useEffect(() => {
    setCurrentBookmarkIndex(0);
  }, [runtimeStatus?.terminalId]);

  const onPrevBookmark = useCallback(() => {
    if (!runtimeStatus || bookmarkLines.length === 0) return;
    const top = viewport.getTopLine(runtimeStatus.terminalId) ?? 0;
    let target = bookmarkLines[bookmarkLines.length - 1];
    let targetIndex = bookmarkLines.length - 1;
    for (let index = bookmarkLines.length - 1; index >= 0; index--) {
      if (bookmarkLines[index] < top) {
        target = bookmarkLines[index];
        targetIndex = index;
        break;
      }
    }
    viewport.scrollToLine(runtimeStatus.terminalId, target);
    setCurrentBookmarkIndex(targetIndex + 1);
  }, [bookmarkLines, runtimeStatus, viewport]);

  const onNextBookmark = useCallback(() => {
    if (!runtimeStatus || bookmarkLines.length === 0) return;
    const top = viewport.getTopLine(runtimeStatus.terminalId) ?? 0;
    let target = bookmarkLines[0];
    let targetIndex = 0;
    for (let index = 0; index < bookmarkLines.length; index++) {
      const line = bookmarkLines[index];
      if (line > top) {
        target = line;
        targetIndex = index;
        break;
      }
    }
    viewport.scrollToLine(runtimeStatus.terminalId, target);
    setCurrentBookmarkIndex(targetIndex + 1);
  }, [bookmarkLines, runtimeStatus, viewport]);

  return (
    <AppShell
      {...props}
      bookmarkCount={bookmarkLines.length}
      bookmarkIndex={Math.min(currentBookmarkIndex, bookmarkLines.length)}
      onPrevBookmark={onPrevBookmark}
      onNextBookmark={onNextBookmark}
    />
  );
}

export function AppShellRuntime() {
  const shellModel = useShellModel();
  const { saveError, clearSaveError } = useApplicationPersistenceStatus();
  const { terminalRuntime, workspaceLayout, activeWorkspace, runtimeStatus, paneTargetOptions } =
    shellModel;
  const { writeTerminal } = terminalRuntime;
  const { workspaces, createDefaultWorkspace } = workspaceLayout;

  const paneTargetKeys = useMemo(
    () => paneTargetOptions.map((option) => option.targetKey),
    [paneTargetOptions],
  );
  const shellUi = useRuntimeShellUiState(paneTargetKeys);
  const overlayController = useRuntimeOverlayController({
    saveError,
    clearSaveError,
  });
  const initializedRef = useRef(false);

  useKeybindingDispatcher({
    onCreateSession: () =>
      overlayController.openDialog({
        kind: "create-terminal",
        initialTab: "local",
        groupId: DEFAULT_GROUP_ID,
      }),
    onToggleLogs: () => undefined,
    onToggleToolPanel: shellUi.toggleToolPanel,
    onCycleToolPanel: shellUi.cycleTool,
  });

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (workspaces.length === 0) {
      createDefaultWorkspace();
    }
  }, [createDefaultWorkspace, workspaces.length]);

  const { targets: textSenderTargets, sendText: sendTextToTarget } = useRuntimeTextSender({
    paneTargetOptions,
    selectedTargetKey: shellUi.selectedTargetKey,
    writeTerminal,
    onError: overlayController.showError,
  });

  const toolPanelContent = (
    <RuntimeToolPanelContainer
      model={shellModel}
      activeTool={shellUi.activeTool}
      onOpenDialog={overlayController.openDialog}
      onRequestConfirm={overlayController.requestConfirm}
      onError={overlayController.showError}
    />
  );

  const overlays = (
    <RuntimeOverlays
      dialog={overlayController.dialog}
      error={overlayController.error}
      confirm={overlayController.confirm}
      helpDialog={overlayController.helpDialog}
      onCloseDialog={overlayController.closeDialog}
      onDismissConfirm={overlayController.dismissConfirm}
      onAcknowledgeError={overlayController.acknowledgeError}
      onCloseHelp={overlayController.closeHelp}
    />
  );

  const feedback = useMemo(
    () => ({
      reportError: overlayController.showError,
    }),
    [overlayController.showError],
  );

  return (
    <ApplicationFeedbackProvider value={feedback}>
      <RuntimeTerminalSurfacePortsProvider>
        <TerminalViewportProvider>
          <RuntimeAppShell
            activeTool={shellUi.activeTool}
            navBar={
              <RuntimeNavBarContainer
                model={shellModel}
                isTextSenderOpen={shellUi.isTextSenderOpen}
                onToggleTextSender={shellUi.toggleTextSender}
                onHelpAction={overlayController.openHelp}
                onError={overlayController.showError}
              />
            }
            toolTitle={shellUi.activeTool ? TOOL_TITLES[shellUi.activeTool] : ""}
            toolPanelContent={toolPanelContent}
            mainArea={
              <RuntimeMainArea
                workspaces={workspaces}
                activeWorkspace={activeWorkspace}
                onCreateWorkspace={createDefaultWorkspace}
              />
            }
            textSender={
              <GlobalTextSender
                targets={textSenderTargets}
                selectedTargetId={shellUi.selectedTargetKey}
                onSelectTarget={shellUi.setSelectedTargetKey}
                onSend={sendTextToTarget}
              />
            }
            overlay={overlays}
            runtimeStatus={runtimeStatus}
            isTextSenderOpen={shellUi.isTextSenderOpen}
            isInteractionBlocked={overlayController.error !== null}
            onSelectTool={shellUi.toggleTool}
          />
        </TerminalViewportProvider>
      </RuntimeTerminalSurfacePortsProvider>
    </ApplicationFeedbackProvider>
  );
}

import { useEffect, useMemo, useRef } from "react";
import { DEFAULT_GROUP_ID } from "../../features/launch-config";
import { AppShell } from "./AppShell";
import { GlobalTextSender } from "../../features/command-sender";
import { TOOL_TITLES } from "./types";
import { RuntimeOverlays } from "./RuntimeOverlays";
import { useAppShortcuts } from "../useAppShortcuts";
import { useRuntimeShellModel } from "../application/runtimeShell/useRuntimeShellModel";
import { RuntimeTerminalSurfacePortsProvider } from "../application/terminalSurface/TerminalSurfacePortsProvider";
import { RuntimeToolPanelContainer } from "./RuntimeToolPanelContainer";
import { RuntimeNavBarContainer } from "./RuntimeNavBarContainer";
import { RuntimeMainArea } from "./RuntimeMainArea";
import { useRuntimeTextSender } from "./useRuntimeTextSender";
import { ApplicationFeedbackProvider } from "../../shared/ui/ApplicationFeedbackContext";
import { useSessionPersistenceStatus } from "../application/session";
import { useRuntimeOverlayController } from "./useRuntimeOverlayController";
import { useRuntimeShellUiState } from "./useRuntimeShellUiState";

export function AppShellRuntime() {
  const shellModel = useRuntimeShellModel();
  const { saveError, clearSaveError } = useSessionPersistenceStatus();
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

  useAppShortcuts({
    onCreateSession: () =>
      overlayController.openDialog({
        kind: "create-terminal",
        initialTab: "local",
        groupId: DEFAULT_GROUP_ID,
      }),
    onToggleLogs: () => undefined,
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
        <AppShell
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
      </RuntimeTerminalSurfacePortsProvider>
    </ApplicationFeedbackProvider>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GROUP_ID } from "../../features/launch-config";
import { AppShell } from "./AppShell";
import { GlobalTextSender } from "../../features/command-sender";
import { TOOL_TITLES, type ToolId } from "./types";
import { type HelpDialogId } from "./HelpDialog";
import { RuntimeOverlays } from "./RuntimeOverlays";
import {
  type RuntimeConfirmState,
  type RuntimeDialog,
  type RuntimeErrorState,
} from "./runtimeOverlayTypes";
import { useAppShortcuts } from "../useAppShortcuts";
import { useRuntimeShellModel } from "../application/runtimeShell/useRuntimeShellModel";
import { RuntimeTerminalSurfacePortsProvider } from "../application/terminalSurface/TerminalSurfacePortsProvider";
import { RuntimeToolPanelContainer } from "./RuntimeToolPanelContainer";
import { RuntimeNavBarContainer } from "./RuntimeNavBarContainer";
import { RuntimeMainArea } from "./RuntimeMainArea";
import { useRuntimeTextSender } from "./useRuntimeTextSender";
import { ApplicationFeedbackProvider } from "../../shared/ui/ApplicationFeedbackContext";

export function AppShellRuntime() {
  const shellModel = useRuntimeShellModel();
  const { terminalRuntime, workspaceLayout, activeWorkspace, runtimeStatus, paneTargetOptions } =
    shellModel;
  const { writeTerminal } = terminalRuntime;
  const { workspaces, createDefaultWorkspace } = workspaceLayout;

  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [isTextSenderOpen, setIsTextSenderOpen] = useState(false);
  const [dialog, setDialog] = useState<RuntimeDialog>(null);
  const [confirm, setConfirm] = useState<RuntimeConfirmState | null>(null);
  const [error, setError] = useState<RuntimeErrorState | null>(null);
  const [helpDialog, setHelpDialog] = useState<HelpDialogId | null>(null);
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const initializedRef = useRef(false);

  useAppShortcuts({
    onCreateSession: () =>
      setDialog({
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

  useEffect(() => {
    if (
      paneTargetOptions.length > 0 &&
      !paneTargetOptions.some((option) => option.targetKey === selectedTargetKey)
    ) {
      setSelectedTargetKey(paneTargetOptions[0].targetKey);
    }
    if (paneTargetOptions.length === 0 && selectedTargetKey) {
      setSelectedTargetKey("");
    }
  }, [paneTargetOptions, selectedTargetKey]);

  const showError = useCallback((title: string, cause: unknown) => {
    setError({
      title,
      message: cause instanceof Error ? cause.message : String(cause),
      details: cause instanceof Error ? cause.stack : undefined,
    });
  }, []);

  const { targets: textSenderTargets, sendText: sendTextToTarget } = useRuntimeTextSender({
    paneTargetOptions,
    selectedTargetKey,
    writeTerminal,
    onError: showError,
  });

  const toolPanelContent = (
    <RuntimeToolPanelContainer
      model={shellModel}
      activeTool={activeTool}
      onOpenDialog={setDialog}
      onRequestConfirm={setConfirm}
      onError={showError}
    />
  );

  const overlay = (
    <RuntimeOverlays
      dialog={dialog}
      error={error}
      confirm={confirm}
      helpDialog={helpDialog}
      onCloseDialog={() => setDialog(null)}
      onDismissConfirm={() => setConfirm(null)}
      onAcknowledgeError={() => setError(null)}
      onCloseHelp={() => setHelpDialog(null)}
    />
  );

  const feedback = useMemo(
    () => ({
      reportError: showError,
    }),
    [showError],
  );

  return (
    <ApplicationFeedbackProvider value={feedback}>
      <RuntimeTerminalSurfacePortsProvider>
        <AppShell
          activeTool={activeTool}
          navBar={
            <RuntimeNavBarContainer
              model={shellModel}
              isTextSenderOpen={isTextSenderOpen}
              onToggleTextSender={() => setIsTextSenderOpen((current) => !current)}
              onHelpAction={setHelpDialog}
              onError={showError}
            />
          }
          toolTitle={activeTool ? TOOL_TITLES[activeTool] : ""}
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
              selectedTargetId={selectedTargetKey}
              onSelectTarget={setSelectedTargetKey}
              onSend={sendTextToTarget}
            />
          }
          overlay={overlay}
          runtimeStatus={runtimeStatus}
          isTextSenderOpen={isTextSenderOpen}
          isInteractionBlocked={error !== null}
          onSelectTool={(tool) =>
            setActiveTool((currentTool) => (currentTool === tool ? null : tool))
          }
        />
      </RuntimeTerminalSurfacePortsProvider>
    </ApplicationFeedbackProvider>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GROUP_ID, useSavedLaunchConfigs } from "../../features/launch-config";
import { useTerminalRuntime } from "../../features/terminal";
import { useWorkspaceLayout } from "../../features/workspace";
import NavBar from "../NavBar";
import { selectWindowManagerItems, selectWorkspaceManagerItems } from "../../features/workspace";
import { selectTerminalManagerGroups } from "../../features/terminal";
import {
  selectTmuxManagerGroups,
  selectTmuxStatusControllers,
  tmuxSessionBaseKey,
  tmuxSessionKey,
  useTmuxRuntime,
} from "../../features/tmux";
import { selectPaneTargetOptions } from "../../features/command-sender";
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
import { selectRuntimeStatus } from "./runtimeStatusViewModel";
import { RuntimeToolPanel } from "./RuntimeToolPanel";
import { RuntimeMainArea } from "./RuntimeMainArea";
import { useRuntimeTextSender } from "./useRuntimeTextSender";
import { ApplicationFeedbackProvider } from "../../shared/ui/ApplicationFeedbackContext";

export function AppShellRuntime() {
  const { terminals, writeTerminal, getTerminalSize } = useTerminalRuntime();
  const { detachTmuxSession, openTmuxSessions } = useTmuxRuntime();
  const { savedConfigs, groups, removeConfig, toggleGroup, deleteGroup } = useSavedLaunchConfigs();
  const {
    workspaces,
    activeWorkspaceId,
    savedWorkspaces,
    savedWindowConfigs,
    setActiveWorkspace,
    createWindowFromSavedConfig,
    createWindow,
    loadWindow,
    loadWorkspace,
    createDefaultWorkspace,
    createEmptyWorkspace,
    closeWorkspace,
    deleteSavedWindow,
    deleteSavedWorkspace,
  } = useWorkspaceLayout();

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

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null;

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (workspaces.length === 0) {
      createDefaultWorkspace();
    }
  }, [createDefaultWorkspace, workspaces.length]);

  const terminalManagerGroups = useMemo(
    () => selectTerminalManagerGroups(savedConfigs, groups),
    [groups, savedConfigs],
  );
  const openTmuxSessionKeys = new Set(
    openTmuxSessions.map((session) => tmuxSessionKey(session.config)),
  );
  const openTmuxConfigIds = new Set(
    openTmuxSessions
      .map((session) => session.configId)
      .filter((configId): configId is string => configId !== undefined),
  );
  const openTmuxBaseKeys = new Set(
    openTmuxSessions.map((session) => tmuxSessionBaseKey(session.config)),
  );
  const tmuxManagerGroups = selectTmuxManagerGroups(
    savedConfigs,
    openTmuxSessionKeys,
    openTmuxConfigIds,
    openTmuxBaseKeys,
  );
  const tmuxStatusControllers = useMemo(
    () => selectTmuxStatusControllers(terminals, workspaces, savedConfigs),
    [savedConfigs, terminals, workspaces],
  );
  const runtimeStatus = selectRuntimeStatus(
    activeWorkspace,
    terminals,
    tmuxStatusControllers,
    getTerminalSize,
  );
  const windowManagerItems = useMemo(
    () => selectWindowManagerItems(savedWindowConfigs),
    [savedWindowConfigs],
  );
  const workspaceManagerItems = useMemo(
    () => selectWorkspaceManagerItems(savedWorkspaces, workspaces),
    [savedWorkspaces, workspaces],
  );
  const paneTargetOptions = useMemo(
    () => selectPaneTargetOptions(workspaces, terminals, savedConfigs),
    [savedConfigs, terminals, workspaces],
  );

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

  const openConfig = useCallback(
    (configId: string) => {
      createWindowFromSavedConfig(configId).catch((cause) =>
        showError("Unable to open saved configuration", cause),
      );
    },
    [createWindowFromSavedConfig, showError],
  );

  const openEditTerminalConfig = useCallback(
    (configId: string) => {
      const config = savedConfigs.find((candidate) => candidate.id === configId);
      if (config?.type === "local" || config?.type === "ssh") {
        setDialog({ kind: "edit-terminal", config });
      }
    },
    [savedConfigs],
  );

  const openEditTmuxConfig = useCallback(
    (configId: string) => {
      const config = savedConfigs.find((candidate) => candidate.id === configId);
      if (config?.type === "tmux-pane") {
        setDialog({ kind: "edit-tmux", config });
      }
    },
    [savedConfigs],
  );

  const openWorkspace = useCallback(
    (configId: string, isLoaded: boolean) => {
      if (isLoaded) {
        const loadedWorkspace = workspaces.find(
          (workspace) => workspace.savedWorkspaceId === configId,
        );
        if (loadedWorkspace) {
          setActiveWorkspace(loadedWorkspace.id);
          return;
        }
      }
      loadWorkspace(configId).catch((cause) => showError("Unable to load workspace", cause));
    },
    [loadWorkspace, setActiveWorkspace, showError, workspaces],
  );

  const detachTmuxConfig = useCallback(
    (configId: string) => {
      const target = savedConfigs.find((config) => config.id === configId);
      if (target?.type !== "tmux-pane") return;
      const targetKey = tmuxSessionKey(target.config);
      const openSession = openTmuxSessions.find(
        (session) => session.configId === configId || tmuxSessionKey(session.config) === targetKey,
      );
      if (!openSession) return;
      void detachTmuxSession(openSession.controllerId).catch((cause) =>
        showError("Unable to detach tmux session", cause),
      );
    },
    [detachTmuxSession, openTmuxSessions, savedConfigs, showError],
  );

  const { targets: textSenderTargets, sendText: sendTextToTarget } = useRuntimeTextSender({
    paneTargetOptions,
    selectedTargetKey,
    writeTerminal,
    onError: showError,
  });

  const toolPanelContent = (
    <RuntimeToolPanel
      activeTool={activeTool}
      terminalManagerGroups={terminalManagerGroups}
      tmuxManagerGroups={tmuxManagerGroups}
      windowManagerItems={windowManagerItems}
      workspaceManagerItems={workspaceManagerItems}
      onCreateTerminal={() =>
        setDialog({
          kind: "create-terminal",
          initialTab: "local",
          groupId: DEFAULT_GROUP_ID,
        })
      }
      onCreateTmux={() => setDialog({ kind: "create-tmux" })}
      onAttachTmux={() => setDialog({ kind: "attach-tmux" })}
      onNewGroup={() => setDialog({ kind: "new-group" })}
      onToggleGroup={toggleGroup}
      onEditGroup={(groupId) => setDialog({ kind: "edit-group", groupId })}
      onDeleteGroup={(groupId) =>
        setConfirm({
          title: "Delete terminal group?",
          message: "The group will be removed. Saved terminal configurations are kept.",
          confirmLabel: "Delete",
          action: () => deleteGroup(groupId),
        })
      }
      onOpenConfig={openConfig}
      onEditTerminalConfig={openEditTerminalConfig}
      onEditTmuxConfig={openEditTmuxConfig}
      onRemoveConfig={removeConfig}
      onDetachTmuxConfig={detachTmuxConfig}
      onCreateWindow={() => {
        if (activeWorkspace) {
          createWindow(activeWorkspace.id, undefined, undefined, undefined, "init");
        }
      }}
      onLoadWindow={(configId) => {
        if (activeWorkspace) {
          void loadWindow(configId, activeWorkspace.id).catch((cause) =>
            showError("Unable to load window", cause),
          );
        }
      }}
      onRenameWindow={(configId) => {
        const config = savedWindowConfigs.find((candidate) => candidate.id === configId);
        if (config) {
          setDialog({
            kind: "rename-window",
            configId,
            defaultName: config.name,
          });
        }
      }}
      onDeleteWindow={(configId) =>
        setConfirm({
          title: "Delete saved window?",
          message: "The saved window snapshot will be removed. Running panes stay open.",
          confirmLabel: "Delete",
          action: () => deleteSavedWindow(configId),
        })
      }
      onCreateWorkspace={() => createEmptyWorkspace()}
      onOpenWorkspace={openWorkspace}
      onRenameWorkspace={(configId) => {
        const config = savedWorkspaces.find((candidate) => candidate.id === configId);
        if (config) {
          setDialog({
            kind: "rename-workspace",
            configId,
            defaultName: config.name,
          });
        }
      }}
      onDeleteWorkspace={(configId) =>
        setConfirm({
          title: "Delete saved workspace?",
          message: "The saved workspace snapshot will be removed.",
          confirmLabel: "Delete",
          action: () => deleteSavedWorkspace(configId),
        })
      }
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
      <AppShell
        activeTool={activeTool}
        navBar={
          <NavBar
            terminalItems={(terminalManagerGroups[0]?.items ?? []).map((terminal) => ({
              configId: terminal.configId,
              name: terminal.name,
            }))}
            workspaces={workspaces.map((workspace) => workspace.name)}
            workspaceName={activeWorkspace?.name ?? "No workspace"}
            isTextSenderOpen={isTextSenderOpen}
            onSelectWorkspace={(workspaceName) => {
              const workspace = workspaces.find((candidate) => candidate.name === workspaceName);
              if (workspace) setActiveWorkspace(workspace.id);
            }}
            onCloseWorkspace={(workspaceName) => {
              const workspace = workspaces.find((candidate) => candidate.name === workspaceName);
              if (workspace) closeWorkspace(workspace.id);
            }}
            onToggleTextSender={() => setIsTextSenderOpen((current) => !current)}
            onHelpAction={setHelpDialog}
            onOpenTerminal={openConfig}
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
    </ApplicationFeedbackProvider>
  );
}

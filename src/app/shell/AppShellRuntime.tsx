import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_GROUP_ID,
  useSavedLaunchConfigs,
  useTerminalRuntime,
  useWorkspaceLayout,
} from "../../features/sessions";
import NavBar from "../NavBar";
import { WorkspaceContainer } from "../../features/workspace/WorkspaceContainer";
import { TerminalManagerPanel } from "../../features/terminal/ui/TerminalManagerPanel";
import { TmuxManagerPanel } from "../../features/tmux/ui/TmuxManagerPanel";
import { WindowManagerPanel, WorkspaceManagerPanel } from "../../features/workspace/ui";
import { SettingsPanel } from "../../features/settings/ui";
import { selectTerminalManagerGroups } from "../../features/terminal/viewModels/managerViewModel";
import { selectTmuxManagerGroups } from "../../features/tmux/viewModels/managerViewModel";
import { selectTmuxStatusControllers } from "../../features/tmux/viewModels/statusViewModel";
import {
  selectWindowManagerItems,
  selectWorkspaceManagerItems,
} from "../../features/workspace/viewModels/managerViewModel";
import { selectPaneTargetOptions } from "../../features/command-sender/viewModels/paneTargetViewModel";
import { AppShell } from "./AppShell";
import { ErrorDialog, type ErrorDialogData } from "./ErrorDialog";
import { GlobalOverlayHost } from "./GlobalOverlayHost";
import { GlobalTextSender } from "./GlobalTextSender";
import { TOOL_TITLES, type ToolId } from "./types";
import {
  CreateTerminalDialog,
  EditTerminalDialog,
  type EditableTerminalConfig,
} from "../../features/terminal/ui/dialogs";
import {
  AttachTmuxDialog,
  CreateTmuxDialog,
  EditTmuxDialog,
  type EditableTmuxConfig,
} from "../../features/tmux/ui/dialogs";
import { NewGroupDialog } from "../../features/terminal/ui/dialogs/NewGroupDialog";
import { EditGroupDialog } from "../../features/terminal/ui/dialogs/EditGroupDialog";
import { SaveDialog } from "../../features/workspace/dialogs/SaveDialog";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useTmuxAutoAttach } from "../../features/tmux/application/useTmuxAutoAttach";
import { useAppShortcuts } from "../useAppShortcuts";
import { selectRuntimeStatus } from "./runtimeStatusViewModel";

type RuntimeDialog =
  | { kind: "create-terminal"; initialTab: "local" | "ssh"; groupId: number }
  | { kind: "create-tmux" }
  | { kind: "attach-tmux" }
  | { kind: "edit-terminal"; config: EditableTerminalConfig }
  | { kind: "edit-tmux"; config: EditableTmuxConfig }
  | { kind: "new-group" }
  | { kind: "edit-group"; groupId: number }
  | { kind: "rename-window"; configId: string; defaultName: string }
  | { kind: "rename-workspace"; configId: string; defaultName: string }
  | null;

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void;
}

export function AppShellRuntime() {
  useTmuxAutoAttach();
  const {
    terminals,
    writeTerminal,
    createLocalSession,
    createSshSession,
    createTmuxSession,
    attachTmuxSession,
    applyDisplayConfigToLiveSession,
    terminalSizesRef,
  } = useTerminalRuntime();
  const {
    savedConfigs,
    groups,
    removeConfig,
    toggleGroup,
    createGroup,
    deleteGroup,
    moveConfigToGroup,
    renameGroup,
  } = useSavedLaunchConfigs();
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
    renameSavedWindow,
    deleteSavedWorkspace,
    renameSavedWorkspace,
  } = useWorkspaceLayout();

  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [isTextSenderOpen, setIsTextSenderOpen] = useState(false);
  const [dialog, setDialog] = useState<RuntimeDialog>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [error, setError] = useState<ErrorDialogData | null>(null);
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
  const tmuxManagerGroups = useMemo(() => selectTmuxManagerGroups(savedConfigs), [savedConfigs]);
  const tmuxStatusControllers = useMemo(
    () => selectTmuxStatusControllers(terminals, workspaces, savedConfigs),
    [savedConfigs, terminals, workspaces],
  );
  const runtimeStatus = selectRuntimeStatus(
    activeWorkspace,
    terminals,
    tmuxStatusControllers,
    terminalSizesRef.current,
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

  const selectTextSenderTarget = paneTargetOptions.find(
    (option) => option.targetKey === selectedTargetKey,
  );

  const textSenderTargets = paneTargetOptions.map((option) => ({
    id: option.targetKey,
    label: option.displayInfo.title,
    breadcrumb: option.displayInfo.breadcrumb,
    status: option.displayInfo.isAvailable ? "Connected" : "Unavailable",
    isAvailable: option.displayInfo.isAvailable,
  }));

  const sendTextToTarget = useCallback(
    async (text: string) => {
      if (!selectTextSenderTarget || !text) return;
      await writeTerminal(selectTextSenderTarget.terminalId, text).catch((cause) => {
        showError("Unable to send command", cause);
        throw cause;
      });
    },
    [selectTextSenderTarget, showError, writeTerminal],
  );

  const editingGroup =
    dialog?.kind === "edit-group"
      ? (groups.find((group) => group.id === dialog.groupId) ?? groups[0])
      : undefined;

  const toolPanelContent = useMemo(() => {
    switch (activeTool) {
      case "terminal-manager":
        return (
          <TerminalManagerPanel
            groups={terminalManagerGroups}
            onNewTerminal={() =>
              setDialog({
                kind: "create-terminal",
                initialTab: "local",
                groupId: DEFAULT_GROUP_ID,
              })
            }
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
            onEditConfig={openEditTerminalConfig}
            onRemoveConfig={removeConfig}
          />
        );
      case "tmux-manager":
        return (
          <TmuxManagerPanel
            groups={tmuxManagerGroups}
            onCreateTmux={() => setDialog({ kind: "create-tmux" })}
            onNewTmux={() => setDialog({ kind: "attach-tmux" })}
            onOpenConfig={openConfig}
            onEditConfig={openEditTmuxConfig}
            onRemoveConfig={removeConfig}
          />
        );
      case "window-manager":
        return (
          <WindowManagerPanel
            items={windowManagerItems}
            onNewWindow={() => {
              if (activeWorkspace)
                createWindow(activeWorkspace.id, undefined, undefined, undefined, "init");
            }}
            onLoad={(configId) => {
              if (activeWorkspace) {
                void loadWindow(configId, activeWorkspace.id).catch((cause) =>
                  showError("Unable to load window", cause),
                );
              }
            }}
            onRename={(configId) => {
              const config = savedWindowConfigs.find((candidate) => candidate.id === configId);
              if (config) {
                setDialog({
                  kind: "rename-window",
                  configId,
                  defaultName: config.name,
                });
              }
            }}
            onDelete={(configId) =>
              setConfirm({
                title: "Delete saved window?",
                message: "The saved window snapshot will be removed. Running panes stay open.",
                confirmLabel: "Delete",
                action: () => deleteSavedWindow(configId),
              })
            }
          />
        );
      case "workspace-manager":
        return (
          <WorkspaceManagerPanel
            items={workspaceManagerItems}
            onNewWorkspace={() => createEmptyWorkspace()}
            onOpen={openWorkspace}
            onRename={(configId) => {
              const config = savedWorkspaces.find((candidate) => candidate.id === configId);
              if (config) {
                setDialog({
                  kind: "rename-workspace",
                  configId,
                  defaultName: config.name,
                });
              }
            }}
            onDelete={(configId) =>
              setConfirm({
                title: "Delete saved workspace?",
                message: "The saved workspace snapshot will be removed.",
                confirmLabel: "Delete",
                action: () => deleteSavedWorkspace(configId),
              })
            }
          />
        );
      case "settings":
        return <SettingsPanel />;
      default:
        return null;
    }
  }, [
    activeTool,
    activeWorkspace,
    createEmptyWorkspace,
    createWindow,
    deleteGroup,
    deleteSavedWindow,
    deleteSavedWorkspace,
    loadWindow,
    openConfig,
    openEditTerminalConfig,
    openEditTmuxConfig,
    openWorkspace,
    removeConfig,
    savedWindowConfigs,
    savedWorkspaces,
    showError,
    terminalManagerGroups,
    tmuxManagerGroups,
    toggleGroup,
    windowManagerItems,
    workspaceManagerItems,
  ]);

  const overlay = (
    <GlobalOverlayHost>
      {!error && dialog?.kind === "create-terminal" && (
        <CreateTerminalDialog
          isOpen
          onClose={() => setDialog(null)}
          onCreateLocal={createLocalSession}
          onCreateSsh={createSshSession}
          initialTab={dialog.initialTab}
          initialGroupId={dialog.groupId}
        />
      )}
      {!error && dialog?.kind === "attach-tmux" && (
        <AttachTmuxDialog isOpen onClose={() => setDialog(null)} onAttachTmux={attachTmuxSession} />
      )}
      {!error && dialog?.kind === "create-tmux" && (
        <CreateTmuxDialog isOpen onClose={() => setDialog(null)} onCreateTmux={createTmuxSession} />
      )}
      {!error && dialog?.kind === "edit-terminal" && (
        <EditTerminalDialog
          isOpen
          onClose={() => setDialog(null)}
          config={dialog.config}
          groups={groups}
          groupId={findConfigGroupId(groups, dialog.config.id)}
          onSave={(config, groupId) => {
            moveConfigToGroup(config.id, groupId);
            const liveTerminal = terminals.find((terminal) => terminal.configId === config.id);
            if (liveTerminal && config.displayConfig) {
              applyDisplayConfigToLiveSession(liveTerminal.id, config.displayConfig);
            }
          }}
        />
      )}
      {!error && dialog?.kind === "edit-tmux" && (
        <EditTmuxDialog
          isOpen
          onClose={() => setDialog(null)}
          config={dialog.config}
          onSave={(config) => {
            const liveTerminal = terminals.find((terminal) => terminal.configId === config.id);
            if (liveTerminal && config.displayConfig) {
              applyDisplayConfigToLiveSession(liveTerminal.id, config.displayConfig);
            }
          }}
        />
      )}
      <NewGroupDialog
        isOpen={!error && dialog?.kind === "new-group"}
        onClose={() => setDialog(null)}
        existingGroupNames={groups.map((group) => group.name)}
        onCreate={(name) => {
          createGroup(name);
          setDialog(null);
        }}
      />
      {!error && editingGroup && (
        <EditGroupDialog
          isOpen
          group={editingGroup}
          groups={groups}
          onClose={() => setDialog(null)}
          onSave={(groupId, name) => {
            renameGroup(groupId, name);
            setDialog(null);
          }}
        />
      )}
      {!error && dialog?.kind === "rename-window" && (
        <SaveDialog
          isOpen
          onClose={() => setDialog(null)}
          onSave={(name) => renameSavedWindow(dialog.configId, name)}
          defaultName={dialog.defaultName}
          title="Rename Window"
          label="Window Name"
        />
      )}
      {!error && dialog?.kind === "rename-workspace" && (
        <SaveDialog
          isOpen
          onClose={() => setDialog(null)}
          onSave={(name) => renameSavedWorkspace(dialog.configId, name)}
          defaultName={dialog.defaultName}
          title="Rename Workspace"
          label="Workspace Name"
        />
      )}
      <ConfirmDialog
        isOpen={!error && confirm !== null}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.confirmLabel}
        isDanger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.action();
          setConfirm(null);
        }}
      />
      {error && <ErrorDialog error={error} onAcknowledge={() => setError(null)} />}
    </GlobalOverlayHost>
  );

  return (
    <AppShell
      activeTool={activeTool}
      navBar={<NavBar />}
      toolTitle={activeTool ? TOOL_TITLES[activeTool] : ""}
      toolPanelContent={toolPanelContent}
      mainArea={
        activeWorkspace ? (
          <div className="shell-runtime-workspaces">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`workspace-view ${
                  workspace.id === activeWorkspace.id ? "workspace-view--active" : ""
                }`}
              >
                <WorkspaceContainer workspace={workspace} />
              </div>
            ))}
          </div>
        ) : (
          <div className="shell-empty-main">
            <h2>No workspace</h2>
            <p>Create a workspace to start using terminals.</p>
            <button type="button" className="btn btn--primary" onClick={createDefaultWorkspace}>
              Create Workspace
            </button>
          </div>
        )
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
      workspaceName={activeWorkspace?.name ?? "No workspace"}
      workspaces={workspaces.map((workspace) => workspace.name)}
      runtimeStatus={runtimeStatus}
      isTextSenderOpen={isTextSenderOpen}
      isInteractionBlocked={error !== null}
      onSelectTool={(tool) => setActiveTool((currentTool) => (currentTool === tool ? null : tool))}
      onSelectWorkspace={(workspaceName) => {
        const workspace = workspaces.find((candidate) => candidate.name === workspaceName);
        if (workspace) setActiveWorkspace(workspace.id);
      }}
      onCloseWorkspace={(workspaceName) => {
        const workspace = workspaces.find((candidate) => candidate.name === workspaceName);
        if (workspace) closeWorkspace(workspace.id);
      }}
      onToggleTextSender={() => setIsTextSenderOpen((current) => !current)}
    />
  );
}

function findConfigGroupId(
  groups: readonly { id: number; configIds: string[] }[],
  configId: string,
): number | null {
  return groups.find((group) => group.configIds.includes(configId))?.id ?? null;
}

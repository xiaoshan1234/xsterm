import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../features/terminal/logic/TerminalContext";
import { type SavedTerminalConfig } from "../../types/terminal";
import { DEFAULT_GROUP_ID } from "../../features/terminal/logic/state/constants";
import NavBar from "../NavBar";
import { WorkspaceContainer } from "../../features/workspace/WorkspaceContainer";
import { TerminalManagerPanel } from "../../features/terminal/ui/TerminalManagerPanel";
import { TerminalStatusPanel } from "../../features/terminal/ui/TerminalStatusPanel";
import { TmuxManagerPanel } from "../../features/tmux/ui/TmuxManagerPanel";
import { TmuxStatusPanel } from "../../features/tmux/ui/TmuxStatusPanel";
import { WindowManagerPanel, WorkspaceManagerPanel } from "../../features/workspace/ui";
import { SettingsPanel } from "../../features/settings/ui";
import { selectTerminalManagerGroups } from "../../features/terminal/viewModels/managerViewModel";
import { selectTerminalStatusItems } from "../../features/terminal/viewModels/statusViewModel";
import { selectTmuxManagerItems } from "../../features/tmux/viewModels/managerViewModel";
import { selectTmuxStatusControllers } from "../../features/tmux/viewModels/statusViewModel";
import {
  selectWindowManagerItems,
  selectWorkspaceManagerItems,
} from "../../features/workspace/viewModels/managerViewModel";
import { selectPaneLocations } from "../../features/workspace/viewModels/paneLocationViewModel";
import {
  selectPaneTargetOptions,
  type PaneTargetOptionViewData,
} from "../../features/command-sender/viewModels/paneTargetViewModel";
import { AppShell } from "./AppShell";
import { ErrorDialog, type ErrorDialogData } from "./ErrorDialog";
import { GlobalOverlayHost } from "./GlobalOverlayHost";
import { GlobalTextSender } from "./GlobalTextSender";
import { TOOL_TITLES, type ToolId } from "./types";
import CreateTerminalDialog from "../../features/terminal/logic/dialogs/CreateTerminalDialog";
import { EditTerminalDialog } from "../../features/terminal/logic/dialogs/EditTerminalDialog";
import { NewGroupDialog } from "../../features/terminal/logic/dialogs/NewGroupDialog";
import { EditGroupDialog } from "../../features/terminal/logic/dialogs/EditGroupDialog";
import { SaveDialog } from "../../features/workspace/dialogs/SaveDialog";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";

type CreateTab = "local" | "ssh" | "tmux-pane";

type RuntimeDialog =
  | { kind: "create"; initialTab: CreateTab; groupId: number }
  | { kind: "edit-terminal"; config: SavedTerminalConfig }
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
  const session = useSession();
  const {
    terminals,
    workspaces,
    activeWorkspaceId,
    savedConfigs,
    groups,
    savedWorkspaces,
    savedWindowConfigs,
    setActiveWorkspace,
    setActiveWindow,
    setActivePane,
    createWindowFromSavedConfig,
    createWindow,
    loadWindow,
    loadWorkspace,
    createDefaultWorkspace,
    createEmptyWorkspace,
    closeTerminal,
    reconnectSession,
    writeTerminal,
    createLocalSession,
    createSshSession,
    createTmuxSession,
    removeConfig,
    toggleGroup,
    createGroup,
    deleteGroup,
    updateConfig,
    moveConfigToGroup,
    applyDisplayConfigToLiveSession,
    deleteSavedWindow,
    renameSavedWindow,
    deleteSavedWorkspace,
    renameSavedWorkspace,
  } = session;

  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [isTextSenderOpen, setIsTextSenderOpen] = useState(false);
  const [dialog, setDialog] = useState<RuntimeDialog>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [error, setError] = useState<ErrorDialogData | null>(null);
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const [textSenderDraft, setTextSenderDraft] = useState("");
  const [textSenderStatus, setTextSenderStatus] = useState("Ready");
  const initializedRef = useRef(false);

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
  const terminalStatusItems = useMemo(
    () => selectTerminalStatusItems(terminals, workspaces, savedConfigs),
    [savedConfigs, terminals, workspaces],
  );
  const tmuxManagerItems = useMemo(() => selectTmuxManagerItems(savedConfigs), [savedConfigs]);
  const tmuxStatusControllers = useMemo(
    () => selectTmuxStatusControllers(terminals, workspaces, savedConfigs),
    [savedConfigs, terminals, workspaces],
  );
  const windowManagerItems = useMemo(
    () => selectWindowManagerItems(savedWindowConfigs),
    [savedWindowConfigs],
  );
  const workspaceManagerItems = useMemo(
    () => selectWorkspaceManagerItems(savedWorkspaces, workspaces),
    [savedWorkspaces, workspaces],
  );
  const paneLocations = useMemo(
    () => selectPaneLocations(workspaces, terminals),
    [terminals, workspaces],
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

  const openEditConfig = useCallback(
    (configId: string) => {
      const config = savedConfigs.find((candidate) => candidate.id === configId);
      if (config) setDialog({ kind: "edit-terminal", config });
    },
    [savedConfigs],
  );

  const focusTerminal = useCallback(
    (terminalId: number) => {
      const location = paneLocations.get(terminalId);
      if (!location) return;
      setActiveWorkspace(location.workspaceId);
      setActiveWindow(location.workspaceId, location.windowId);
      setActivePane(location.workspaceId, location.windowId, location.paneId);
    },
    [paneLocations, setActivePane, setActiveWindow, setActiveWorkspace],
  );

  const closeTerminalWithError = useCallback(
    (terminalId: number) => {
      void closeTerminal(terminalId).catch((cause) => showError("Unable to close terminal", cause));
    },
    [closeTerminal, showError],
  );

  const reconnectTerminalWithError = useCallback(
    (terminalId: number) => {
      void reconnectSession(terminalId)
        .then((terminal) => focusTerminal(terminal.id))
        .catch((cause) => showError("Unable to reconnect terminal", cause));
    },
    [focusTerminal, reconnectSession, showError],
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

  const sendTextToTarget = useCallback(() => {
    if (!selectTextSenderTarget || !textSenderDraft) return;
    setTextSenderStatus("Sending…");
    void writeTerminal(selectTextSenderTarget.terminalId, textSenderDraft)
      .then(() => setTextSenderStatus(`Sent to ${selectTextSenderTarget.displayInfo.title}`))
      .catch((cause) => {
        setTextSenderStatus("Send failed");
        showError("Unable to send command", cause);
      });
  }, [selectTextSenderTarget, showError, textSenderDraft, writeTerminal]);

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
              setDialog({ kind: "create", initialTab: "local", groupId: DEFAULT_GROUP_ID })
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
            onEditConfig={openEditConfig}
            onRemoveConfig={removeConfig}
          />
        );
      case "terminal-status-manager":
        return (
          <TerminalStatusPanel
            items={terminalStatusItems}
            onFocus={focusTerminal}
            onReconnect={reconnectTerminalWithError}
            onClose={closeTerminalWithError}
          />
        );
      case "tmux-manager":
        return (
          <TmuxManagerPanel
            items={tmuxManagerItems}
            onNewTmux={() =>
              setDialog({
                kind: "create",
                initialTab: "tmux-pane",
                groupId: DEFAULT_GROUP_ID,
              })
            }
            onOpenConfig={openConfig}
            onEditConfig={openEditConfig}
            onRemoveConfig={removeConfig}
          />
        );
      case "tmux-status-manager":
        return <TmuxStatusPanel controllers={tmuxStatusControllers} onFocusPane={focusTerminal} />;
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
    closeTerminalWithError,
    createEmptyWorkspace,
    createWindow,
    deleteGroup,
    deleteSavedWindow,
    deleteSavedWorkspace,
    focusTerminal,
    loadWindow,
    openConfig,
    openEditConfig,
    openWorkspace,
    reconnectTerminalWithError,
    removeConfig,
    savedWindowConfigs,
    savedWorkspaces,
    showError,
    terminalManagerGroups,
    terminalStatusItems,
    tmuxManagerItems,
    tmuxStatusControllers,
    toggleGroup,
    windowManagerItems,
    workspaceManagerItems,
  ]);

  const overlay = (
    <GlobalOverlayHost>
      {!error && dialog?.kind === "create" && (
        <CreateTerminalDialog
          isOpen
          onClose={() => setDialog(null)}
          onCreateLocal={createLocalSession}
          onCreateSsh={createSshSession}
          onCreateTmux={createTmuxSession}
          initialTab={dialog.initialTab}
          initialGroupId={dialog.groupId}
        />
      )}
      {!error && dialog?.kind === "edit-terminal" && (
        <EditTerminalDialog
          isOpen
          onClose={() => setDialog(null)}
          config={dialog.config}
          groups={groups}
          groupId={findConfigGroupId(groups, dialog.config.id)}
          onSave={(config, groupId) => {
            updateConfig(config);
            moveConfigToGroup(config.id, groupId);
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
            session.renameGroup(groupId, name);
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
                <WorkspaceContainer workspace={workspace} commandPanelOpen={false} />
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
          text={textSenderDraft}
          statusMessage={textSenderStatus}
          onSelectTarget={(targetKey) => {
            setSelectedTargetKey(targetKey);
            const target = paneTargetOptions.find(
              (option: PaneTargetOptionViewData) => option.targetKey === targetKey,
            );
            setTextSenderStatus(target ? `Ready for ${target.displayInfo.title}` : "No target");
          }}
          onTextChange={setTextSenderDraft}
          onSend={sendTextToTarget}
        />
      }
      overlay={overlay}
      workspaceName={activeWorkspace?.name ?? "No workspace"}
      workspaces={workspaces.map((workspace) => workspace.name)}
      isTextSenderOpen={isTextSenderOpen}
      isInteractionBlocked={error !== null}
      onSelectTool={(tool) => setActiveTool((currentTool) => (currentTool === tool ? null : tool))}
      onCloseTool={() => setActiveTool(null)}
      onSelectWorkspace={(workspaceName) => {
        const workspace = workspaces.find((candidate) => candidate.name === workspaceName);
        if (workspace) setActiveWorkspace(workspace.id);
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

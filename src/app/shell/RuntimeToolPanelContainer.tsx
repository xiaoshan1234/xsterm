import { DEFAULT_GROUP_ID } from "../../features/launch-config";
import { tmuxSessionKey } from "../../features/tmux";
import { useRuntimeShellModel } from "../application/runtimeShell/useRuntimeShellModel";
import { RuntimeToolPanel } from "./RuntimeToolPanel";
import type { RuntimeConfirmState, RuntimeDialog } from "./runtimeOverlayTypes";
import type { ToolId } from "./types";

interface RuntimeToolPanelContainerProps {
  activeTool: ToolId | null;
  onOpenDialog: (dialog: RuntimeDialog) => void;
  onRequestConfirm: (confirm: RuntimeConfirmState) => void;
  onError: (title: string, cause: unknown) => void;
}

export function RuntimeToolPanelContainer({
  activeTool,
  onOpenDialog,
  onRequestConfirm,
  onError,
}: RuntimeToolPanelContainerProps) {
  const {
    launchConfig,
    tmuxRuntime,
    workspaceLayout,
    activeWorkspace,
    terminalManagerGroups,
    tmuxManagerGroups,
    windowManagerItems,
    workspaceManagerItems,
  } = useRuntimeShellModel();
  const { savedConfigs, removeConfig, toggleGroup, deleteGroup } = launchConfig;
  const { detachTmuxSession, openTmuxSessions } = tmuxRuntime;
  const {
    workspaces,
    savedWorkspaces,
    savedWindowConfigs,
    setActiveWorkspace,
    createWindowFromSavedConfig,
    createWindow,
    loadWindow,
    loadWorkspace,
    createEmptyWorkspace,
    deleteSavedWindow,
    deleteSavedWorkspace,
  } = workspaceLayout;

  const openConfig = (configId: string) => {
    createWindowFromSavedConfig(configId).catch((cause) =>
      onError("Unable to open saved configuration", cause),
    );
  };

  const openWorkspace = (configId: string, isLoaded: boolean) => {
    if (isLoaded) {
      const loadedWorkspace = workspaces.find(
        (workspace) => workspace.savedWorkspaceId === configId,
      );
      if (loadedWorkspace) {
        setActiveWorkspace(loadedWorkspace.id);
        return;
      }
    }
    loadWorkspace(configId).catch((cause) => onError("Unable to load workspace", cause));
  };

  const detachTmuxConfig = (configId: string) => {
    const target = savedConfigs.find((config) => config.id === configId);
    if (target?.type !== "tmux-pane") return;
    const targetKey = tmuxSessionKey(target.config);
    const openSession = openTmuxSessions.find(
      (session) => session.configId === configId || tmuxSessionKey(session.config) === targetKey,
    );
    if (!openSession) return;
    void detachTmuxSession(openSession.controllerId).catch((cause) =>
      onError("Unable to detach tmux session", cause),
    );
  };

  return (
    <RuntimeToolPanel
      activeTool={activeTool}
      terminalManagerGroups={terminalManagerGroups}
      tmuxManagerGroups={tmuxManagerGroups}
      windowManagerItems={windowManagerItems}
      workspaceManagerItems={workspaceManagerItems}
      onCreateTerminal={() =>
        onOpenDialog({
          kind: "create-terminal",
          initialTab: "local",
          groupId: DEFAULT_GROUP_ID,
        })
      }
      onCreateTmux={() => onOpenDialog({ kind: "create-tmux" })}
      onAttachTmux={() => onOpenDialog({ kind: "attach-tmux" })}
      onNewGroup={() => onOpenDialog({ kind: "new-group" })}
      onToggleGroup={toggleGroup}
      onEditGroup={(groupId) => onOpenDialog({ kind: "edit-group", groupId })}
      onDeleteGroup={(groupId) =>
        onRequestConfirm({
          title: "Delete terminal group?",
          message: "The group will be removed. Saved terminal configurations are kept.",
          confirmLabel: "Delete",
          action: () => deleteGroup(groupId),
        })
      }
      onOpenConfig={openConfig}
      onEditTerminalConfig={(configId) => {
        const config = savedConfigs.find((candidate) => candidate.id === configId);
        if (config?.type === "local" || config?.type === "ssh") {
          onOpenDialog({ kind: "edit-terminal", config });
        }
      }}
      onEditTmuxConfig={(configId) => {
        const config = savedConfigs.find((candidate) => candidate.id === configId);
        if (config?.type === "tmux-pane") {
          onOpenDialog({ kind: "edit-tmux", config });
        }
      }}
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
            onError("Unable to load window", cause),
          );
        }
      }}
      onRenameWindow={(configId) => {
        const config = savedWindowConfigs.find((candidate) => candidate.id === configId);
        if (config) {
          onOpenDialog({
            kind: "rename-window",
            configId,
            defaultName: config.name,
          });
        }
      }}
      onDeleteWindow={(configId) =>
        onRequestConfirm({
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
          onOpenDialog({
            kind: "rename-workspace",
            configId,
            defaultName: config.name,
          });
        }
      }}
      onDeleteWorkspace={(configId) =>
        onRequestConfirm({
          title: "Delete saved workspace?",
          message: "The saved workspace snapshot will be removed.",
          confirmLabel: "Delete",
          action: () => deleteSavedWorkspace(configId),
        })
      }
    />
  );
}

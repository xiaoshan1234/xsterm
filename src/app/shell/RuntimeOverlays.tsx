import {
  useSavedLaunchConfigs,
  CreateTerminalDialog,
  EditGroupDialog,
  EditTerminalDialog,
  NewGroupDialog,
  AttachTmuxDialog,
  CreateTmuxDialog,
  EditTmuxDialog,
} from "../../features/launch-config";
import { useTerminalRuntime } from "../../features/terminal";
import { useWorkspaceLayout, SaveDialog } from "../../features/workspace";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { ErrorDialog } from "./ErrorDialog";
import { GlobalOverlayHost } from "./GlobalOverlayHost";
import { HelpDialog, type HelpDialogId } from "./HelpDialog";
import {
  type RuntimeConfirmState,
  type RuntimeDialog,
  type RuntimeErrorState,
} from "./runtimeOverlayTypes";

interface RuntimeOverlaysProps {
  dialog: RuntimeDialog;
  error: RuntimeErrorState | null;
  confirm: RuntimeConfirmState | null;
  helpDialog: HelpDialogId | null;
  onCloseDialog: () => void;
  onDismissConfirm: () => void;
  onAcknowledgeError: () => void;
  onCloseHelp: () => void;
}

export function RuntimeOverlays({
  dialog,
  error,
  confirm,
  helpDialog,
  onCloseDialog,
  onDismissConfirm,
  onAcknowledgeError,
  onCloseHelp,
}: RuntimeOverlaysProps) {
  const {
    createLocalSession,
    createSshSession,
    createTmuxSession,
    attachTmuxSession,
    applyDisplayConfigToLiveSession,
    terminals,
  } = useTerminalRuntime();
  const { groups, createGroup, moveConfigToGroup, renameGroup } = useSavedLaunchConfigs();
  const { renameSavedWindow, renameSavedWorkspace } = useWorkspaceLayout();

  const editingGroup =
    dialog?.kind === "edit-group"
      ? (groups.find((group) => group.id === dialog.groupId) ?? groups[0])
      : undefined;

  return (
    <GlobalOverlayHost>
      {!error && dialog?.kind === "create-terminal" && (
        <CreateTerminalDialog
          isOpen
          onClose={onCloseDialog}
          onCreateLocal={createLocalSession}
          onCreateSsh={createSshSession}
          initialTab={dialog.initialTab}
          initialGroupId={dialog.groupId}
        />
      )}
      {!error && dialog?.kind === "attach-tmux" && (
        <AttachTmuxDialog isOpen onClose={onCloseDialog} onAttachTmux={attachTmuxSession} />
      )}
      {!error && dialog?.kind === "create-tmux" && (
        <CreateTmuxDialog isOpen onClose={onCloseDialog} onCreateTmux={createTmuxSession} />
      )}
      {!error && dialog?.kind === "edit-terminal" && (
        <EditTerminalDialog
          isOpen
          onClose={onCloseDialog}
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
          onClose={onCloseDialog}
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
        onClose={onCloseDialog}
        existingGroupNames={groups.map((group) => group.name)}
        onCreate={(name) => {
          createGroup(name);
          onCloseDialog();
        }}
      />
      {!error && editingGroup && (
        <EditGroupDialog
          isOpen
          group={editingGroup}
          groups={groups}
          onClose={onCloseDialog}
          onSave={(groupId, name) => {
            renameGroup(groupId, name);
            onCloseDialog();
          }}
        />
      )}
      {!error && dialog?.kind === "rename-window" && (
        <SaveDialog
          isOpen
          onClose={onCloseDialog}
          onSave={(name) => renameSavedWindow(dialog.configId, name)}
          defaultName={dialog.defaultName}
          title="Rename Window"
          label="Window Name"
        />
      )}
      {!error && dialog?.kind === "rename-workspace" && (
        <SaveDialog
          isOpen
          onClose={onCloseDialog}
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
        onCancel={onDismissConfirm}
        onConfirm={() => {
          confirm?.action();
          onDismissConfirm();
        }}
      />
      <HelpDialog activeDialog={helpDialog} onClose={onCloseHelp} />
      {error && <ErrorDialog error={error} onAcknowledge={onAcknowledgeError} />}
    </GlobalOverlayHost>
  );
}

function findConfigGroupId(
  groups: readonly { id: number; configIds: string[] }[],
  configId: string,
): number | null {
  return groups.find((group) => group.configIds.includes(configId))?.id ?? null;
}

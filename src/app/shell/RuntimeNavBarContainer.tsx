import type { ShellModel } from "../application/shellModel/useShellModel";
import NavBar from "../NavBar";
import type { HelpDialogId } from "./HelpDialog";

interface RuntimeNavBarContainerProps {
  model: ShellModel;
  isTextSenderOpen: boolean;
  onToggleTextSender: () => void;
  onHelpAction: (dialog: HelpDialogId) => void;
  onError: (title: string, cause: unknown) => void;
}

export function RuntimeNavBarContainer({
  model,
  isTextSenderOpen,
  onToggleTextSender,
  onHelpAction,
  onError,
}: RuntimeNavBarContainerProps) {
  const {
    activeWorkspace,
    terminalManagerGroups,
    workspaceLayout: {
      workspaces,
      setActiveWorkspace,
      createWindowFromSavedConfig,
      closeWorkspace,
    },
  } = model;

  return (
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
      onToggleTextSender={onToggleTextSender}
      onHelpAction={onHelpAction}
      onOpenTerminal={(configId) => {
        createWindowFromSavedConfig(configId).catch((cause) =>
          onError("Unable to open saved configuration", cause),
        );
      }}
    />
  );
}

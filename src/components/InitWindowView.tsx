import { useState } from "react";
import { useSession } from "../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, Session, Workspace } from "../types/session";
import { SshTmuxSessionConfig } from "../types/tmux";
import { PlusIcon, FolderOpenIcon } from "./icons/Icon";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import { SelectSessionDialog } from "./dialogs/SelectSessionDialog";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const {
    sessions,
    createLocalSessionOnly,
    createSshSessionOnly,
    createTmuxSessionOnly,
    replaceInitWindowWithSession,
    createSessionFromSavedConfig,
  } = useSession();
  const [createDialogTab, setCreateDialogTab] = useState<"local" | "ssh" | "tmux" | null>(null);
  const [showSelectDialog, setShowSelectDialog] = useState(false);

  const handleCreate = async (
    create: () => Promise<Session>
  ): Promise<Session> => {
    const session = await create();
    replaceInitWindowWithSession(workspace.id, windowId, session);
    return session;
  };

  const handleCreateLocal = (config: LocalSessionConfig, save: boolean) =>
    handleCreate(() => createLocalSessionOnly(config, save));

  const handleCreateSsh = (config: SSHSessionConfig, save: boolean) =>
    handleCreate(() => createSshSessionOnly(config, save));

  const handleCreateTmux = (config: SshTmuxSessionConfig, save: boolean) =>
    handleCreate(() => createTmuxSessionOnly(config, save));

  const handleSelectSession = (sessionId: number) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      replaceInitWindowWithSession(workspace.id, windowId, session);
    }
    setShowSelectDialog(false);
  };

  const handleSelectConfig = async (configId: string) => {
    try {
      const session = await createSessionFromSavedConfig(configId);
      replaceInitWindowWithSession(workspace.id, windowId, session);
    } catch (e) {
      console.error("Failed to create session from saved config:", e);
    }
    setShowSelectDialog(false);
  };

  return (
    <div className="init-window-view">
      <div className="init-window-card">
        <h2 className="init-window-title">Create a session</h2>
        <p className="init-window-subtitle">Create new or open a saved session</p>
        <div className="init-window-options">
          <button
            className="init-window-option"
            type="button"
            onClick={() => setCreateDialogTab("local")}
          >
            <PlusIcon size={32} />
            <span className="init-window-option-label">Create New</span>
          </button>
          <button
            className="init-window-option"
            type="button"
            onClick={() => setShowSelectDialog(true)}
          >
            <FolderOpenIcon size={32} />
            <span className="init-window-option-label">Open Saved</span>
          </button>
        </div>
      </div>
      <CreateSessionDialog
        isOpen={createDialogTab !== null}
        onClose={() => setCreateDialogTab(null)}
        onCreateLocal={handleCreateLocal}
        onCreateSsh={handleCreateSsh}
        onCreateTmux={handleCreateTmux}
        initialTab={createDialogTab ?? "local"}
      />
      <SelectSessionDialog
        isOpen={showSelectDialog}
        onClose={() => setShowSelectDialog(false)}
        onSelectSession={handleSelectSession}
        onSelectConfig={handleSelectConfig}
      />
    </div>
  );
}

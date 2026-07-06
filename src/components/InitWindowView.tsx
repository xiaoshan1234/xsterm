import { useState } from "react";
import { useSession } from "../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, Session, Workspace } from "../types/session";
import { SshTmuxSessionConfig } from "../types/tmux";
import { LocalSessionIcon, SshSessionIcon, TmuxSessionIcon } from "./icons/Icon";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const {
    createLocalSessionOnly,
    createSshSessionOnly,
    createTmuxSessionOnly,
    replaceInitWindowWithSession,
  } = useSession();
  const [dialogTab, setDialogTab] = useState<"local" | "ssh" | "tmux" | null>(null);

  const handleCreate = async (
    create: () => Promise<Session>
  ): Promise<Session> => {
    const session = await create();
    replaceInitWindowWithSession(workspace.id, windowId, session.id);
    return session;
  };

  const handleCreateLocal = (config: LocalSessionConfig, save: boolean) =>
    handleCreate(() => createLocalSessionOnly(config, save));

  const handleCreateSsh = (config: SSHSessionConfig, save: boolean) =>
    handleCreate(() => createSshSessionOnly(config, save));

  const handleCreateTmux = (config: SshTmuxSessionConfig, save: boolean) =>
    handleCreate(() => createTmuxSessionOnly(config, save));

  return (
    <div className="init-window-view">
      <div className="init-window-card">
        <h2 className="init-window-title">Create a session</h2>
        <p className="init-window-subtitle">Choose a session type to get started</p>
        <div className="init-window-options">
          <button
            className="init-window-option"
            type="button"
            onClick={() => setDialogTab("local")}
          >
            <LocalSessionIcon size={32} />
            <span className="init-window-option-label">Local Shell</span>
          </button>
          <button
            className="init-window-option"
            type="button"
            onClick={() => setDialogTab("ssh")}
          >
            <SshSessionIcon size={32} />
            <span className="init-window-option-label">SSH</span>
          </button>
          <button
            className="init-window-option"
            type="button"
            onClick={() => setDialogTab("tmux")}
          >
            <TmuxSessionIcon size={32} />
            <span className="init-window-option-label">tmux</span>
          </button>
        </div>
      </div>
      <CreateSessionDialog
        isOpen={dialogTab !== null}
        onClose={() => setDialogTab(null)}
        onCreateLocal={handleCreateLocal}
        onCreateSsh={handleCreateSsh}
        onCreateTmux={handleCreateTmux}
        initialTab={dialogTab ?? "local"}
      />
    </div>
  );
}

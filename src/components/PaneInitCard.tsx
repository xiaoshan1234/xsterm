import { useState } from "react";
import { useSession } from "../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, Session } from "../types/session";
import { SshTmuxSessionConfig } from "../types/tmux";
import { PlusIcon, FolderOpenIcon } from "./icons/Icon";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import { SelectSessionDialog } from "./dialogs/SelectSessionDialog";
import "./PaneInitCard.css";

export interface PaneInitCardProps {
  onSessionCreated: (session: Session) => void;
  title?: string;
  subtitle?: string;
}

export function PaneInitCard({
  onSessionCreated,
  title = "Create a session",
  subtitle = "Create new or open a saved session",
}: PaneInitCardProps) {
  const {
    sessions,
    createLocalSessionOnly,
    createSshSessionOnly,
    createTmuxSessionOnly,
    createSessionFromSavedConfig,
  } = useSession();
  const [createDialogTab, setCreateDialogTab] = useState<"local" | "ssh" | "tmux" | null>(null);
  const [showSelectDialog, setShowSelectDialog] = useState(false);

  const handleCreate = async (create: () => Promise<Session>): Promise<Session> => {
    const session = await create();
    try {
      onSessionCreated(session);
    } catch (e) {
      if (e instanceof Error && e.message === "Session is already used in another window") {
        window.alert("Session is already used in another window");
      } else {
        throw e;
      }
    }
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
      try {
        onSessionCreated(session);
      } catch (e) {
        if (e instanceof Error && e.message === "Session is already used in another window") {
          window.alert("Session is already used in another window");
        } else {
          throw e;
        }
      }
    }
    setShowSelectDialog(false);
  };

  const handleSelectConfig = async (configId: string) => {
    try {
      const session = await createSessionFromSavedConfig(configId);
      onSessionCreated(session);
    } catch (e) {
      if (e instanceof Error && e.message === "Session is already used in another window") {
        window.alert("Session is already used in another window");
      } else {
        console.error("Failed to create session from saved config:", e);
      }
    }
    setShowSelectDialog(false);
  };

  return (
    <div className="pane-init-card">
      <h2 className="pane-init-card-title">{title}</h2>
      <p className="pane-init-card-subtitle">{subtitle}</p>
      <div className="pane-init-card-options">
        <button
          className="pane-init-card-option"
          type="button"
          onClick={() => setCreateDialogTab("local")}
        >
          <PlusIcon size={32} />
          <span className="pane-init-card-option-label">Create New</span>
        </button>
        <button
          className="pane-init-card-option"
          type="button"
          onClick={() => setShowSelectDialog(true)}
        >
          <FolderOpenIcon size={32} />
          <span className="pane-init-card-option-label">Open Saved</span>
        </button>
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

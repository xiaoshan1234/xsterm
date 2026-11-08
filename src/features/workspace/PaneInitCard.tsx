import { useRef, useState } from "react";
import { useSession } from "../terminal/logic/TerminalContext";
import {
  type LocalTerminalConfig,
  type SshConfig,
  type Terminal,
  type TmuxSessionConfig,
} from "../../types/terminal";
import { PlusIcon, FolderOpenIcon } from "../../shared/icons/Icon";
import CreateTerminalDialog from "../terminal/logic/dialogs/CreateTerminalDialog";
import { SelectTerminalDialog } from "../terminal/logic/dialogs/SelectTerminalDialog";
import "./PaneInitCard.css";

export interface PaneInitCardProps {
  onTerminalCreated: (terminal: Terminal) => void;
  title?: string;
  subtitle?: string;
}

export function PaneInitCard({
  onTerminalCreated,
  title = "Create a terminal",
  subtitle = "Create new or open a saved terminal",
}: PaneInitCardProps) {
  const {
    terminals,
    createLocalSessionOnly,
    createSshSessionOnly,
    createTmuxSessionOnly,
    createTerminalFromSavedConfig,
  } = useSession();
  const [createDialogTab, setCreateDialogTab] = useState<"local" | "ssh" | "tmux-pane" | null>(
    null,
  );
  const [showSelectDialog, setShowSelectDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const startSubmitting = () => {
    if (isSubmittingRef.current) return false;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    return true;
  };

  const endSubmitting = () => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  };

  const handleCreate = async (create: () => Promise<Terminal>): Promise<Terminal> => {
    const terminal = await create();
    try {
      onTerminalCreated(terminal);
    } catch (e) {
      if (e instanceof Error && e.message === "Terminal is already used in another window") {
        window.alert("Terminal is already used in another window");
      } else {
        throw e;
      }
    }
    return terminal;
  };

  const handleCreateLocal = (config: LocalTerminalConfig, save: boolean) =>
    handleCreate(() => createLocalSessionOnly(config, save));

  const handleCreateSsh = (config: SshConfig, save: boolean) =>
    handleCreate(() => createSshSessionOnly(config, save));

  const handleCreateTmux = (config: TmuxSessionConfig, save: boolean) =>
    handleCreate(() => createTmuxSessionOnly(config, save));

  const handleSelectSession = (terminalId: number) => {
    if (!startSubmitting()) return;
    const terminal = terminals.find((s) => s.id === terminalId);
    if (!terminal) {
      endSubmitting();
      return;
    }

    try {
      onTerminalCreated(terminal);
      setShowSelectDialog(false);
    } catch (e) {
      if (e instanceof Error && e.message === "Terminal is already used in another window") {
        window.alert("Terminal is already used in another window");
      } else {
        window.alert(`Failed to create terminal: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      endSubmitting();
    }
  };

  const handleSelectConfig = async (configId: string) => {
    if (!startSubmitting()) return;
    try {
      const terminal = await createTerminalFromSavedConfig(configId);
      onTerminalCreated(terminal);
      setShowSelectDialog(false);
    } catch (e) {
      if (e instanceof Error && e.message === "Terminal is already used in another window") {
        window.alert("Terminal is already used in another window");
      } else {
        window.alert(`Failed to create terminal: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      endSubmitting();
    }
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
      <CreateTerminalDialog
        isOpen={createDialogTab !== null}
        onClose={() => setCreateDialogTab(null)}
        onCreateLocal={handleCreateLocal}
        onCreateSsh={handleCreateSsh}
        onCreateTmux={handleCreateTmux}
        initialTab={createDialogTab ?? "local"}
      />
      <SelectTerminalDialog
        isOpen={showSelectDialog}
        onClose={() => setShowSelectDialog(false)}
        onSelectSession={handleSelectSession}
        onSelectConfig={handleSelectConfig}
        disabled={isSubmitting}
      />
    </div>
  );
}

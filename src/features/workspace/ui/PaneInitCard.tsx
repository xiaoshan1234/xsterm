import { useRef, useState } from "react";
import type { CreatedTerminalRef, LocalTerminalConfig, SshConfig } from "../../launch-config";
import { isApplicationError } from "../../../models/applicationError";
import { PlusIcon, FolderOpenIcon } from "../../../shared/icons/Icon";
import { useApplicationFeedback } from "../../../shared/ui/ApplicationFeedbackContext";
import { CreateTerminalDialog } from "../../launch-config";
import { SelectTerminalDialog } from "./dialogs/SelectTerminalDialog";
import "./PaneInitCard.css";

export interface PaneInitCardProps {
  onAttachExistingTerminal: (terminalId: number) => Promise<void>;
  onCreateLocal: (config: LocalTerminalConfig, save: boolean) => Promise<CreatedTerminalRef>;
  onCreateSsh: (config: SshConfig, save: boolean) => Promise<CreatedTerminalRef>;
  onCreateFromSavedConfig: (configId: string) => Promise<void>;
  title?: string;
  subtitle?: string;
}

export function PaneInitCard({
  onAttachExistingTerminal,
  onCreateLocal,
  onCreateSsh,
  onCreateFromSavedConfig,
  title = "Create a terminal",
  subtitle = "Create new or open a saved terminal",
}: PaneInitCardProps) {
  const feedback = useApplicationFeedback();
  const [createDialogTab, setCreateDialogTab] = useState<"local" | "ssh" | null>(null);
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

  const handleCreate = async <Result,>(create: () => Promise<Result>): Promise<Result> => {
    try {
      return await create();
    } catch (e) {
      if (isApplicationError(e, "terminal-already-attached")) {
        feedback.reportError("Terminal already attached", e);
      } else {
        feedback.reportError("Unable to create terminal", e);
      }
      throw e;
    }
  };

  const handleCreateLocal = (config: LocalTerminalConfig, save: boolean) =>
    handleCreate(() => onCreateLocal(config, save));

  const handleCreateSsh = (config: SshConfig, save: boolean) =>
    handleCreate(() => onCreateSsh(config, save));

  const handleSelectSession = async (terminalId: number) => {
    if (!startSubmitting()) return;
    try {
      await onAttachExistingTerminal(terminalId);
      setShowSelectDialog(false);
    } catch (e) {
      if (isApplicationError(e, "terminal-already-attached")) {
        feedback.reportError("Terminal already attached", e);
      } else {
        feedback.reportError("Unable to attach terminal", e);
      }
    } finally {
      endSubmitting();
    }
  };

  const handleSelectConfig = async (configId: string) => {
    if (!startSubmitting()) return;
    try {
      await onCreateFromSavedConfig(configId);
      setShowSelectDialog(false);
    } catch (e) {
      if (isApplicationError(e, "terminal-already-attached")) {
        feedback.reportError("Terminal already attached", e);
      } else {
        feedback.reportError("Unable to create terminal", e);
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

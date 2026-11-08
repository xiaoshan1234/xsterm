import { useEffect, useState } from "react";
import {
  type SavedTerminalConfig,
  type SshConfig,
  type TmuxSessionConfig,
} from "../../../../models/legacy/terminal";
import { Dialog } from "../../../../shared/ui/Dialog";
import { DEFAULT_GROUP_ID, useSavedLaunchConfigs } from "../../../sessions";
import { validateSshConfig } from "../../../terminal/ui/dialogs/SshTerminalForm";
import {
  SessionFormLayout,
  type SessionFormSidebarItem,
} from "../../../terminal/ui/dialogs/TerminalFormLayout";
import { SessionFormPanels } from "../../../terminal/ui/dialogs/TerminalFormPanels";
import { useTerminalForm } from "../../../terminal/ui/dialogs/useTerminalForm";
import { DEFAULT_SSH, TMUX_SIDEBAR_ITEMS } from "../../../terminal/ui/dialogs/terminalDialogItems";
import TmuxForm from "./TmuxForm";
import "../../../terminal/ui/dialogs/EditTerminalDialog.css";

export type EditableTmuxConfig = Extract<SavedTerminalConfig, { type: "tmux-pane" }>;

interface EditTmuxDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: EditableTmuxConfig;
  onSave: (config: EditableTmuxConfig) => void;
}

export function EditTmuxDialog({ isOpen, onClose, config, onSave }: EditTmuxDialogProps) {
  const { savedConfigs, updateConfig } = useSavedLaunchConfigs();
  const [tmuxConfig, setTmuxConfig] = useState<TmuxSessionConfig>(config.config);
  const form = useTerminalForm({
    isOpen,
    initialConfigId: config.id,
    initialName: config.name,
    initialGroupId: DEFAULT_GROUP_ID,
    initialLocalConfig: {},
    initialSshConfig: DEFAULT_SSH,
    initialDisplayConfig: config.displayConfig,
  });

  useEffect(() => {
    if (isOpen) setTmuxConfig(config.config);
  }, [config, isOpen]);

  const handleSave = () => {
    const name = form.name.trim();
    if (!name) {
      form.setError("tmux display name is required.");
      return;
    }

    const base = savedConfigs.find((candidate) => candidate.id === tmuxConfig.baseConfigId);
    if (!base || (base.type !== "local" && base.type !== "ssh")) {
      form.setError("Base config must be an existing Shell or SSH config.");
      form.setSectionId("connection");
      return;
    }
    if (base.type === "ssh") {
      const validationError = validateSshConfig(base.config);
      if (validationError) {
        form.setError(validationError);
        form.setSectionId("connection");
        return;
      }
    }

    const baseConfigFields: TmuxSessionConfig = { ...tmuxConfig, ssh: undefined };
    const updatedConfig: EditableTmuxConfig = {
      ...config,
      name,
      config: {
        ...baseConfigFields,
        ...(base.type === "ssh" ? { ssh: base.config as SshConfig } : {}),
      },
      displayConfig: form.displayConfig,
    };
    updateConfig(updatedConfig);
    onSave(updatedConfig);
    onClose();
  };

  const sidebarItems: SessionFormSidebarItem[] = TMUX_SIDEBAR_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === form.sectionId,
    onClick: () => {
      form.setSectionId(item.id);
      form.setError("");
    },
  }));

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit tmux Session"
      className="edit-terminal-dialog"
      footer={
        <div className="dialog-footer-buttons">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={handleSave}>
            Save
          </button>
        </div>
      }
    >
      <SessionFormLayout sidebarItems={sidebarItems}>
        <SessionFormPanels
          form={form}
          connectionType="tmux-pane"
          renderSessionSection={() => (
            <TmuxForm
              name={form.name}
              onNameChange={form.setName}
              config={tmuxConfig}
              onConfigChange={setTmuxConfig}
            />
          )}
        />
      </SessionFormLayout>
    </Dialog>
  );
}

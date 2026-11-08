import { useMemo } from "react";
import { type SavedTerminalConfig, type TerminalGroup } from "../../../../types/terminal";
import { Dialog } from "../../../../shared/ui/Dialog";
import { FormField } from "../../../../shared/ui/FormField";
import SessionTab from "./ConnectionTab";
import { validateSshConfig } from "./SshTerminalForm";
import { SessionFormLayout, type SessionFormSidebarItem } from "./TerminalFormLayout";
import "./EditTerminalDialog.css";
import { DEFAULT_GROUP_ID } from "../state/constants";
import {
  DEFAULT_SSH,
  SHELL_SIDEBAR_ITEMS,
  SSH_SIDEBAR_ITEMS,
  TMUX_SIDEBAR_ITEMS,
} from "./terminalDialogItems";
import { useTerminalForm } from "./useTerminalForm";
import { SessionFormPanels } from "./TerminalFormPanels";

interface EditTerminalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: SavedTerminalConfig;
  groups: TerminalGroup[];
  groupId: number | null;
  onSave: (config: SavedTerminalConfig, groupId: number | null) => void;
}

export function EditTerminalDialog({
  isOpen,
  onClose,
  config,
  groups,
  groupId,
  onSave,
}: EditTerminalDialogProps) {
  const form = useTerminalForm({
    isOpen,
    initialConfigId: config.id,
    initialName: config.name,
    initialGroupId: groupId ?? DEFAULT_GROUP_ID,
    initialLocalConfig: config.type === "local" ? config.config : {},
    initialSshConfig: config.type === "ssh" ? config.config : DEFAULT_SSH,
    initialDisplayConfig: config.displayConfig,
  });

  const sidebarItems = useMemo(() => {
    if (config.type === "tmux-pane") return TMUX_SIDEBAR_ITEMS;
    if (config.type === "ssh") return SSH_SIDEBAR_ITEMS;
    return SHELL_SIDEBAR_ITEMS;
  }, [config.type]);

  const handleSave = () => {
    const trimmedName = form.name.trim();
    if (!trimmedName) return;

    if (config.type === "ssh") {
      const validationError = validateSshConfig(form.sshConfig);
      if (validationError) {
        form.setError(validationError);
        form.setSectionId("connection");
        return;
      }
    }

    let updatedConfig: SavedTerminalConfig;
    if (config.type === "local") {
      updatedConfig = {
        ...config,
        name: trimmedName,
        config: form.localConfig,
        displayConfig: form.displayConfig,
      };
    } else if (config.type === "ssh") {
      updatedConfig = {
        ...config,
        name: trimmedName,
        config: form.sshConfig,
        displayConfig: form.displayConfig,
      };
    } else {
      updatedConfig = { ...config, name: trimmedName, displayConfig: form.displayConfig };
    }

    onSave(updatedConfig, form.selectedGroupId);
    onClose();
  };

  const inlineFields = (
    <div className="edit-terminal-fields">
      <FormField label="Name">
        <input
          type="text"
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
        />
      </FormField>
      <FormField label="Group">
        <select
          value={form.selectedGroupId}
          onChange={(e) => form.setSelectedGroupId(parseInt(e.target.value, 10))}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </FormField>
    </div>
  );

  const renderSessionSection = () => {
    if (config.type === "tmux-pane") {
      return (
        <>
          {inlineFields}
          <p className="edit-terminal-note">
            Tmux setup (base configuration, socket name, start command) is fixed at creation time
            and cannot be changed. Use the other sidebar tabs to edit display settings.
          </p>
        </>
      );
    }
    return (
      <>
        {inlineFields}
        <SessionTab
          connectionType={config.type === "ssh" ? "ssh" : "local"}
          onConnectionTypeChange={() => {}}
          name={form.name}
          onNameChange={form.setName}
          selectedGroupId={form.selectedGroupId}
          onGroupChange={form.setSelectedGroupId}
          groups={groups}
          localConfig={form.localConfig}
          onLocalConfigChange={form.setLocalConfig}
          sshConfig={form.sshConfig}
          onSshConfigChange={(cfg) => {
            form.setSshConfig(cfg);
            form.setError("");
          }}
          hideConnectionSwitcher
          hideNameAndGroup
        />
      </>
    );
  };

  const sidebarItemProps: SessionFormSidebarItem[] = sidebarItems.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === form.sectionId,
    onClick: () => {
      form.setSectionId(item.id);
      form.setError("");
    },
  }));

  const footer = (
    <div className="dialog-footer-buttons">
      <button className="btn btn--secondary" onClick={onClose}>
        Cancel
      </button>
      <button className="btn btn--primary" onClick={handleSave}>
        Save
      </button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Terminal"
      size="medium"
      footer={footer}
      className="edit-terminal-dialog"
    >
      <SessionFormLayout sidebarItems={sidebarItemProps}>
        <SessionFormPanels
          form={form}
          connectionType={config.type}
          renderSessionSection={renderSessionSection}
        />
      </SessionFormLayout>
    </Dialog>
  );
}

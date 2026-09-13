import { useMemo } from "react";
import {
  type SavedSessionConfig,
  type SessionGroup,
} from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import SessionTab from "./SessionTab";
import { validateSshConfig } from "./SshSessionForm";
import { SessionFormLayout, type SessionFormSidebarItem } from "./SessionFormLayout";
import "./EditSessionDialog.css";
import { DEFAULT_GROUP_ID } from "../../contexts/session/constants";
import {
  DEFAULT_SSH,
  SHELL_SIDEBAR_ITEMS,
  SSH_SIDEBAR_ITEMS,
  TMUX_SIDEBAR_ITEMS,
} from "./sessionDialogItems";
import { useSessionForm } from "./useSessionForm";
import { SessionFormPanels } from "./SessionFormPanels";

interface EditSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: SavedSessionConfig;
  groups: SessionGroup[];
  groupId: number | null;
  onSave: (config: SavedSessionConfig, groupId: number | null) => void;
}

export function EditSessionDialog({
  isOpen,
  onClose,
  config,
  groups,
  groupId,
  onSave,
}: EditSessionDialogProps) {
  const form = useSessionForm({
    isOpen,
    initialConfigId: config.id,
    initialName: config.name,
    initialGroupId: groupId ?? DEFAULT_GROUP_ID,
    initialLocalConfig: config.type === "local" ? config.config : {},
    initialSshConfig:
      config.type === "ssh" ? config.config : DEFAULT_SSH,
    initialDisplayConfig: config.displayConfig,
  });

  const sidebarItems = useMemo(() => {
    if (config.type === "tmux-cc") return TMUX_SIDEBAR_ITEMS;
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
        form.setSectionId("session");
        return;
      }
    }

    let updatedConfig: SavedSessionConfig;
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
    <div className="edit-session-fields">
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
    if (config.type === "tmux-cc") {
      return (
        <>
          {inlineFields}
          <p className="edit-session-note">
            Tmux setup (base configuration, socket name, start command) is
            fixed at creation time and cannot be changed. Use the other
            sidebar tabs to edit display settings.
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
      title="Edit Session"
      size="medium"
      footer={footer}
      className="edit-session-dialog"
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
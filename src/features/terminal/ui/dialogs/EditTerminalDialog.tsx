import { useMemo } from "react";
import { type SavedTerminalConfig, type TerminalGroup } from "../../../../types/terminal";
import { Dialog } from "../../../../shared/ui/Dialog";
import { FormField } from "../../../../shared/ui/FormField";
import { DEFAULT_GROUP_ID, useSession } from "../../../sessions";
import SessionTab from "../../logic/dialogs/ConnectionTab";
import { validateSshConfig } from "../../logic/dialogs/SshTerminalForm";
import {
  SessionFormLayout,
  type SessionFormSidebarItem,
} from "../../logic/dialogs/TerminalFormLayout";
import { SessionFormPanels } from "../../logic/dialogs/TerminalFormPanels";
import { useTerminalForm } from "../../logic/dialogs/useTerminalForm";
import {
  DEFAULT_SSH,
  SHELL_SIDEBAR_ITEMS,
  SSH_SIDEBAR_ITEMS,
} from "../../logic/dialogs/terminalDialogItems";
import "../../logic/dialogs/EditTerminalDialog.css";

export type EditableTerminalConfig = Extract<SavedTerminalConfig, { type: "local" | "ssh" }>;

interface EditTerminalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: EditableTerminalConfig;
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
  const { updateConfig } = useSession();
  const form = useTerminalForm({
    isOpen,
    initialConfigId: config.id,
    initialName: config.name,
    initialGroupId: groupId ?? DEFAULT_GROUP_ID,
    initialLocalConfig: config.type === "local" ? config.config : {},
    initialSshConfig: config.type === "ssh" ? config.config : DEFAULT_SSH,
    initialDisplayConfig: config.displayConfig,
  });

  const sidebarItems = useMemo(
    () => (config.type === "ssh" ? SSH_SIDEBAR_ITEMS : SHELL_SIDEBAR_ITEMS),
    [config.type],
  );

  const handleSave = () => {
    const name = form.name.trim();
    if (!name) {
      form.setError("Terminal name is required.");
      return;
    }
    if (config.type === "ssh") {
      const validationError = validateSshConfig(form.sshConfig);
      if (validationError) {
        form.setError(validationError);
        form.setSectionId("connection");
        return;
      }
    }

    const updatedConfig: SavedTerminalConfig =
      config.type === "ssh"
        ? {
            ...config,
            name,
            config: form.sshConfig,
            displayConfig: form.displayConfig,
          }
        : {
            ...config,
            name,
            config: form.localConfig,
            displayConfig: form.displayConfig,
          };
    updateConfig(updatedConfig);
    onSave(updatedConfig, form.selectedGroupId);
    onClose();
  };

  const sessionFields = (
    <>
      <div className="edit-terminal-fields">
        <FormField label="Name">
          <input
            type="text"
            value={form.name}
            onChange={(event) => form.setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave();
            }}
            autoFocus
          />
        </FormField>
        <FormField label="Group">
          <select
            value={form.selectedGroupId}
            onChange={(event) => form.setSelectedGroupId(Number(event.target.value))}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <SessionTab
        connectionType={config.type}
        onConnectionTypeChange={() => undefined}
        name={form.name}
        onNameChange={form.setName}
        selectedGroupId={form.selectedGroupId}
        onGroupChange={form.setSelectedGroupId}
        groups={groups}
        localConfig={form.localConfig}
        onLocalConfigChange={form.setLocalConfig}
        sshConfig={form.sshConfig}
        onSshConfigChange={(sshConfig) => {
          form.setSshConfig(sshConfig);
          form.setError("");
        }}
        hideConnectionSwitcher
        hideNameAndGroup
      />
    </>
  );

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

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Terminal"
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
      <SessionFormLayout sidebarItems={sidebarItemProps}>
        <SessionFormPanels
          form={form}
          connectionType={config.type}
          renderSessionSection={() => sessionFields}
        />
      </SessionFormLayout>
    </Dialog>
  );
}

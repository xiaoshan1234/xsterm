import { useState, useEffect, useMemo } from "react";
import {
  type SavedSessionConfig,
  type LocalSessionConfig,
  type SSHSessionConfig,
  type SessionGroup,
  type SessionDisplayConfig,
} from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import SessionTab from "./SessionTab";
import ShellSettingsPanel from "./ShellSettingsPanel";
import SSHSettingsPanel from "./SSHSettingsPanel";
import AppearanceTab from "./AppearanceTab";
import TerminalTab from "./TerminalTab";
import InputTab from "./InputTab";
import LoggingTab from "./LoggingTab";
import { validateSshConfig } from "./SshSessionForm";
import { SessionFormLayout, type SessionFormSidebarItem } from "./SessionFormLayout";
import {
  DEFAULT_SSH,
  SHELL_SIDEBAR_ITEMS,
  SSH_SIDEBAR_ITEMS,
  type SectionId,
} from "./sessionDialogItems";
import "./EditSessionDialog.css";

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
  const [name, setName] = useState(config.name);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groupId);
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>(
    config.type === "local" ? config.config : {},
  );
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>(
    config.type === "ssh" ? config.config : DEFAULT_SSH,
  );
  const [displayConfig, setDisplayConfig] = useState<SessionDisplayConfig | undefined>(
    config.displayConfig,
  );
  const [error, setError] = useState("");
  const [sectionId, setSectionId] = useState<SectionId>("session");

  const sidebarItems = useMemo(
    () => (config.type === "ssh" ? SSH_SIDEBAR_ITEMS : SHELL_SIDEBAR_ITEMS),
    [config.type],
  );

  useEffect(() => {
    if (isOpen) {
      setName(config.name);
      setSelectedGroupId(groupId);
      setLocalConfig(config.type === "local" ? config.config : {});
      setSshConfig(config.type === "ssh" ? config.config : DEFAULT_SSH);
      setDisplayConfig(config.displayConfig);
      setError("");
      setSectionId("session");
    }
  }, [isOpen, config, groupId]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (config.type === "ssh") {
      const validationError = validateSshConfig(sshConfig);
      if (validationError) {
        setError(validationError);
        setSectionId("session");
        return;
      }
    }

    let updatedConfig: SavedSessionConfig;
    if (config.type === "local") {
      updatedConfig = { ...config, name: trimmedName, config: localConfig, displayConfig };
    } else {
      updatedConfig = { ...config, name: trimmedName, config: sshConfig, displayConfig };
    }

    onSave(updatedConfig, selectedGroupId);
    onClose();
  };

  const renderPanelContent = () => {
    if (error && sectionId === "session") {
      return (
        <>
          <div className="dialog-error">{error}</div>
          {renderSection()}
        </>
      );
    }
    return renderSection();
  };

  const renderSection = () => {
    switch (sectionId) {
      case "session":
        return (
          <>
            <div className="edit-session-fields">
              <FormField label="Name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  autoFocus
                />
              </FormField>
              <FormField label="Group">
                <select
                  value={selectedGroupId === null ? "none" : selectedGroupId}
                  onChange={(e) =>
                    setSelectedGroupId(e.target.value === "none" ? null : parseInt(e.target.value))
                  }
                >
                  <option value="none">None</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <SessionTab
              connectionType={config.type === "ssh" ? "ssh" : "local"}
              onConnectionTypeChange={() => {}}
              name={name}
              onNameChange={setName}
              selectedGroupId={selectedGroupId}
              onGroupChange={setSelectedGroupId}
              groups={groups}
              localConfig={localConfig}
              onLocalConfigChange={setLocalConfig}
              sshConfig={sshConfig}
              onSshConfigChange={(cfg) => {
                setSshConfig(cfg);
                setError("");
              }}
              hideConnectionSwitcher
              hideNameAndGroup
            />
          </>
        );
      case "shell":
        return (
          <ShellSettingsPanel
            localConfig={localConfig}
            onLocalConfigChange={setLocalConfig}
          />
        );
      case "ssh":
        return (
          <SSHSettingsPanel
            sshConfig={sshConfig}
            onSshConfigChange={(cfg) => {
              setSshConfig(cfg);
              setError("");
            }}
          />
        );
      case "appearance":
        return (
          <AppearanceTab
            config={displayConfig}
            onChange={setDisplayConfig}
          />
        );
      case "terminal":
        return (
          <TerminalTab
            config={displayConfig}
            onChange={setDisplayConfig}
            connectionType={config.type === "ssh" ? "ssh" : "local"}
            localConfig={localConfig}
            onLocalConfigChange={setLocalConfig}
            sshConfig={sshConfig}
            onSshConfigChange={(cfg) => {
              setSshConfig(cfg);
              setError("");
            }}
          />
        );
      case "input":
        return (
          <InputTab
            displayConfig={displayConfig}
            onDisplayChange={setDisplayConfig}
          />
        );
      case "logging":
        return <LoggingTab config={displayConfig} onChange={setDisplayConfig} />;
    }
  };

  const sidebarItemProps: SessionFormSidebarItem[] = sidebarItems.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === sectionId,
    onClick: () => {
      setSectionId(item.id);
      setError("");
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
        {renderPanelContent()}
      </SessionFormLayout>
    </Dialog>
  );
}

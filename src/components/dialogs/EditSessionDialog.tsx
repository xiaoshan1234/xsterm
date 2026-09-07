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
import "./EditSessionDialog.css";
import { DEFAULT_GROUP_ID } from "../../contexts/session/constants";
import {
  DEFAULT_SSH,
  SHELL_SIDEBAR_ITEMS,
  SSH_SIDEBAR_ITEMS,
  TMUX_SIDEBAR_ITEMS,
  type SectionId,
} from "./sessionDialogItems";

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
  const [selectedGroupId, setSelectedGroupId] = useState<number>(groupId ?? DEFAULT_GROUP_ID);
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

  const sidebarItems = useMemo(() => {
    if (config.type === "tmux-cc") return TMUX_SIDEBAR_ITEMS;
    if (config.type === "ssh") return SSH_SIDEBAR_ITEMS;
    return SHELL_SIDEBAR_ITEMS;
  }, [config.type]);

  useEffect(() => {
    if (isOpen) {
      setName(config.name);
      setSelectedGroupId(groupId ?? DEFAULT_GROUP_ID);
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
    } else if (config.type === "ssh") {
      updatedConfig = { ...config, name: trimmedName, config: sshConfig, displayConfig };
    } else {
      updatedConfig = { ...config, name: trimmedName, displayConfig };
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
      case "session": {
        const inlineFields = (
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
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(parseInt(e.target.value, 10))}
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
      }
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
            connectionType={config.type}
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

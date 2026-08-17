import { useState, useEffect, ReactNode } from "react";
import {
  SavedSessionConfig,
  LocalSessionConfig,
  SSHSessionConfig,
  SessionGroup,
  SessionDisplayConfig,
} from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import {
  LocalSessionIcon,
  SshSessionIcon,
  LayoutIcon,
  LogIcon,
  SettingsIcon,
} from "../icons/Icon";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { DisplayConfigForm } from "./DisplayConfigForm";
import { CommonSettingsForm } from "./CommonSettingsForm";
import {
  SessionFormLayout,
  SessionFormSidebarItem,
} from "./SessionFormLayout";
import "./EditSessionDialog.css";

interface EditSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: SavedSessionConfig;
  groups: SessionGroup[];
  groupId: number | null;
  onSave: (config: SavedSessionConfig, groupId: number | null) => void;
}

type EditSectionId =
  | "session"
  | "displayLayout"
  | "keyboard"
  | "security"
  | "logging"
  | "process";

const FIRST_SECTION_BY_TYPE: Record<"local" | "ssh", EditSectionId> = {
  local: "session",
  ssh: "session",
};

const DEFAULT_SSH: SSHSessionConfig = {
  host: "",
  port: 22,
  username: "",
  auth_type: "password",
  password: "",
  key_file: "",
  passphrase: "",
};

interface SidebarDef {
  id: EditSectionId;
  label: string;
  icon: ReactNode;
}

const SIDEBAR_ITEMS_BY_TYPE: Record<"local" | "ssh", SidebarDef[]> = {
  local: [
    { id: "session", label: "会话", icon: <LocalSessionIcon size={16} /> },
    { id: "displayLayout", label: "显示与布局", icon: <LayoutIcon size={16} /> },
    { id: "keyboard", label: "键盘与输入", icon: <SettingsIcon size={16} /> },
    { id: "security", label: "安全", icon: <SettingsIcon size={16} /> },
    { id: "logging", label: "日志", icon: <LogIcon size={16} /> },
    { id: "process", label: "进程", icon: <SettingsIcon size={16} /> },
  ],
  ssh: [
    { id: "session", label: "会话", icon: <SshSessionIcon size={16} /> },
    { id: "displayLayout", label: "显示与布局", icon: <LayoutIcon size={16} /> },
    { id: "keyboard", label: "键盘与输入", icon: <SettingsIcon size={16} /> },
    { id: "security", label: "安全", icon: <SettingsIcon size={16} /> },
    { id: "logging", label: "日志", icon: <LogIcon size={16} /> },
  ],
};

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
  const [displayConfig, setDisplayConfig] = useState<
    SessionDisplayConfig | undefined
  >(config.displayConfig);
  const [sshError, setSshError] = useState("");
  const [sectionId, setSectionId] = useState<EditSectionId>(
    FIRST_SECTION_BY_TYPE[config.type],
  );

  useEffect(() => {
    if (isOpen) {
      setName(config.name);
      setSelectedGroupId(groupId);
      setLocalConfig(config.type === "local" ? config.config : {});
      setSshConfig(config.type === "ssh" ? config.config : DEFAULT_SSH);
      setDisplayConfig(config.displayConfig);
      setSshError("");
      setSectionId(FIRST_SECTION_BY_TYPE[config.type]);
    }
  }, [isOpen, config, groupId]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (config.type === "ssh") {
      const validationError = validateSshConfig(sshConfig);
      if (validationError) {
        setSshError(validationError);
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

  const nameAndGroupFields = (
    <>
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
            setSelectedGroupId(
              e.target.value === "none" ? null : parseInt(e.target.value),
            )
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
    </>
  );

  const renderPanelContent = () => {
    if (sectionId === "session") {
      if (config.type === "ssh") {
        return (
          <>
            {sshError && <div className="dialog-error">{sshError}</div>}
            {nameAndGroupFields}
            <SshSessionForm
              config={sshConfig}
              onChange={(cfg) => {
                setSshConfig(cfg);
                setSshError("");
              }}
            />
          </>
        );
      }
      return (
        <>
          {nameAndGroupFields}
          <LocalSessionForm
            config={localConfig}
            onChange={setLocalConfig}
            mode="edit"
            section="session"
          />
        </>
      );
    }

    if (sectionId === "displayLayout") {
      return (
        <div className="display-grid">
          <CommonSettingsForm
            config={displayConfig}
            onChange={setDisplayConfig}
            section="display"
          />
          <DisplayConfigForm
            config={displayConfig}
            onChange={setDisplayConfig}
          />
        </div>
      );
    }

    if (sectionId === "keyboard") {
      return (
        <CommonSettingsForm
          config={displayConfig}
          onChange={setDisplayConfig}
          section="keyboard"
        />
      );
    }

    if (sectionId === "security") {
      return (
        <CommonSettingsForm
          config={displayConfig}
          onChange={setDisplayConfig}
          section="security"
        />
      );
    }

    if (sectionId === "logging") {
      return (
        <CommonSettingsForm
          config={displayConfig}
          onChange={setDisplayConfig}
          section="logging"
        />
      );
    }

    // "process" (Shell only — config.type === "ssh" never reaches here).
    return (
      <LocalSessionForm
        config={localConfig}
        onChange={setLocalConfig}
        mode="edit"
        section="process"
      />
    );
  };

  const sidebarItems: SessionFormSidebarItem[] = SIDEBAR_ITEMS_BY_TYPE[
    config.type
  ].map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === sectionId,
    onClick: () => {
      setSectionId(item.id);
      setSshError("");
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
      <SessionFormLayout sidebarItems={sidebarItems}>
        {renderPanelContent()}
      </SessionFormLayout>
    </Dialog>
  );
}
import { useState, useEffect, ReactNode } from "react";
import { useSession } from "../../contexts/SessionContext";
import {
  LocalSessionConfig,
  SSHSessionConfig,
  Session,
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
  SessionFormTab,
} from "./SessionFormLayout";
import "./CreateSessionDialog.css";

interface CreateSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (
    config: LocalSessionConfig,
    save: boolean,
    displayConfig?: SessionDisplayConfig,
  ) => Promise<Session>;
  onCreateSsh: (
    config: SSHSessionConfig,
    save: boolean,
    displayConfig?: SessionDisplayConfig,
  ) => Promise<Session>;
  initialTab?: "local" | "ssh";
  initialGroupId?: number | null;
}

type TopTab = "local" | "ssh";
type SectionId =
  | "session"
  | "displayLayout"
  | "keyboard"
  | "security"
  | "logging"
  | "process";

const FIRST_SECTION: Record<TopTab, SectionId> = {
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

interface SidebarItemDef {
  id: SectionId;
  label: string;
  icon: ReactNode;
}

const SIDEBAR_ITEMS: Record<TopTab, SidebarItemDef[]> = {
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

export default function CreateSessionDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
  initialTab = "local",
  initialGroupId,
}: CreateSessionDialogProps) {
  const { groups, addToGroup } = useSession();

  const [topTab, setTopTab] = useState<TopTab>(initialTab);
  const [sectionId, setSectionId] = useState<SectionId>(
    FIRST_SECTION[initialTab],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [saveConfig, setSaveConfig] = useState(true);
  const [name, setName] = useState("");
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>({});
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>(DEFAULT_SSH);
  const [displayConfig, setDisplayConfig] = useState<
    SessionDisplayConfig | undefined
  >(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setTopTab(initialTab);
      setSectionId(FIRST_SECTION[initialTab]);
      setSelectedGroupId(initialGroupId ?? null);
      setError("");
      setName("");
      setLocalConfig({});
      setSshConfig(DEFAULT_SSH);
      setDisplayConfig(undefined);
    }
  }, [isOpen, initialGroupId, initialTab]);

  const handleTopTabChange = (next: TopTab) => {
    setTopTab(next);
    setSectionId(FIRST_SECTION[next]);
  };

  const handleSectionChange = (id: SectionId) => {
    setSectionId(id);
  };

  const handleCreate = async () => {
    setError("");
    let session: Session;

    try {
      if (topTab === "ssh") {
        const validationError = validateSshConfig(sshConfig);
        if (validationError) {
          setError(validationError);
          return;
        }
        const trimmedName = name.trim();
        const sshConfigWithName: SSHSessionConfig = trimmedName
          ? { ...sshConfig, name: trimmedName }
          : sshConfig;
        session = await onCreateSsh(sshConfigWithName, saveConfig, displayConfig);
      } else {
        const trimmedName = name.trim();
        const localConfigWithName: LocalSessionConfig = trimmedName
          ? { ...localConfig, name: trimmedName }
          : localConfig;
        session = await onCreateLocal(localConfigWithName, saveConfig, displayConfig);
      }

      if (selectedGroupId !== null) {
        addToGroup(selectedGroupId, session.configId);
      }
      onClose();
    } catch (err) {
      console.error("Failed to create session:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const groupSelector = (
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
  );

  const sessionNameField = (
    <FormField label="Session Name">
      <input
        type="text"
        value={name}
        placeholder="Auto-generated if empty"
        onChange={(e) => setName(e.target.value)}
      />
    </FormField>
  );

  const renderPanelContent = () => {
    if (sectionId === "session") {
      if (topTab === "ssh") {
        return (
          <>
            {error && <div className="dialog-error">{error}</div>}
            {sessionNameField}
            {groupSelector}
            <SshSessionForm config={sshConfig} onChange={setSshConfig} />
          </>
        );
      }
      return (
        <>
          {error && <div className="dialog-error">{error}</div>}
          {sessionNameField}
          {groupSelector}
          <LocalSessionForm
            config={localConfig}
            onChange={setLocalConfig}
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

    // "process" (Shell only — SSH tab never reaches this branch).
    return (
      <LocalSessionForm
        config={localConfig}
        onChange={setLocalConfig}
        section="process"
      />
    );
  };

  const sidebarItems = SIDEBAR_ITEMS[topTab];

  const topTabItems: SessionFormTab[] = [
    {
      id: "local",
      label: "Shell",
      active: topTab === "local",
      onClick: () => handleTopTabChange("local"),
    },
    {
      id: "ssh",
      label: "SSH",
      active: topTab === "ssh",
      onClick: () => handleTopTabChange("ssh"),
    },
  ];

  const sidebarItemProps: SessionFormSidebarItem[] = sidebarItems.map(
    (item) => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      active: item.id === sectionId,
      onClick: () => handleSectionChange(item.id),
    }),
  );

  const footer = (
    <div className="dialog-footer-content">
      <label className="checkbox-group">
        <input
          type="checkbox"
          checked={saveConfig}
          onChange={(e) => setSaveConfig(e.target.checked)}
        />
        <span>Save config</span>
      </label>
      <div className="dialog-footer-buttons">
        <button className="btn btn--secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={handleCreate}>
          Create
        </button>
      </div>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create Session"
      footer={footer}
      className="create-session-dialog"
    >
      <SessionFormLayout topTabs={topTabItems} sidebarItems={sidebarItemProps}>
        {renderPanelContent()}
      </SessionFormLayout>
    </Dialog>
  );
}
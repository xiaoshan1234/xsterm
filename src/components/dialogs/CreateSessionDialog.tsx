import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useSession } from "../../contexts/SessionContext";
import {
  type LocalSessionConfig,
  type SSHSessionConfig,
  type Session,
  type SessionDisplayConfig,
} from "../../types/session";
import { Dialog } from "../ui/Dialog";
import {
  SessionIcon,
  ShellIcon,
  SshIcon,
  LayoutIcon,
  KeyboardIcon,
  LogIcon,
} from "../icons/Icon";
import SessionTab from "./SessionTab";
import ShellSettingsPanel from "./ShellSettingsPanel";
import SSHSettingsPanel from "./SSHSettingsPanel";
import AppearanceTab from "./AppearanceTab";
import TerminalTab from "./TerminalTab";
import LoggingTab from "./LoggingTab";
import { validateSshConfig } from "./SshSessionForm";
import {
  SessionFormLayout,
  type SessionFormSidebarItem,
  type SessionFormTab,
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
type SectionId = "session" | "shell" | "ssh" | "appearance" | "terminal" | "logging";

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
  label: ReactNode;
  icon: ReactNode;
}

const SHELL_SIDEBAR_ITEMS: SidebarItemDef[] = [
  { id: "session", label: "Session", icon: <SessionIcon size={16} /> },
  { id: "shell", label: "Shell", icon: <ShellIcon size={16} /> },
  { id: "appearance", label: "Appearance", icon: <LayoutIcon size={16} /> },
  { id: "terminal", label: "Terminal", icon: <KeyboardIcon size={16} /> },
  { id: "logging", label: "Logging", icon: <LogIcon size={16} /> },
];

const SSH_SIDEBAR_ITEMS: SidebarItemDef[] = [
  { id: "session", label: "Session", icon: <SessionIcon size={16} /> },
  { id: "ssh", label: "SSH", icon: <SshIcon size={16} /> },
  { id: "appearance", label: "Appearance", icon: <LayoutIcon size={16} /> },
  { id: "terminal", label: "Terminal", icon: <KeyboardIcon size={16} /> },
  { id: "logging", label: "Logging", icon: <LogIcon size={16} /> },
];

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
  const [sectionId, setSectionId] = useState<SectionId>("session");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [saveConfig, setSaveConfig] = useState(true);
  const [name, setName] = useState("");
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>({});
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>(DEFAULT_SSH);
  const [displayConfig, setDisplayConfig] = useState<SessionDisplayConfig | undefined>(undefined);
  const [error, setError] = useState("");

  const sidebarItems = useMemo(
    () => (topTab === "ssh" ? SSH_SIDEBAR_ITEMS : SHELL_SIDEBAR_ITEMS),
    [topTab],
  );

  useEffect(() => {
    if (isOpen) {
      setTopTab(initialTab);
      setSectionId("session");
      setSelectedGroupId(initialGroupId ?? null);
      setError("");
      setName("");
      setLocalConfig({});
      setSshConfig(DEFAULT_SSH);
      setDisplayConfig(undefined);
    }
  }, [isOpen, initialGroupId, initialTab]);

  const handleTopTabChange = (newTab: TopTab) => {
    setTopTab(newTab);
    setSectionId("session");
  };

  const handleCreate = async () => {
    setError("");
    let session: Session;

    try {
      if (topTab === "ssh") {
        const validationError = validateSshConfig(sshConfig);
        if (validationError) {
          setError(validationError);
          setSectionId("session");
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
          <SessionTab
            connectionType={topTab}
            onConnectionTypeChange={handleTopTabChange}
            name={name}
            onNameChange={setName}
            selectedGroupId={selectedGroupId}
            onGroupChange={setSelectedGroupId}
            groups={groups}
            localConfig={localConfig}
            onLocalConfigChange={setLocalConfig}
            sshConfig={sshConfig}
            onSshConfigChange={setSshConfig}
            hideConnectionSwitcher
          />
        );
      case "shell":
        return (
          <ShellSettingsPanel
            localConfig={localConfig}
            onLocalConfigChange={setLocalConfig}
            displayConfig={displayConfig}
            onDisplayConfigChange={setDisplayConfig}
          />
        );
      case "ssh":
        return (
          <SSHSettingsPanel
            sshConfig={sshConfig}
            onSshConfigChange={setSshConfig}
          />
        );
      case "appearance":
        return <AppearanceTab config={displayConfig} onChange={setDisplayConfig} />;
      case "terminal":
        return (
          <TerminalTab
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

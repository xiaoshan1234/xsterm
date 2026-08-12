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
  SettingsIcon,
} from "../icons/Icon";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { DisplayConfigForm } from "./DisplayConfigForm";
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
type SectionId = "general" | "link" | "system" | "display";

const FIRST_SECTION: Record<TopTab, SectionId> = {
  local: "general",
  ssh: "link",
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
    { id: "general", label: "General", icon: <LocalSessionIcon size={16} /> },
    { id: "display", label: "Display", icon: <LayoutIcon size={16} /> },
  ],
  ssh: [
    { id: "link", label: "Link", icon: <SshSessionIcon size={16} /> },
    { id: "system", label: "System", icon: <SettingsIcon size={16} /> },
    { id: "display", label: "Display", icon: <LayoutIcon size={16} /> },
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
  // Track which connection type the user is configuring so Create still works
  // when they're on the (shared) Display panel.
  const [connectionType, setConnectionType] = useState<"local" | "ssh">(
    initialTab,
  );
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [saveConfig, setSaveConfig] = useState(true);
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
      setConnectionType(initialTab);
      setSelectedGroupId(initialGroupId ?? null);
      setError("");
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
    if (id === "general") setConnectionType("local");
    else if (id === "link" || id === "system") setConnectionType("ssh");
    // "display" is shared; leave connectionType as-is
  };

  const handleCreate = async () => {
    setError("");
    let session: Session;

    try {
      if (connectionType === "ssh") {
        const validationError = validateSshConfig(sshConfig);
        if (validationError) {
          setError(validationError);
          return;
        }
        session = await onCreateSsh(sshConfig, saveConfig, displayConfig);
      } else {
        session = await onCreateLocal(localConfig, saveConfig, displayConfig);
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

  const renderPanelContent = () => {
    switch (sectionId) {
      case "general":
        return (
          <>
            {connectionType === "local" && error && (
              <div className="dialog-error">{error}</div>
            )}
            {groupSelector}
            <LocalSessionForm
              config={localConfig}
              onChange={setLocalConfig}
            />
          </>
        );
      case "link":
        return (
          <>
            {connectionType === "ssh" && error && (
              <div className="dialog-error">{error}</div>
            )}
            {groupSelector}
            <SshSessionForm
              config={sshConfig}
              onChange={setSshConfig}
              section="link"
            />
          </>
        );
      case "system":
        return (
          <SshSessionForm
            config={sshConfig}
            onChange={setSshConfig}
            section="system"
          />
        );
      case "display":
      default:
        return (
          <div className="display-grid">
            <DisplayConfigForm
              config={displayConfig}
              onChange={setDisplayConfig}
            />
          </div>
        );
    }
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
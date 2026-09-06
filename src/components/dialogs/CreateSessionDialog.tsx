import { useState, useEffect, useMemo } from "react";
import { useSession } from "../../contexts/SessionContext";
import {
  type LocalSessionConfig,
  type SSHSessionConfig,
  type Session,
  type SessionDisplayConfig,
  type TmuxCcConfig,
} from "../../types/session";
import { Dialog } from "../ui/Dialog";
import SessionTab from "./SessionTab";
import TmuxForm from "./TmuxForm";
import ShellSettingsPanel from "./ShellSettingsPanel";
import SSHSettingsPanel from "./SSHSettingsPanel";
import AppearanceTab from "./AppearanceTab";
import TerminalTab from "./TerminalTab";
import InputTab from "./InputTab";
import LoggingTab from "./LoggingTab";
import { validateSshConfig } from "./SshSessionForm";
import {
  SessionFormLayout,
  type SessionFormSidebarItem,
  type SessionFormTab,
} from "./SessionFormLayout";
import {
  DEFAULT_SSH,
  SHELL_SIDEBAR_ITEMS,
  SSH_SIDEBAR_ITEMS,
  TMUX_SIDEBAR_ITEMS,
  type SectionId,
} from "./sessionDialogItems";
import "./CreateSessionDialog.css";
import { DEFAULT_GROUP_ID } from "../../contexts/session/constants";

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
  onCreateTmux: (
    config: TmuxCcConfig,
    save: boolean,
    displayConfig?: SessionDisplayConfig,
  ) => Promise<Session>;
  initialTab?: "local" | "ssh" | "tmux-cc";
  initialGroupId?: number;
}

type TopTab = "local" | "ssh" | "tmux-cc";

export default function CreateSessionDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
  onCreateTmux,
  initialTab = "local",
  initialGroupId,
}: CreateSessionDialogProps) {
  const { groups, addToGroup, saveConfigOnly, savedConfigs } = useSession();

  const [topTab, setTopTab] = useState<TopTab>(initialTab);
  const [sectionId, setSectionId] = useState<SectionId>("session");
  const [selectedGroupId, setSelectedGroupId] = useState<number>(DEFAULT_GROUP_ID);
  const [saveConfig, setSaveConfig] = useState(true);
  const [name, setName] = useState("");
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>({});
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>(DEFAULT_SSH);
  const [tmuxConfig, setTmuxConfig] = useState<TmuxCcConfig>({});
  const [displayConfig, setDisplayConfig] = useState<SessionDisplayConfig | undefined>(undefined);
  const [error, setError] = useState("");

  const sidebarItems = useMemo(() => {
    if (topTab === "ssh") return SSH_SIDEBAR_ITEMS;
    if (topTab === "tmux-cc") return TMUX_SIDEBAR_ITEMS;
    return SHELL_SIDEBAR_ITEMS;
  }, [topTab]);

  useEffect(() => {
    if (isOpen) {
      setTopTab(initialTab);
      setSectionId("session");
      setSelectedGroupId(initialGroupId ?? DEFAULT_GROUP_ID);
      setError("");
      setName("");
      setLocalConfig({});
      setSshConfig(DEFAULT_SSH);
      setTmuxConfig({});
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
      } else if (topTab === "tmux-cc") {
        // The user picks a base SSH / Local saved config in TmuxForm.
        // Look it up here and copy the SSH sub-config into the request
        // when the base is an SSH config; the backend routes through
        // the SSH exec channel when `ssh` is set, otherwise it spawns a
        // local `tmux -CC` child.
        const baseConfigId = tmuxConfig.baseConfigId;
        if (!baseConfigId) {
          setError("Please pick a base SSH or Shell saved config.");
          setSectionId("session");
          return;
        }
        const base = savedConfigs.find((c) => c.id === baseConfigId);
        if (!base) {
          setError("Saved base config not found — it may have been deleted.");
          setSectionId("session");
          return;
        }
        if (base.type !== "local" && base.type !== "ssh") {
          setError("Base config must be a Shell or SSH saved config.");
          setSectionId("session");
          return;
        }
        const sshSub: SSHSessionConfig | undefined =
          base.type === "ssh" ? base.config : undefined;
        if (sshSub) {
          const validationError = validateSshConfig(sshSub);
          if (validationError) {
            setError(validationError);
            setSectionId("session");
            return;
          }
        }
        const trimmedName = name.trim();
        const baseTmuxConfig: TmuxCcConfig = {
          ...tmuxConfig,
          ...(sshSub ? { ssh: sshSub } : {}),
        };
        const tmuxConfigWithName: TmuxCcConfig = trimmedName
          ? { ...baseTmuxConfig, name: trimmedName }
          : baseTmuxConfig;
        session = await onCreateTmux(tmuxConfigWithName, saveConfig, displayConfig);
      } else {
        const trimmedName = name.trim();
        const localConfigWithName: LocalSessionConfig = trimmedName
          ? { ...localConfig, name: trimmedName }
          : localConfig;
        session = await onCreateLocal(localConfigWithName, saveConfig, displayConfig);
      }

      addToGroup(selectedGroupId, session.configId);
      onClose();
    } catch (err) {
      console.error("Failed to create session:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveOnly = () => {
    setError("");
    try {
      let type: Session["type"];
      let config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig;

      if (topTab === "ssh") {
        const validationError = validateSshConfig(sshConfig);
        if (validationError) {
          setError(validationError);
          setSectionId("session");
          return;
        }
        type = "ssh";
        const trimmedName = name.trim();
        config = trimmedName ? { ...sshConfig, name: trimmedName } : sshConfig;
      } else if (topTab === "tmux-cc") {
        type = "tmux-cc";
        const baseConfigId = tmuxConfig.baseConfigId;
        if (!baseConfigId) {
          setError("Please pick a base SSH or Shell saved config.");
          setSectionId("session");
          return;
        }
        const base = savedConfigs.find((c) => c.id === baseConfigId);
        if (!base) {
          setError("Saved base config not found — it may have been deleted.");
          setSectionId("session");
          return;
        }
        if (base.type !== "local" && base.type !== "ssh") {
          setError("Base config must be a Shell or SSH saved config.");
          setSectionId("session");
          return;
        }
        const sshSub: SSHSessionConfig | undefined =
          base.type === "ssh" ? base.config : undefined;
        if (sshSub) {
          const validationError = validateSshConfig(sshSub);
          if (validationError) {
            setError(validationError);
            setSectionId("session");
            return;
          }
        }
        const baseTmuxConfig: TmuxCcConfig = {
          ...tmuxConfig,
          ...(sshSub ? { ssh: sshSub } : {}),
        };
        const trimmedName = name.trim();
        config = trimmedName
          ? { ...baseTmuxConfig, name: trimmedName }
          : baseTmuxConfig;
      } else {
        type = "local";
        const trimmedName = name.trim();
        config = trimmedName ? { ...localConfig, name: trimmedName } : localConfig;
      }

      const saved = saveConfigOnly(type, config, displayConfig);
      addToGroup(selectedGroupId, saved.id);
      onClose();
    } catch (err) {
      console.error("Failed to save config:", err);
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
        if (topTab === "tmux-cc") {
          return (
            <TmuxForm
              name={name}
              onNameChange={setName}
              config={tmuxConfig}
              onConfigChange={setTmuxConfig}
            />
          );
        }
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
            connectionType={
              topTab === "tmux-cc"
                ? (() => {
                    const base = tmuxConfig.baseConfigId
                      ? savedConfigs.find((c) => c.id === tmuxConfig.baseConfigId)
                      : undefined;
                    return base?.type === "ssh" ? "ssh" : "tmux-cc";
                  })()
                : (topTab as "local" | "ssh")
            }
            localConfig={localConfig}
            onLocalConfigChange={setLocalConfig}
            sshConfig={sshConfig}
            onSshConfigChange={setSshConfig}
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
    {
      id: "tmux-cc",
      label: "Tmux",
      active: topTab === "tmux-cc",
      onClick: () => handleTopTabChange("tmux-cc"),
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
        <button className="btn btn--secondary" onClick={handleSaveOnly}>
          Save Only
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

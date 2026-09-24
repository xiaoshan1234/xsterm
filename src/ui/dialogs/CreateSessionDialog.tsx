import { useState, useEffect, useMemo } from "react";
import { useSession } from "../../service/legacy/contexts/SessionContext";
import {
  type LocalSessionConfig,
  type SSHSessionConfig,
  type Session,
  type SessionDisplayConfig,
  type TmuxCcConfig,
} from "../../model";
import { Dialog } from "../primitives/Dialog";
import SessionTab from "./SessionTab";
import TmuxForm from "./TmuxForm";
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
} from "./sessionDialogItems";
import { useSessionForm } from "./useSessionForm";
import { SessionFormPanels } from "./SessionFormPanels";
import "./CreateSessionDialog.css";
import { DEFAULT_GROUP_ID } from "../../service/legacy/contexts/session/constants";

interface SessionDialogProps {
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
}: SessionDialogProps) {
  const { groups, addToGroup, saveConfigOnly, savedConfigs } = useSession();

  const [topTab, setTopTab] = useState<TopTab>(initialTab);
  const [tmuxConfig, setTmuxConfig] = useState<TmuxCcConfig>({});
  const [saveConfig, setSaveConfig] = useState(true);

  const form = useSessionForm({
    isOpen,
    initialName: "",
    initialGroupId: initialGroupId ?? DEFAULT_GROUP_ID,
    initialLocalConfig: {},
    initialSshConfig: DEFAULT_SSH,
    initialDisplayConfig: undefined,
  });

  const sidebarItems = useMemo(() => {
    if (topTab === "ssh") return SSH_SIDEBAR_ITEMS;
    if (topTab === "tmux-cc") return TMUX_SIDEBAR_ITEMS;
    return SHELL_SIDEBAR_ITEMS;
  }, [topTab]);

  useEffect(() => {
    if (isOpen) {
      setTopTab(initialTab);
      setTmuxConfig({});
    }
  }, [isOpen, initialTab]);

  const handleTopTabChange = (newTab: TopTab) => {
    setTopTab(newTab);
    form.setSectionId("session");
  };

  const handleCreate = async () => {
    form.setError("");
    let session: Session;

    try {
      if (topTab === "ssh") {
        const validationError = validateSshConfig(form.sshConfig);
        if (validationError) {
          form.setError(validationError);
          form.setSectionId("session");
          return;
        }
        const trimmedName = form.name.trim();
        const sshConfigWithName: SSHSessionConfig = trimmedName
          ? { ...form.sshConfig, name: trimmedName }
          : form.sshConfig;
        session = await onCreateSsh(sshConfigWithName, saveConfig, form.displayConfig);
      } else if (topTab === "tmux-cc") {
        const baseConfigId = tmuxConfig.baseConfigId;
        if (!baseConfigId) {
          form.setError("Please pick a base SSH or Shell saved config.");
          form.setSectionId("session");
          return;
        }
        const base = savedConfigs.find((c) => c.id === baseConfigId);
        if (!base) {
          form.setError("Saved base config not found — it may have been deleted.");
          form.setSectionId("session");
          return;
        }
        if (base.type !== "local" && base.type !== "ssh") {
          form.setError("Base config must be a Shell or SSH saved config.");
          form.setSectionId("session");
          return;
        }
        const sshSub: SSHSessionConfig | undefined = base.type === "ssh" ? base.config : undefined;
        if (sshSub) {
          const validationError = validateSshConfig(sshSub);
          if (validationError) {
            form.setError(validationError);
            form.setSectionId("session");
            return;
          }
        }
        const trimmedTmuxSessionName = tmuxConfig.tmuxSessionName?.trim() ?? "";
        if (!trimmedTmuxSessionName) {
          form.setError("Tmux Session Name is required.");
          form.setSectionId("session");
          return;
        }
        const trimmedName = form.name.trim();
        const baseTmuxConfig: TmuxCcConfig = {
          ...tmuxConfig,
          tmuxSessionName: trimmedTmuxSessionName,
          ...(sshSub ? { ssh: sshSub } : {}),
        };
        const tmuxConfigWithName: TmuxCcConfig = trimmedName
          ? { ...baseTmuxConfig, name: trimmedName }
          : baseTmuxConfig;
        session = await onCreateTmux(tmuxConfigWithName, saveConfig, form.displayConfig);
      } else {
        const trimmedName = form.name.trim();
        const localConfigWithName: LocalSessionConfig = trimmedName
          ? { ...form.localConfig, name: trimmedName }
          : form.localConfig;
        session = await onCreateLocal(localConfigWithName, saveConfig, form.displayConfig);
      }

      addToGroup(form.selectedGroupId, session.configId);
      onClose();
    } catch (err) {
      console.error("Failed to create session:", err);
      form.setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveOnly = () => {
    form.setError("");
    try {
      let type: Session["type"];
      let config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig;

      if (topTab === "ssh") {
        const validationError = validateSshConfig(form.sshConfig);
        if (validationError) {
          form.setError(validationError);
          form.setSectionId("session");
          return;
        }
        type = "ssh";
        const trimmedName = form.name.trim();
        config = trimmedName ? { ...form.sshConfig, name: trimmedName } : form.sshConfig;
      } else if (topTab === "tmux-cc") {
        type = "tmux-cc";
        const baseConfigId = tmuxConfig.baseConfigId;
        if (!baseConfigId) {
          form.setError("Please pick a base SSH or Shell saved config.");
          form.setSectionId("session");
          return;
        }
        const base = savedConfigs.find((c) => c.id === baseConfigId);
        if (!base) {
          form.setError("Saved base config not found — it may have been deleted.");
          form.setSectionId("session");
          return;
        }
        if (base.type !== "local" && base.type !== "ssh") {
          form.setError("Base config must be a Shell or SSH saved config.");
          form.setSectionId("session");
          return;
        }
        const sshSub: SSHSessionConfig | undefined = base.type === "ssh" ? base.config : undefined;
        if (sshSub) {
          const validationError = validateSshConfig(sshSub);
          if (validationError) {
            form.setError(validationError);
            form.setSectionId("session");
            return;
          }
        }
        const trimmedTmuxSessionName = tmuxConfig.tmuxSessionName?.trim() ?? "";
        if (!trimmedTmuxSessionName) {
          form.setError("Tmux Session Name is required.");
          form.setSectionId("session");
          return;
        }
        const baseTmuxConfig: TmuxCcConfig = {
          ...tmuxConfig,
          tmuxSessionName: trimmedTmuxSessionName,
          ...(sshSub ? { ssh: sshSub } : {}),
        };
        const trimmedName = form.name.trim();
        config = trimmedName ? { ...baseTmuxConfig, name: trimmedName } : baseTmuxConfig;
      } else {
        type = "local";
        const trimmedName = form.name.trim();
        config = trimmedName ? { ...form.localConfig, name: trimmedName } : form.localConfig;
      }

      const saved = saveConfigOnly(type, config, form.displayConfig);
      addToGroup(form.selectedGroupId, saved.id);
      onClose();
    } catch (err) {
      console.error("Failed to save config:", err);
      form.setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isTmuxSessionNameMissing = !tmuxConfig.tmuxSessionName?.trim();
  const isCreateDisabled =
    topTab === "tmux-cc" && (!tmuxConfig.baseConfigId || isTmuxSessionNameMissing);

  const renderSessionSection = () => {
    if (topTab === "tmux-cc") {
      return (
        <TmuxForm
          name={form.name}
          onNameChange={form.setName}
          config={tmuxConfig}
          onConfigChange={setTmuxConfig}
        />
      );
    }
    return (
      <SessionTab
        connectionType={topTab}
        onConnectionTypeChange={handleTopTabChange}
        name={form.name}
        onNameChange={form.setName}
        selectedGroupId={form.selectedGroupId}
        onGroupChange={form.setSelectedGroupId}
        groups={groups}
        localConfig={form.localConfig}
        onLocalConfigChange={form.setLocalConfig}
        sshConfig={form.sshConfig}
        onSshConfigChange={form.setSshConfig}
        hideConnectionSwitcher
      />
    );
  };

  const terminalConnectionType: "local" | "ssh" | "tmux-cc" =
    topTab === "tmux-cc"
      ? (() => {
          const base = tmuxConfig.baseConfigId
            ? savedConfigs.find((c) => c.id === tmuxConfig.baseConfigId)
            : undefined;
          return base?.type === "ssh" ? "ssh" : "tmux-cc";
        })()
      : topTab;

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
        <button className="btn btn--primary" onClick={handleCreate} disabled={isCreateDisabled}>
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
        <SessionFormPanels
          form={form}
          connectionType={terminalConnectionType}
          renderSessionSection={renderSessionSection}
        />
      </SessionFormLayout>
    </Dialog>
  );
}

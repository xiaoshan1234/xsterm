import { useState, useEffect } from "react";
import { SavedSessionConfig, LocalSessionConfig, SSHSessionConfig, SessionGroup } from "../../types/session";
import { SshTmuxSessionConfig } from "../../types/tmux";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { TmuxSessionForm, validateSshTmuxConfig } from "./TmuxSessionForm";

interface EditSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: SavedSessionConfig;
  groups: SessionGroup[];
  groupId: number | null;
  savedSshConfigs: SavedSessionConfig[];
  onSave: (config: SavedSessionConfig, groupId: number | null) => void;
}

export function EditSessionDialog({ isOpen, onClose, config, groups, groupId, savedSshConfigs, onSave }: EditSessionDialogProps) {
  const [name, setName] = useState(config.name);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groupId);
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>(config.localConfig ?? {});
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>(
    config.sshConfig ?? { host: "", port: 22, username: "", auth_type: "password", password: "", key_file: "", passphrase: "" }
  );
  const [tmuxConfig, setTmuxConfig] = useState<SshTmuxSessionConfig>(
    config.sshTmuxConfig ?? { tmux: config.tmuxConfig ?? { command: "new-session" } }
  );
  const [sshError, setSshError] = useState("");
  const [tmuxError, setTmuxError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName(config.name);
      setSelectedGroupId(groupId);
      setLocalConfig(config.localConfig ?? {});
      setSshConfig(config.sshConfig ?? { host: "", port: 22, username: "", auth_type: "password", password: "", key_file: "", passphrase: "" });
      setTmuxConfig(config.sshTmuxConfig ?? { tmux: config.tmuxConfig ?? { command: "new-session" } });
      setSshError("");
      setTmuxError("");
    }
  }, [isOpen, config, groupId]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (config.type === "ssh") {
      const validationError = validateSshConfig(sshConfig);
      if (validationError) {
        setSshError(validationError);
        return;
      }
    }

    if (config.type === "tmux" || config.type === "ssh_tmux") {
      const validationError = validateSshTmuxConfig(tmuxConfig, savedSshConfigs);
      if (validationError) {
        setTmuxError(validationError);
        return;
      }
    }

    const isTmuxWithSsh = (config.type === "tmux" || config.type === "ssh_tmux") && tmuxConfig.ssh;
    const updatedConfig: SavedSessionConfig = {
      ...config,
      name: trimmedName,
      localConfig: config.type === "local" ? localConfig : undefined,
      sshConfig: config.type === "ssh" ? sshConfig : undefined,
      tmuxConfig: (config.type === "tmux" || config.type === "ssh_tmux") && !isTmuxWithSsh ? tmuxConfig.tmux : undefined,
      sshTmuxConfig: isTmuxWithSsh ? tmuxConfig : undefined,
      type: isTmuxWithSsh ? "ssh_tmux" : config.type === "tmux" || config.type === "ssh_tmux" ? "tmux" : config.type,
    };

    onSave(updatedConfig, selectedGroupId);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Session"
      size="medium"
      footer={
        <div className="dialog-footer-buttons">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave}>Save</button>
        </div>
      }
    >
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
              e.target.value === "none" ? null : parseInt(e.target.value)
            )
          }
        >
          <option value="none">None</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </FormField>

      {config.type === "local" && (
        <LocalSessionForm
          config={localConfig}
          onChange={setLocalConfig}
          mode="edit"
        />
      )}

      {config.type === "ssh" && (
        <>
          {sshError && <div className="dialog-error">{sshError}</div>}
          <SshSessionForm
            config={sshConfig}
            onChange={(cfg) => { setSshConfig(cfg); setSshError(""); }}
            onError={(err) => setSshError(err)}
            mode="edit"
          />
        </>
      )}

      {(config.type === "tmux" || config.type === "ssh_tmux") && (
        <>
          {tmuxError && <div className="dialog-error">{tmuxError}</div>}
          <TmuxSessionForm
            config={tmuxConfig}
            onChange={(cfg) => { setTmuxConfig(cfg); setTmuxError(""); }}
            savedSshConfigs={savedSshConfigs}
          />
        </>
      )}
    </Dialog>
  );
}

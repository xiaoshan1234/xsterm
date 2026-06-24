import { useState, useEffect } from "react";
import { useSession } from "../../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, SshTmuxSessionConfig, Session } from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { TmuxSessionForm, validateSshTmuxConfig } from "./TmuxSessionForm";
import "./CreateSessionDialog.css";

interface CreateSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (config: LocalSessionConfig, save: boolean) => Promise<Session>;
  onCreateSsh: (config: SSHSessionConfig, save: boolean) => Promise<Session>;
  onCreateTmux: (config: SshTmuxSessionConfig, save: boolean) => Promise<Session>;
  initialGroupId?: number | null;
}

export default function CreateSessionDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
  onCreateTmux,
  initialGroupId,
}: CreateSessionDialogProps) {
  const { groups, savedConfigs, addToGroup } = useSession();
  const savedSshConfigs = savedConfigs.filter(
    (c) => c.type === "ssh" || c.type === "ssh_tmux"
  );
  const [tab, setTab] = useState<"local" | "ssh" | "tmux">("local");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [saveConfig, setSaveConfig] = useState(true);
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>({});
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>({
    host: "",
    port: 22,
    username: "",
    auth_type: "password",
    password: "",
    key_file: "",
    passphrase: "",
  });
  const [tmuxConfig, setTmuxConfig] = useState<SshTmuxSessionConfig>({
    tmux: { command: "new-session" },
  });
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setSelectedGroupId(initialGroupId ?? null);
      setError("");
      setLocalConfig({});
      setSshConfig({
        host: "",
        port: 22,
        username: "",
        auth_type: "password",
        password: "",
        key_file: "",
        passphrase: "",
      });
      setTmuxConfig({ tmux: { command: "new-session" } });
    }
  }, [isOpen, initialGroupId]);

  const handleCreate = async () => {
    setError("");
    let session: Session;

    try {
      if (tab === "local") {
        session = await onCreateLocal(localConfig, saveConfig);
      } else if (tab === "ssh") {
        const validationError = validateSshConfig(sshConfig);
        if (validationError) {
          setError(validationError);
          return;
        }
        session = await onCreateSsh(sshConfig, saveConfig);
      } else {
        const validationError = validateSshTmuxConfig(tmuxConfig, savedSshConfigs);
        if (validationError) {
          setError(validationError);
          return;
        }
        session = await onCreateTmux(tmuxConfig, saveConfig);
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
        <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" onClick={handleCreate}>Create</button>
      </div>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Create Session" footer={footer}>
      <div className="dialog-tabs">
        <button
          className={`dialog-tab ${tab === "local" ? "active" : ""}`}
          onClick={() => setTab("local")}
        >
          Local Shell
        </button>
        <button
          className={`dialog-tab ${tab === "ssh" ? "active" : ""}`}
          onClick={() => setTab("ssh")}
        >
          SSH
        </button>
        <button
          className={`dialog-tab ${tab === "tmux" ? "active" : ""}`}
          onClick={() => setTab("tmux")}
        >
          tmux
        </button>
      </div>

      {error && <div className="dialog-error">{error}</div>}

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

      {tab === "local" ? (
        <LocalSessionForm config={localConfig} onChange={setLocalConfig} />
      ) : tab === "ssh" ? (
        <SshSessionForm config={sshConfig} onChange={setSshConfig} onError={setError} />
      ) : (
        <TmuxSessionForm config={tmuxConfig} onChange={setTmuxConfig} savedSshConfigs={savedSshConfigs} />
      )}
    </Dialog>
  );
}

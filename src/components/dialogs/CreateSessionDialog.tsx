import { useState, useEffect } from "react";
import { useSession } from "../../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, Session } from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import "./CreateSessionDialog.css";

interface CreateSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (config: LocalSessionConfig, save: boolean) => Promise<Session>;
  onCreateSsh: (config: SSHSessionConfig, save: boolean) => Promise<Session>;
}

export default function CreateSessionDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
}: CreateSessionDialogProps) {
  const { groups, addToGroup } = useSession();
  const [tab, setTab] = useState<"local" | "ssh">("local");
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setSelectedGroupId(null);
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
    }
  }, [isOpen]);

  const handleCreate = async () => {
    setError("");
    let session: Session;

    if (tab === "local") {
      session = await onCreateLocal(localConfig, saveConfig);
    } else {
      const validationError = validateSshConfig(sshConfig);
      if (validationError) {
        setError(validationError);
        return;
      }
      session = await onCreateSsh(sshConfig, saveConfig);
    }

    if (selectedGroupId !== null) {
      addToGroup(selectedGroupId, session.configId);
    }
    onClose();
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
      ) : (
        <SshSessionForm config={sshConfig} onChange={setSshConfig} onError={setError} />
      )}
    </Dialog>
  );
}

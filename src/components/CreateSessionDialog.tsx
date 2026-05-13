import { useState } from "react";
import { LocalSessionConfig, SSHSessionConfig } from "../types/session";

interface CreateSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (config: LocalSessionConfig) => void;
  onCreateSsh: (config: SSHSessionConfig) => void;
}

export default function CreateSessionDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
}: CreateSessionDialogProps) {
  const [tab, setTab] = useState<"local" | "ssh">("local");
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

  if (!isOpen) return null;

  const handleLocalCreate = () => {
    setError("");
    onCreateLocal(localConfig);
    onClose();
  };

  const handleSshCreate = () => {
    setError("");
    if (!sshConfig.host || !sshConfig.username) {
      setError("Host and username are required");
      return;
    }
    if (sshConfig.auth_type === "password" && !sshConfig.password) {
      setError("Password is required");
      return;
    }
    if (sshConfig.auth_type === "key" && !sshConfig.key_file) {
      setError("Key file path is required");
      return;
    }
    onCreateSsh(sshConfig);
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Create Session</h2>
          <button className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

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

        {tab === "local" ? (
          <div className="dialog-content">
            <div className="form-group">
              <label>Shell</label>
              <select
                value={localConfig.shell || ""}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, shell: e.target.value })
                }
              >
                <option value="">Default</option>
                <option value="/bin/bash">Bash</option>
                <option value="/bin/zsh">Zsh</option>
                <option value="/bin/sh">Sh</option>
              </select>
            </div>
            <div className="form-group">
              <label>Initial Directory</label>
              <input
                type="text"
                placeholder="~/.zshrc or /home/user"
                value={localConfig.cwd || ""}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, cwd: e.target.value })
                }
              />
            </div>
          </div>
        ) : (
          <div className="dialog-content">
            <div className="form-group">
              <label>Host</label>
              <input
                type="text"
                placeholder="example.com"
                value={sshConfig.host}
                onChange={(e) =>
                  setSshConfig({ ...sshConfig, host: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Port</label>
              <input
                type="number"
                placeholder="22"
                value={sshConfig.port}
                onChange={(e) =>
                  setSshConfig({
                    ...sshConfig,
                    port: parseInt(e.target.value) || 22,
                  })
                }
              />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                placeholder="root"
                value={sshConfig.username}
                onChange={(e) =>
                  setSshConfig({ ...sshConfig, username: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Authentication</label>
              <select
                value={sshConfig.auth_type}
                onChange={(e) =>
                  setSshConfig({
                    ...sshConfig,
                    auth_type: e.target.value as "password" | "key",
                  })
                }
              >
                <option value="password">Password</option>
                <option value="key">Key File</option>
              </select>
            </div>
            {sshConfig.auth_type === "password" ? (
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="********"
                  value={sshConfig.password || ""}
                  onChange={(e) =>
                    setSshConfig({ ...sshConfig, password: e.target.value })
                  }
                />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>Key File Path</label>
                  <input
                    type="text"
                    placeholder="~/.ssh/id_rsa"
                    value={sshConfig.key_file || ""}
                    onChange={(e) =>
                      setSshConfig({ ...sshConfig, key_file: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Passphrase (optional)</label>
                  <input
                    type="password"
                    placeholder="********"
                    value={sshConfig.passphrase || ""}
                    onChange={(e) =>
                      setSshConfig({ ...sshConfig, passphrase: e.target.value })
                    }
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="dialog-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-create"
            onClick={tab === "local" ? handleLocalCreate : handleSshCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
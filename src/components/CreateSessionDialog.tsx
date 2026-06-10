import { useState, useEffect } from "react";
import { useSession } from "../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, Session } from "../types/session";

const isWindows = navigator.userAgent.toLowerCase().includes("windows") ||
  navigator.platform.toLowerCase().includes("win");

const LOCAL_SHELLS = isWindows
  ? [
      { value: "", label: "Default (PowerShell)" },
      { value: "powershell.exe", label: "PowerShell" },
      { value: "pwsh.exe", label: "PowerShell 7" },
      { value: "cmd.exe", label: "CMD" },
      { value: "wsl.exe", label: "WSL (Default Distro)" },
      { value: "wsl.exe -d Ubuntu", label: "WSL - Ubuntu" },
      { value: "wsl.exe -d Debian", label: "WSL - Debian" },
      { value: "wsl.exe -d Arch", label: "WSL - Arch" },
    ]
  : [
      { value: "", label: "Default ($SHELL)" },
      { value: "/bin/bash", label: "Bash" },
      { value: "/bin/zsh", label: "Zsh" },
      { value: "/bin/sh", label: "Sh" },
    ];

const CWD_PLACEHOLDER = isWindows ? "C:\\Users\\you or %USERPROFILE%" : "/home/user or ~";

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

  if (!isOpen) return null;

  const handleLocalCreate = async () => {
    setError("");
    const session = await onCreateLocal(localConfig, saveConfig);
    if (selectedGroupId !== null) {
      addToGroup(selectedGroupId, session.configId);
    }
    onClose();
  };

  const handleSshCreate = async () => {
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
    const session = await onCreateSsh(sshConfig, saveConfig);
    if (selectedGroupId !== null) {
      addToGroup(selectedGroupId, session.configId);
    }
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

        <div className="dialog-content">
          <div className="form-group">
            <label>Group</label>
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
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          {tab === "local" ? (
            <>
              <div className="form-group">
                <label>Shell</label>
                <select
                  value={localConfig.shell || ""}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, shell: e.target.value || undefined })
                  }
                >
                  {LOCAL_SHELLS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Initial Directory</label>
                <input
                  type="text"
                  placeholder={CWD_PLACEHOLDER}
                  value={localConfig.cwd || ""}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, cwd: e.target.value })
                  }
                />
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="dialog-footer">
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
      </div>
    </div>
  );
}

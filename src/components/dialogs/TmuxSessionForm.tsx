import { useState } from "react";
import { SavedSessionConfig, SSHSessionConfig } from "../../types/session";
import { SshTmuxSessionConfig } from "../../types/tmux";
import { FormField } from "../ui/FormField";

interface TmuxSessionFormProps {
  config: SshTmuxSessionConfig;
  onChange: (config: SshTmuxSessionConfig) => void;
  savedSshConfigs: SavedSessionConfig[];
}

function getSshFromSaved(saved: SavedSessionConfig | undefined): SSHSessionConfig | undefined {
  if (saved?.type === "ssh") {
    return saved.sshConfig;
  }
  if (saved?.type === "ssh_tmux") {
    return saved.sshTmuxConfig?.ssh;
  }
  return undefined;
}

export function TmuxSessionForm({ config, onChange, savedSshConfigs }: TmuxSessionFormProps) {
  const [connectionType, setConnectionType] = useState<"local" | "ssh" | "saved">(
    config.ssh ? "ssh" : "local"
  );
  const [selectedSshConfigId, setSelectedSshConfigId] = useState<string>("");

  const updateTmux = (tmux: SshTmuxSessionConfig["tmux"]) => {
    onChange({ ...config, tmux });
  };

  const updateSsh = (ssh: SshTmuxSessionConfig["ssh"]) => {
    onChange({ ...config, ssh });
  };

  const applySavedSshConfig = (configId: string) => {
    setSelectedSshConfigId(configId);
    const saved = savedSshConfigs.find((c) => c.id === configId);
    const sshConfig = getSshFromSaved(saved);
    if (sshConfig) {
      onChange({ ...config, ssh: sshConfig });
    } else if (configId === "") {
      onChange({ tmux: config.tmux });
    }
  };

  const setType = (type: "local" | "ssh" | "saved") => {
    setConnectionType(type);
    setSelectedSshConfigId("");
    if (type === "local") {
      onChange({ tmux: config.tmux });
    } else if (type === "saved") {
      const first = savedSshConfigs[0];
      const firstSsh = getSshFromSaved(first);
      if (first && firstSsh) {
        setSelectedSshConfigId(first.id);
        onChange({ ...config, ssh: firstSsh });
      } else {
        onChange({ tmux: config.tmux });
      }
    } else {
      onChange({
        ...config,
        ssh: config.ssh ?? {
          host: "",
          port: 22,
          username: "",
          auth_type: "password",
          password: "",
          key_file: "",
          passphrase: "",
        },
      });
    }
  };

  const ssh = config.ssh;

  return (
    <div className="tmux-session-form">
      <FormField label="Connection">
        <select value={connectionType} onChange={(e) => setType(e.target.value as "local" | "ssh" | "saved")}>
          <option value="local">Local tmux</option>
          <option value="saved">Saved SSH tmux</option>
          <option value="ssh">Manual SSH tmux</option>
        </select>
      </FormField>

      {connectionType === "saved" && (
        <FormField label="Saved SSH session">
          <select value={selectedSshConfigId} onChange={(e) => applySavedSshConfig(e.target.value)}>
            <option value="">Select a saved SSH session...</option>
            {savedSshConfigs.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FormField>
      )}

      {connectionType === "ssh" && ssh && (
        <>
          <FormField label="Host">
            <input
              type="text"
              value={ssh.host}
              onChange={(e) => updateSsh({ ...ssh, host: e.target.value })}
              placeholder="remote-host"
            />
          </FormField>
          <FormField label="Port">
            <input
              type="number"
              value={ssh.port}
              onChange={(e) => updateSsh({ ...ssh, port: parseInt(e.target.value, 10) || 22 })}
            />
          </FormField>
          <FormField label="Username">
            <input
              type="text"
              value={ssh.username}
              onChange={(e) => updateSsh({ ...ssh, username: e.target.value })}
            />
          </FormField>
          <FormField label="Auth type">
            <select
              value={ssh.auth_type}
              onChange={(e) => updateSsh({ ...ssh, auth_type: e.target.value as "password" | "key" })}
            >
              <option value="password">Password</option>
              <option value="key">Key file</option>
            </select>
          </FormField>
          {ssh.auth_type === "password" ? (
            <FormField label="Password">
              <input
                type="password"
                value={ssh.password ?? ""}
                onChange={(e) => updateSsh({ ...ssh, password: e.target.value })}
              />
            </FormField>
          ) : (
            <>
              <FormField label="Key file">
                <input
                  type="text"
                  value={ssh.key_file ?? ""}
                  onChange={(e) => updateSsh({ ...ssh, key_file: e.target.value })}
                  placeholder="~/.ssh/id_rsa"
                />
              </FormField>
              <FormField label="Passphrase">
                <input
                  type="password"
                  value={ssh.passphrase ?? ""}
                  onChange={(e) => updateSsh({ ...ssh, passphrase: e.target.value })}
                />
              </FormField>
            </>
          )}
        </>
      )}

      <FormField label="Session name *">
        <input
          type="text"
          value={config.tmux.target ?? ""}
          onChange={(e) => updateTmux({ ...config.tmux, target: e.target.value || undefined })}
          placeholder="Required session name"
        />
      </FormField>

      <FormField label="Socket name">
        <input
          type="text"
          value={config.tmux.socket ?? ""}
          onChange={(e) => updateTmux({ ...config.tmux, socket: e.target.value || undefined })}
          placeholder="Optional tmux socket (-L)"
        />
      </FormField>
    </div>
  );
}

function sshConfigsEqual(a: SSHSessionConfig, b: SSHSessionConfig): boolean {
  return (
    a.host === b.host &&
    (a.port ?? 22) === (b.port ?? 22) &&
    a.username === b.username &&
    a.auth_type === b.auth_type &&
    a.password === b.password &&
    a.key_file === b.key_file &&
    a.passphrase === b.passphrase
  );
}

export function validateSshTmuxConfig(config: SshTmuxSessionConfig, savedSshConfigs: SavedSessionConfig[] = []): string | null {
  if (config.ssh) {
    const saved = savedSshConfigs.find(
      (c) => {
        const savedSsh = getSshFromSaved(c);
        return savedSsh && sshConfigsEqual(savedSsh, config.ssh!);
      }
    );
    if (saved) {
      return null;
    }
    if (!config.ssh.host.trim()) return "Host is required";
    if (!config.ssh.username.trim()) return "Username is required";
    if (config.ssh.auth_type === "password" && !config.ssh.password) {
      return "Password is required";
    }
    if (config.ssh.auth_type === "key" && !config.ssh.key_file) {
      return "Key file is required";
    }
  }
  if (!config.tmux.target?.trim()) {
    return "Session name is required";
  }
  return null;
}

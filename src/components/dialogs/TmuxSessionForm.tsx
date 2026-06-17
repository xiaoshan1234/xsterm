import { useState } from "react";
import { SshTmuxSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";

interface TmuxSessionFormProps {
  config: SshTmuxSessionConfig;
  onChange: (config: SshTmuxSessionConfig) => void;
}

export function TmuxSessionForm({ config, onChange }: TmuxSessionFormProps) {
  const [connectionType, setConnectionType] = useState<"local" | "ssh">(
    config.ssh ? "ssh" : "local"
  );

  const updateTmux = (tmux: SshTmuxSessionConfig["tmux"]) => {
    onChange({ ...config, tmux });
  };

  const updateSsh = (ssh: SshTmuxSessionConfig["ssh"]) => {
    onChange({ ...config, ssh });
  };

  const setType = (type: "local" | "ssh") => {
    setConnectionType(type);
    if (type === "local") {
      const { ssh: _, ...rest } = config;
      onChange(rest as SshTmuxSessionConfig);
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
        <select value={connectionType} onChange={(e) => setType(e.target.value as "local" | "ssh")}>
          <option value="local">Local tmux</option>
          <option value="ssh">SSH tmux</option>
        </select>
      </FormField>

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

      <FormField label="Command">
        <select
          value={config.tmux.command}
          onChange={(e) => updateTmux({ ...config.tmux, command: e.target.value })}
        >
          <option value="new-session">new-session</option>
          <option value="attach-session">attach-session</option>
        </select>
      </FormField>

      <FormField label={config.tmux.command === "attach-session" ? "Target session" : "Session name / target"}>
        <input
          type="text"
          value={config.tmux.target ?? ""}
          onChange={(e) => updateTmux({ ...config.tmux, target: e.target.value || undefined })}
          placeholder={config.tmux.command === "attach-session" ? "Session name to attach" : "Optional session name"}
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

export function validateSshTmuxConfig(config: SshTmuxSessionConfig): string | null {
  if (config.ssh) {
    if (!config.ssh.host.trim()) return "Host is required";
    if (!config.ssh.username.trim()) return "Username is required";
    if (config.ssh.auth_type === "password" && !config.ssh.password) {
      return "Password is required";
    }
    if (config.ssh.auth_type === "key" && !config.ssh.key_file) {
      return "Key file is required";
    }
  }
  return null;
}

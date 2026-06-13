import { useState, useEffect } from "react";
import { SSHSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";

const DEFAULT_SSH_CONFIG: SSHSessionConfig = {
  host: "",
  port: 22,
  username: "",
  auth_type: "password",
  password: "",
  key_file: "",
  passphrase: "",
};

interface SshSessionFormProps {
  config: SSHSessionConfig;
  onChange: (config: SSHSessionConfig) => void;
  onError: (error: string) => void;
}

export function SshSessionForm({ config, onChange }: SshSessionFormProps) {
  useEffect(() => {
    onChange(DEFAULT_SSH_CONFIG);
  }, []);

  return (
    <>
      <FormField label="Host">
        <input
          type="text"
          placeholder="example.com"
          value={config.host}
          onChange={(e) => onChange({ ...config, host: e.target.value })}
        />
      </FormField>
      <FormField label="Port">
        <input
          type="number"
          placeholder="22"
          value={config.port}
          onChange={(e) => onChange({ ...config, port: parseInt(e.target.value) || 22 })}
        />
      </FormField>
      <FormField label="Username">
        <input
          type="text"
          placeholder="root"
          value={config.username}
          onChange={(e) => onChange({ ...config, username: e.target.value })}
        />
      </FormField>
      <FormField label="Authentication">
        <select
          value={config.auth_type}
          onChange={(e) => onChange({ ...config, auth_type: e.target.value as "password" | "key" })}
        >
          <option value="password">Password</option>
          <option value="key">Key File</option>
        </select>
      </FormField>
      {config.auth_type === "password" ? (
        <FormField label="Password">
          <input
            type="password"
            placeholder="********"
            value={config.password || ""}
            onChange={(e) => onChange({ ...config, password: e.target.value })}
          />
        </FormField>
      ) : (
        <>
          <FormField label="Key File Path">
            <input
              type="text"
              placeholder="~/.ssh/id_rsa"
              value={config.key_file || ""}
              onChange={(e) => onChange({ ...config, key_file: e.target.value })}
            />
          </FormField>
          <FormField label="Passphrase (optional)">
            <input
              type="password"
              placeholder="********"
              value={config.passphrase || ""}
              onChange={(e) => onChange({ ...config, passphrase: e.target.value })}
            />
          </FormField>
        </>
      )}
    </>
  );
}

export function validateSshConfig(config: SSHSessionConfig): string | null {
  if (!config.host || !config.username) {
    return "Host and username are required";
  }
  if (config.auth_type === "password" && !config.password) {
    return "Password is required";
  }
  if (config.auth_type === "key" && !config.key_file) {
    return "Key file path is required";
  }
  return null;
}

export function useSshFormReset(isOpen: boolean) {
  const [config, setConfig] = useState<SSHSessionConfig>(DEFAULT_SSH_CONFIG);

  useEffect(() => {
    if (isOpen) setConfig(DEFAULT_SSH_CONFIG);
  }, [isOpen]);

  return [config, setConfig] as const;
}

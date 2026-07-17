import { useEffect } from "react";
import { SshSessionSpec } from "../../types/session";
import { FormField } from "../ui/FormField";

const DEFAULT_SSH_SPEC: SshSessionSpec = {
  host: "",
  port: 22,
  username: "",
  auth_type: "password",
  password: "",
  key_file: "",
  passphrase: "",
};

export interface SshSessionFormProps {
  value: SshSessionSpec;
  onChange: (value: SshSessionSpec) => void;
  mode?: "create" | "edit";
  disabled?: boolean;
}

export function SshSessionForm({ value, onChange, mode = "create", disabled = false }: SshSessionFormProps) {
  useEffect(() => {
    if (mode === "create") {
      onChange(DEFAULT_SSH_SPEC);
    }
  }, [mode]);

  return (
    <>
      <FormField label="Host">
        <input
          type="text"
          placeholder="example.com"
          value={value.host}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, host: e.target.value })}
        />
      </FormField>
      <FormField label="Port">
        <input
          type="number"
          placeholder="22"
          value={value.port}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, port: parseInt(e.target.value) || 22 })}
        />
      </FormField>
      <FormField label="Username">
        <input
          type="text"
          placeholder="root"
          value={value.username}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, username: e.target.value })}
        />
      </FormField>
      <FormField label="Authentication">
        <select
          value={value.auth_type}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, auth_type: e.target.value as "password" | "key" })}
        >
          <option value="password">Password</option>
          <option value="key">Key File</option>
        </select>
      </FormField>
      {value.auth_type === "password" ? (
        <FormField label="Password">
          <input
            type="password"
            placeholder="********"
            value={value.password || ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
          />
        </FormField>
      ) : (
        <>
          <FormField label="Key File Path">
            <input
              type="text"
              placeholder="~/.ssh/id_rsa"
              value={value.key_file || ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, key_file: e.target.value })}
            />
          </FormField>
          <FormField label="Passphrase (optional)">
            <input
              type="password"
              placeholder="********"
              value={value.passphrase || ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, passphrase: e.target.value })}
            />
          </FormField>
        </>
      )}
    </>
  );
}

export function validateSshConfig(config: SshSessionSpec): string | null {
  if (!config.host || !config.username) {
    return "Host and username are required";
  }
  if (config.port < 1 || config.port > 65535) {
    return "Port must be between 1 and 65535";
  }
  if (config.auth_type === "password" && !config.password) {
    return "Password is required";
  }
  if (config.auth_type === "key" && !config.key_file) {
    return "Key file path is required";
  }
  return null;
}

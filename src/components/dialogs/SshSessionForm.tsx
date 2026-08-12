import { SSHSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";

const TERM_TYPES = [
  { value: "xterm-256color", label: "xterm-256color (recommended)" },
  { value: "xterm", label: "xterm" },
  { value: "vt100", label: "vt100" },
  { value: "screen", label: "screen" },
];

interface SshSessionFormProps {
  config: SSHSessionConfig;
  onChange: (config: SSHSessionConfig) => void;
  onError?: (error: string) => void;
  mode?: "create" | "edit";
  /**
   * When set, render only the fields that belong to that section.
   * - "link"   → Host / Port / Username / Authentication
   * - "system" → Terminal type / Initial rows+cols / Keepalive / Timeout / Compression
   * - undefined → render all fields (default; used by EditSessionDialog)
   */
  section?: "link" | "system";
}

export function SshSessionForm({
  config,
  onChange,
  section,
}: SshSessionFormProps) {
  const showLink = !section || section === "link";
  const showSystem = !section || section === "system";

  return (
    <>
      {showLink && (
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
              onChange={(e) =>
                onChange({ ...config, port: parseInt(e.target.value) || 22 })
              }
            />
          </FormField>
          <FormField label="Username">
            <input
              type="text"
              placeholder="root"
              value={config.username}
              onChange={(e) =>
                onChange({ ...config, username: e.target.value })
              }
            />
          </FormField>
          <FormField label="Authentication">
            <select
              value={config.auth_type}
              onChange={(e) =>
                onChange({
                  ...config,
                  auth_type: e.target.value as "password" | "key",
                })
              }
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
                onChange={(e) =>
                  onChange({ ...config, password: e.target.value })
                }
              />
            </FormField>
          ) : (
            <>
              <FormField label="Key File Path">
                <input
                  type="text"
                  placeholder="~/.ssh/id_rsa"
                  value={config.key_file || ""}
                  onChange={(e) =>
                    onChange({ ...config, key_file: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Passphrase (optional)">
                <input
                  type="password"
                  placeholder="********"
                  value={config.passphrase || ""}
                  onChange={(e) =>
                    onChange({ ...config, passphrase: e.target.value })
                  }
                />
              </FormField>
            </>
          )}
        </>
      )}
      {showSystem && (
        <>
          <FormField label="Terminal Type">
            <select
              value={config.termType || "xterm-256color"}
              onChange={(e) =>
                onChange({ ...config, termType: e.target.value })
              }
            >
              {TERM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Initial Rows">
            <input
              type="number"
              placeholder="24"
              value={config.initialRows ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  ...config,
                  initialRows: v ? parseInt(v) : undefined,
                });
              }}
            />
          </FormField>
          <FormField label="Initial Cols">
            <input
              type="number"
              placeholder="80"
              value={config.initialCols ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  ...config,
                  initialCols: v ? parseInt(v) : undefined,
                });
              }}
            />
          </FormField>
          <FormField label="Keepalive Interval (seconds)">
            <input
              type="number"
              placeholder="(disabled)"
              value={config.keepaliveInterval ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  ...config,
                  keepaliveInterval: v ? parseInt(v) : undefined,
                });
              }}
            />
          </FormField>
          <FormField label="Connection Timeout (seconds)">
            <input
              type="number"
              placeholder="(no timeout)"
              value={config.connectionTimeout ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  ...config,
                  connectionTimeout: v ? parseInt(v) : undefined,
                });
              }}
            />
          </FormField>
          <FormField label="Enable Compression">
            <input
              type="checkbox"
              checked={config.enableCompression ?? false}
              onChange={(e) =>
                onChange({ ...config, enableCompression: e.target.checked })
              }
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
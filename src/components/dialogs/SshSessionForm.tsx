import { useEffect, useState } from "react";
import { SSHSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";
import "./SshSessionForm.css";

const TERM_TYPES = [
  { value: "xterm-256color", label: "xterm-256color (recommended)" },
  { value: "xterm", label: "xterm" },
  { value: "vt100", label: "vt100" },
  { value: "screen", label: "screen" },
];

interface SshOpts {
  termType?: string;
  initialRows?: number;
  initialCols?: number;
  keepaliveInterval?: number;
  connectionTimeout?: number;
  enableCompression?: boolean;
  knownHostsPath?: string;
  proxyJump?: string;
}

// Empty input → undefined so backend #[serde(default)] takes over.
function parseOptionalInt(value: string): number | undefined {
  return value.trim() ? parseInt(value, 10) : undefined;
}

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

  const [showConnectionOptions, setShowConnectionOptions] = useState(true);
  const [sshOpts, setSshOpts] = useState<SshOpts>(() => ({
    termType: config.termType,
    initialRows: config.initialRows,
    initialCols: config.initialCols,
    keepaliveInterval: config.keepaliveInterval,
    connectionTimeout: config.connectionTimeout,
    enableCompression: config.enableCompression,
    knownHostsPath: config.knownHostsPath,
    proxyJump: config.proxyJump,
  }));

  // Re-read knownHostsPath/proxyJump from config when it changes externally
  // (e.g. user loads a different saved SSH config).
  useEffect(() => {
    setSshOpts((prev) => ({
      ...prev,
      knownHostsPath: config.knownHostsPath,
      proxyJump: config.proxyJump,
    }));
  }, [config.knownHostsPath, config.proxyJump]);

  const updateOpts = (patch: Partial<SshOpts>) => {
    const next = { ...sshOpts, ...patch };
    setSshOpts(next);
    onChange({ ...config, ...next });
  };

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
          <FormField label="Known Hosts File">
            <input
              type="text"
              placeholder="~/.ssh/known_hosts"
              value={sshOpts.knownHostsPath || ""}
              onChange={(e) => updateOpts({ knownHostsPath: e.target.value })}
            />
          </FormField>
          <FormField label="ProxyJump (SSH bastion)">
            <input
              type="text"
              placeholder="user@bastion:22"
              value={sshOpts.proxyJump || ""}
              onChange={(e) => updateOpts({ proxyJump: e.target.value })}
            />
          </FormField>
        </>
      )}
      {showSystem && (
        <div className="ssh-opts-section">
          <button
            type="button"
            className="ssh-opts-section__header"
            aria-expanded={showConnectionOptions}
            aria-controls="ssh-opts-body"
            onClick={() => setShowConnectionOptions((v) => !v)}
          >
            <span>Connection Options</span>
            <span className="ssh-opts-section__chevron" aria-hidden="true">
              ▶
            </span>
          </button>
          {showConnectionOptions && (
            <div
              id="ssh-opts-body"
              className="ssh-opts-section__body"
            >
              <FormField label="Terminal Type">
                <select
                  value={sshOpts.termType || "xterm-256color"}
                  onChange={(e) => updateOpts({ termType: e.target.value })}
                >
                  {TERM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="ssh-opts-row">
                <FormField label="Initial Rows">
                  <input
                    type="number"
                    placeholder="24"
                    value={sshOpts.initialRows ?? ""}
                    onChange={(e) =>
                      updateOpts({ initialRows: parseOptionalInt(e.target.value) })
                    }
                  />
                </FormField>
                <FormField label="Initial Cols">
                  <input
                    type="number"
                    placeholder="80"
                    value={sshOpts.initialCols ?? ""}
                    onChange={(e) =>
                      updateOpts({ initialCols: parseOptionalInt(e.target.value) })
                    }
                  />
                </FormField>
              </div>
              <FormField label="Keepalive Interval (seconds)">
                <input
                  type="number"
                  placeholder="(disabled)"
                  value={sshOpts.keepaliveInterval ?? ""}
                  onChange={(e) =>
                    updateOpts({
                      keepaliveInterval: parseOptionalInt(e.target.value),
                    })
                  }
                />
              </FormField>
              <FormField label="Connection Timeout (seconds)">
                <input
                  type="number"
                  placeholder="30"
                  value={sshOpts.connectionTimeout ?? ""}
                  onChange={(e) =>
                    updateOpts({
                      connectionTimeout: parseOptionalInt(e.target.value),
                    })
                  }
                />
              </FormField>
              <FormField label="Enable Compression">
                <input
                  type="checkbox"
                  checked={sshOpts.enableCompression ?? false}
                  onChange={(e) =>
                    updateOpts({ enableCompression: e.target.checked })
                  }
                />
              </FormField>
            </div>
          )}
        </div>
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
import { useEffect, useState } from "react";
import { type SSHSessionConfig } from "../../types/session";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./SshSessionForm.css";

const TERM_TYPES = [
  { value: "xterm-256color", label: "xterm-256color" },
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
  tcpNoDelay?: boolean;
  soKeepalive?: boolean;
  nullPacketKeepalive?: boolean;
  charset?: string;
  enableCompression?: boolean;
  knownHostsPath?: string;
  proxyJump?: string;
}

interface SshSessionFormProps {
  config: SSHSessionConfig;
  onChange: (config: SSHSessionConfig) => void;
  onError?: (error: string) => void;
  mode?: "create" | "edit";
  /**
   * When set, render only the fields that belong to that section.
   *   - "link"   → Authentication (host / port / username / auth_type /
   *                password or key_file + passphrase)
   *   - "system" → Terminal (termType / initialRows / initialCols /
   *                keepaliveInterval)
   *   - undefined → render all fields (backward-compatible default; used
   *                when this component is the only form on a page)
   *
   * Stream (charset / knownHostsPath / proxyJump) and Network
   * (connectionTimeout / tcpNoDelay / soKeepalive / nullPacketKeepalive /
   * enableCompression) options are rendered by `SshConnectionSection`
   * instead and are intentionally not part of either `link` or `system`.
   */
  section?: "link" | "system";
}

export function SshSessionForm({ config, onChange, section }: SshSessionFormProps) {
  const showLink = !section || section === "link";
  const showSystem = !section || section === "system";

  const [showConnectionOptions, setShowConnectionOptions] = useState(true);
  const [sshOpts, setSshOpts] = useState<SshOpts>(() => ({
    termType: config.termType,
    initialRows: config.initialRows,
    initialCols: config.initialCols,
    keepaliveInterval: config.keepaliveInterval,
    connectionTimeout: config.connectionTimeout,
    tcpNoDelay: config.tcpNoDelay,
    soKeepalive: config.soKeepalive,
    nullPacketKeepalive: config.nullPacketKeepalive,
    charset: config.charset,
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
          <FormTextField
            label="Host"
            placeholder="example.com"
            value={config.host}
            onChange={(host) => onChange({ ...config, host: host ?? "" })}
          />
          <FormNumberField
            label="Port"
            placeholder="22"
            min={1}
            max={65535}
            value={config.port}
            onChange={(v) => onChange({ ...config, port: v ?? 22 })}
          />
          <FormTextField
            label="Username"
            placeholder="root"
            value={config.username}
            onChange={(username) => onChange({ ...config, username: username ?? "" })}
          />
          <FormSelectField
            label="Authentication"
            value={config.auth_type}
            onChange={(v) => onChange({ ...config, auth_type: v as "password" | "key" })}
            options={[
              { value: "password", label: "Password" },
              { value: "key", label: "Key File" },
            ]}
          />
          {config.auth_type === "password" ? (
            <FormTextField
              label="Password"
              placeholder="********"
              type="password"
              value={config.password}
              onChange={(password) => onChange({ ...config, password })}
            />
          ) : (
            <>
              <FormTextField
                label="Key File Path"
                placeholder="~/.ssh/id_rsa"
                value={config.key_file}
                onChange={(key_file) => onChange({ ...config, key_file })}
              />
              <FormTextField
                label="Passphrase (optional)"
                placeholder="********"
                type="password"
                value={config.passphrase}
                onChange={(passphrase) => onChange({ ...config, passphrase })}
              />
            </>
          )}
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
            <div id="ssh-opts-body" className="ssh-opts-section__body">
              <FormSelectField
                label="Terminal Type"
                value={sshOpts.termType || "xterm-256color"}
                onChange={(v) => updateOpts({ termType: v })}
                options={TERM_TYPES}
              />
              <div className="ssh-opts-row">
                <FormNumberField
                  label="Initial Rows"
                  placeholder="24"
                  value={sshOpts.initialRows}
                  onChange={(initialRows) => updateOpts({ initialRows })}
                />
                <FormNumberField
                  label="Initial Cols"
                  placeholder="80"
                  value={sshOpts.initialCols}
                  onChange={(initialCols) => updateOpts({ initialCols })}
                />
              </div>
              <FormNumberField
                label="Keepalive Interval (seconds)"
                placeholder="(disabled)"
                value={sshOpts.keepaliveInterval}
                onChange={(keepaliveInterval) => updateOpts({ keepaliveInterval })}
              />
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

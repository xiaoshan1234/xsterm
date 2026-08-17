import { SSHSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";
import "./SshConnectionSection.css";

interface SshConnectionSectionProps {
  config: SSHSessionConfig;
  onChange: (config: SSHSessionConfig) => void;
}

const CHARSETS = [
  { value: "utf-8", label: "UTF-8 (recommended)" },
  { value: "gbk", label: "GBK" },
];

// Empty input → undefined so backend #[serde(default)] takes over.
function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Renders the SSH "SSH Connection" sidebar panel for the create/edit dialogs.
 *
 * Groups all SSH transport / stream / network options that previously lived in
 * `SshSessionForm` "link" + "system" sections so the sidebar has a dedicated
 * "SSH Connection" entry instead of burying them inside the generic "Session"
 * page. Authentication fields are included here because they belong to the
 * connection itself, not to the session metadata.
 *
 * Sub-groups (collapsible `<details>`):
 *   - Authentication: host, port, username, auth_type, password/key_file, passphrase
 *   - Stream: charset, knownHostsPath, proxyJump
 *   - Network: connectionTimeout, tcpNoDelay, soKeepalive, nullPacketKeepalive,
 *     enableCompression
 */
export function SshConnectionSection({
  config,
  onChange,
}: SshConnectionSectionProps) {
  return (
    <div className="ssh-connection-section">
      <details className="ssh-connection-group" open>
        <summary className="ssh-connection-group__title">Authentication</summary>
        <div className="ssh-connection-group__content">
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
        </div>
      </details>

      <details className="ssh-connection-group" open>
        <summary className="ssh-connection-group__title">Stream</summary>
        <div className="ssh-connection-group__content">
          <FormField label="Charset">
            <select
              value={config.charset || "utf-8"}
              onChange={(e) => onChange({ ...config, charset: e.target.value })}
            >
              {CHARSETS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Known Hosts File">
            <input
              type="text"
              placeholder="~/.ssh/known_hosts"
              value={config.knownHostsPath || ""}
              onChange={(e) =>
                onChange({ ...config, knownHostsPath: e.target.value })
              }
            />
          </FormField>
          <FormField label="ProxyJump (SSH bastion)">
            <input
              type="text"
              placeholder="user@bastion:22"
              value={config.proxyJump || ""}
              onChange={(e) => onChange({ ...config, proxyJump: e.target.value })}
            />
          </FormField>
        </div>
      </details>

      <details className="ssh-connection-group" open>
        <summary className="ssh-connection-group__title">Network</summary>
        <div className="ssh-connection-group__content">
          <FormField label="Connection Timeout (seconds)">
            <input
              type="number"
              placeholder="30"
              value={config.connectionTimeout ?? ""}
              onChange={(e) =>
                onChange({
                  ...config,
                  connectionTimeout: parseOptionalInt(e.target.value),
                })
              }
            />
          </FormField>
          <FormField label="TCP No Delay (disable Nagle)">
            <input
              type="checkbox"
              checked={config.tcpNoDelay ?? true}
              onChange={(e) => onChange({ ...config, tcpNoDelay: e.target.checked })}
            />
          </FormField>
          <FormField label="SO Keepalive">
            <input
              type="checkbox"
              checked={config.soKeepalive ?? false}
              onChange={(e) =>
                onChange({ ...config, soKeepalive: e.target.checked })
              }
            />
          </FormField>
          <FormField label="Null Packet Keepalive">
            <input
              type="checkbox"
              checked={config.nullPacketKeepalive ?? false}
              onChange={(e) =>
                onChange({ ...config, nullPacketKeepalive: e.target.checked })
              }
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
        </div>
      </details>
    </div>
  );
}
import { type SSHSessionConfig } from "../../types/session";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./SshConnectionSection.css";

interface SshConnectionSectionProps {
  config: SSHSessionConfig;
  onChange: (config: SSHSessionConfig) => void;
}

const CHARSETS = [
  { value: "utf-8", label: "UTF-8 (recommended)" },
  { value: "gbk", label: "GBK" },
];

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
export function SshConnectionSection({ config, onChange }: SshConnectionSectionProps) {
  return (
    <div className="ssh-connection-section">
      <details className="ssh-connection-group" open>
        <summary className="ssh-connection-group__title">Authentication</summary>
        <div className="ssh-connection-group__content">
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
        </div>
      </details>

      <details className="ssh-connection-group" open>
        <summary className="ssh-connection-group__title">Stream</summary>
        <div className="ssh-connection-group__content">
          <FormSelectField
            label="Charset"
            value={config.charset || "utf-8"}
            onChange={(v) => onChange({ ...config, charset: v })}
            options={CHARSETS}
          />
          <FormTextField
            label="Known Hosts File"
            placeholder="~/.ssh/known_hosts"
            value={config.knownHostsPath}
            onChange={(knownHostsPath) => onChange({ ...config, knownHostsPath })}
          />
          <FormTextField
            label="ProxyJump (SSH bastion)"
            placeholder="user@bastion:22"
            value={config.proxyJump}
            onChange={(proxyJump) => onChange({ ...config, proxyJump })}
          />
        </div>
      </details>

      <details className="ssh-connection-group" open>
        <summary className="ssh-connection-group__title">Network</summary>
        <div className="ssh-connection-group__content">
          <FormNumberField
            label="Connection Timeout (seconds)"
            placeholder="30"
            value={config.connectionTimeout}
            onChange={(connectionTimeout) => onChange({ ...config, connectionTimeout })}
          />
          <FormCheckboxField
            label="TCP No Delay (disable Nagle)"
            checked={config.tcpNoDelay ?? true}
            onChange={(tcpNoDelay) => onChange({ ...config, tcpNoDelay })}
          />
          <FormCheckboxField
            label="SO Keepalive"
            checked={config.soKeepalive ?? false}
            onChange={(soKeepalive) => onChange({ ...config, soKeepalive })}
          />
          <FormCheckboxField
            label="Null Packet Keepalive"
            checked={config.nullPacketKeepalive ?? false}
            onChange={(nullPacketKeepalive) => onChange({ ...config, nullPacketKeepalive })}
          />
          <FormCheckboxField
            label="Enable Compression"
            checked={config.enableCompression ?? false}
            onChange={(enableCompression) => onChange({ ...config, enableCompression })}
          />
        </div>
      </details>
    </div>
  );
}

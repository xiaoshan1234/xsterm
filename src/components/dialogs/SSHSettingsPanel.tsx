import { type SSHSessionConfig } from "../../types/session";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormNumberField } from "./FormNumberField";
import { FormTextField } from "./FormTextField";
import "./SSHSettingsPanel.css";

interface SSHSettingsPanelProps {
  sshConfig: SSHSessionConfig;
  onSshConfigChange: (config: SSHSessionConfig) => void;
}

export function SSHSettingsPanel({ sshConfig, onSshConfigChange }: SSHSettingsPanelProps) {
  return (
    <div className="ssh-settings-panel">
      <div className="ssh-settings-panel__section">
        <h3 className="ssh-settings-panel__section-title">Connection Options</h3>
        <div className="ssh-settings-panel__section-content">
          <FormNumberField
            label="Keepalive Interval"
            placeholder="(disabled)"
            value={sshConfig.keepaliveInterval}
            onChange={(keepaliveInterval) =>
              onSshConfigChange({ ...sshConfig, keepaliveInterval })
            }
          />

          <FormTextField
            label="Known Hosts File"
            placeholder="~/.ssh/known_hosts"
            value={sshConfig.knownHostsPath}
            onChange={(knownHostsPath) => onSshConfigChange({ ...sshConfig, knownHostsPath })}
          />

          <FormTextField
            label="ProxyJump"
            placeholder="user@bastion:22"
            value={sshConfig.proxyJump}
            onChange={(proxyJump) => onSshConfigChange({ ...sshConfig, proxyJump })}
          />
        </div>
      </div>

      <div className="ssh-settings-panel__section">
        <h3 className="ssh-settings-panel__section-title">Advanced</h3>
        <div className="ssh-settings-panel__section-content">
          <FormNumberField
            label="Connection Timeout"
            placeholder="30"
            value={sshConfig.connectionTimeout}
            onChange={(connectionTimeout) =>
              onSshConfigChange({ ...sshConfig, connectionTimeout })
            }
          />
          <FormCheckboxField
            label="TCP No Delay"
            checked={sshConfig.tcpNoDelay ?? true}
            onChange={(tcpNoDelay) => onSshConfigChange({ ...sshConfig, tcpNoDelay })}
          />
          <FormCheckboxField
            label="SO Keepalive"
            checked={sshConfig.soKeepalive ?? false}
            onChange={(soKeepalive) => onSshConfigChange({ ...sshConfig, soKeepalive })}
          />
          <FormCheckboxField
            label="Null Packet Keepalive"
            checked={sshConfig.nullPacketKeepalive ?? false}
            onChange={(nullPacketKeepalive) =>
              onSshConfigChange({ ...sshConfig, nullPacketKeepalive })
            }
          />
          <FormCheckboxField
            label="Enable Compression"
            checked={sshConfig.enableCompression ?? false}
            onChange={(enableCompression) =>
              onSshConfigChange({ ...sshConfig, enableCompression })
            }
          />
        </div>
      </div>
    </div>
  );
}

export default SSHSettingsPanel;

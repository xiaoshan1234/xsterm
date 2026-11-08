import { useMemo } from "react";
import { type LocalTerminalConfig, type SshConfig } from "../../../../models/legacy/terminal";
import { FormNumberField } from "../../../../shared/ui/FormNumberField";
import { FormSelectField } from "../../../../shared/ui/FormSelectField";
import { FormTextField } from "../../../../shared/ui/FormTextField";
import "./ConnectionTab.css";

type ConnectionType = "local" | "ssh";

interface SessionTabProps {
  connectionType: ConnectionType;
  onConnectionTypeChange: (type: ConnectionType) => void;
  name: string;
  onNameChange: (name: string) => void;
  selectedGroupId: number;
  onGroupChange: (groupId: number) => void;
  groups: Array<{ id: number; name: string }>;
  localConfig: LocalTerminalConfig;
  onLocalConfigChange: (config: LocalTerminalConfig) => void;
  sshConfig: SshConfig;
  onSshConfigChange: (config: SshConfig) => void;
  hideConnectionSwitcher?: boolean;
  hideNameAndGroup?: boolean;
}

const SHELL_TEMPLATES: Array<{ value: string; label: string }> = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "git-bash", label: "Git Bash" },
  { value: "wsl", label: "WSL" },
  { value: "custom", label: "Custom" },
];

export function SessionTab({
  connectionType,
  onConnectionTypeChange,
  name,
  onNameChange,
  selectedGroupId,
  onGroupChange,
  groups,
  localConfig,
  onLocalConfigChange,
  sshConfig,
  onSshConfigChange,
  hideConnectionSwitcher,
  hideNameAndGroup,
}: SessionTabProps) {
  const groupOptions = useMemo(
    () => groups.map((g) => ({ value: String(g.id), label: g.name })),
    [groups],
  );

  const shellTemplateValue: string =
    localConfig.shellTemplate ?? (localConfig.shell ? "custom" : "cmd");

  return (
    <div className="terminal-tab">
      {!hideNameAndGroup && (
        <div className="terminal-tab__common">
          <FormTextField
            label="Terminal Name"
            placeholder="Auto-generated if empty"
            value={name || undefined}
            onChange={(v) => onNameChange(v ?? "")}
          />
          <FormSelectField
            label="Group"
            value={String(selectedGroupId)}
            onChange={(v) => onGroupChange(parseInt(v, 10))}
            options={groupOptions}
          />
        </div>
      )}

      {!hideConnectionSwitcher && (
        <div className="terminal-type-switcher" role="group" aria-label="Connection type">
          <button
            type="button"
            className={`terminal-type-btn${connectionType === "local" ? " terminal-type-btn--active" : ""}`}
            onClick={() => onConnectionTypeChange("local")}
            aria-pressed={connectionType === "local"}
          >
            Shell
          </button>
          <button
            type="button"
            className={`terminal-type-btn${connectionType === "ssh" ? " terminal-type-btn--active" : ""}`}
            onClick={() => onConnectionTypeChange("ssh")}
            aria-pressed={connectionType === "ssh"}
          >
            SSH
          </button>
        </div>
      )}

      {connectionType === "local" && (
        <div className="terminal-section">
          <div className="terminal-section__title">Shell Configuration</div>

          <FormSelectField
            label="Shell Template"
            value={shellTemplateValue}
            onChange={(v) =>
              onLocalConfigChange({
                ...localConfig,
                shellTemplate: v as NonNullable<LocalTerminalConfig["shellTemplate"]>,
              })
            }
            options={SHELL_TEMPLATES}
          />

          {shellTemplateValue === "custom" && (
            <FormTextField
              label="Shell Path"
              placeholder="/path/to/shell"
              value={localConfig.shell}
              onChange={(shell) => onLocalConfigChange({ ...localConfig, shell })}
            />
          )}

          <FormTextField
            label="Initial Directory"
            placeholder="/home/user"
            value={localConfig.cwd || undefined}
            onChange={(cwd) => onLocalConfigChange({ ...localConfig, cwd: cwd ?? "" })}
          />
        </div>
      )}

      {connectionType === "ssh" && (
        <div className="terminal-section">
          <div className="terminal-section__title">SSH Configuration</div>

          <FormTextField
            label="Host"
            placeholder="example.com"
            value={sshConfig.host}
            onChange={(host) => onSshConfigChange({ ...sshConfig, host: host ?? "" })}
          />

          <div className="terminal-row">
            <FormNumberField
              label="Port"
              placeholder="22"
              min={1}
              max={65535}
              value={sshConfig.port}
              onChange={(v) => onSshConfigChange({ ...sshConfig, port: v ?? 22 })}
            />
            <FormTextField
              label="Username"
              placeholder="root"
              value={sshConfig.username}
              onChange={(username) => onSshConfigChange({ ...sshConfig, username: username ?? "" })}
            />
          </div>

          <FormSelectField
            label="Authentication"
            value={sshConfig.auth_type}
            onChange={(v) =>
              onSshConfigChange({ ...sshConfig, auth_type: v as "password" | "key" })
            }
            options={[
              { value: "password", label: "Password" },
              { value: "key", label: "Key File" },
            ]}
          />

          {sshConfig.auth_type === "password" ? (
            <FormTextField
              label="Password"
              placeholder="********"
              type="password"
              value={sshConfig.password}
              onChange={(password) => onSshConfigChange({ ...sshConfig, password })}
            />
          ) : (
            <>
              <FormTextField
                label="Key File Path"
                placeholder="~/.ssh/id_rsa"
                value={sshConfig.key_file}
                onChange={(key_file) => onSshConfigChange({ ...sshConfig, key_file })}
              />
              <FormTextField
                label="Passphrase"
                placeholder="********"
                type="password"
                value={sshConfig.passphrase}
                onChange={(passphrase) => onSshConfigChange({ ...sshConfig, passphrase })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SessionTab;

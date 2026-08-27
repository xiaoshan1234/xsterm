import { useMemo } from "react";
import { type LocalSessionConfig, type SSHSessionConfig } from "../../types/session";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./SessionTab.css";

const isWindows =
  navigator.userAgent.toLowerCase().includes("windows") ||
  navigator.platform.toLowerCase().includes("win");

type ConnectionType = "local" | "ssh";

interface SessionTabProps {
  connectionType: ConnectionType;
  onConnectionTypeChange: (type: ConnectionType) => void;
  name: string;
  onNameChange: (name: string) => void;
  selectedGroupId: number | null;
  onGroupChange: (groupId: number | null) => void;
  groups: Array<{ id: number; name: string }>;
  localConfig: LocalSessionConfig;
  onLocalConfigChange: (config: LocalSessionConfig) => void;
  sshConfig: SSHSessionConfig;
  onSshConfigChange: (config: SSHSessionConfig) => void;
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

const GROUP_OPTIONS_NONE: Array<{ value: string; label: string }> = [
  { value: "", label: "None" },
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
    () => [...GROUP_OPTIONS_NONE, ...groups.map((g) => ({ value: String(g.id), label: g.name }))],
    [groups],
  );

  const shellTemplateValue: string = localConfig.shellTemplate
    ?? (localConfig.shell ? "custom" : "cmd");

  return (
    <div className="session-tab">
      {!hideNameAndGroup && (
        <div className="session-tab__common">
          <FormTextField
            label="Session Name"
            placeholder="Auto-generated if empty"
            value={name || undefined}
            onChange={(v) => onNameChange(v ?? "")}
          />
          <FormSelectField
            label="Group"
            value={selectedGroupId !== null ? String(selectedGroupId) : ""}
            onChange={(v) => onGroupChange(v === "" ? null : parseInt(v, 10))}
            options={groupOptions}
          />
        </div>
      )}

      {!hideConnectionSwitcher && (
        <div className="session-type-switcher" role="group" aria-label="Connection type">
          <button
            type="button"
            className={`session-type-btn${connectionType === "local" ? " session-type-btn--active" : ""}`}
            onClick={() => onConnectionTypeChange("local")}
            aria-pressed={connectionType === "local"}
          >
            Shell
          </button>
          <button
            type="button"
            className={`session-type-btn${connectionType === "ssh" ? " session-type-btn--active" : ""}`}
            onClick={() => onConnectionTypeChange("ssh")}
            aria-pressed={connectionType === "ssh"}
          >
            SSH
          </button>
        </div>
      )}

      {connectionType === "local" && (
        <div className="session-section">
          <div className="session-section__title">Shell Configuration</div>

          <FormSelectField
            label="Shell Template"
            value={shellTemplateValue}
            onChange={(v) =>
              onLocalConfigChange({
                ...localConfig,
                shellTemplate: v as NonNullable<LocalSessionConfig["shellTemplate"]>,
              })
            }
            options={SHELL_TEMPLATES}
          />

          {isWindows && (shellTemplateValue === "powershell" || shellTemplateValue === "cmd") && (
            <FormCheckboxField
              label="Run as Administrator"
              checked={localConfig.runAsAdmin ?? false}
              onChange={(runAsAdmin) => onLocalConfigChange({ ...localConfig, runAsAdmin })}
            />
          )}

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
        <div className="session-section">
          <div className="session-section__title">SSH Configuration</div>

          <FormTextField
            label="Host"
            placeholder="example.com"
            value={sshConfig.host}
            onChange={(host) => onSshConfigChange({ ...sshConfig, host: host ?? "" })}
          />

          <div className="session-row">
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
              onChange={(username) =>
                onSshConfigChange({ ...sshConfig, username: username ?? "" })
              }
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
                onChange={(passphrase) =>
                  onSshConfigChange({ ...sshConfig, passphrase })
                }
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SessionTab;

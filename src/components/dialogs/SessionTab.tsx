import { useMemo, useState } from "react";
import { type LocalSessionConfig, type SSHSessionConfig } from "../../types/session";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./SessionTab.css";

// ── Types ────────────────────────────────────────────────────────────────────

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
}

// ── Constants ────────────────────────────────────────────────────────────────

const SHELL_TEMPLATES: Array<{ value: string; label: string }> = [
  { value: "", label: "Default (per OS)" },
  { value: "powershell", label: "PowerShell" },
  { value: "powershell7", label: "PowerShell 7" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL (Default Distro)" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
  { value: "sh", label: "Sh" },
  { value: "custom", label: "Custom (specify path)" },
];

const GROUP_OPTIONS_NONE: Array<{ value: string; label: string }> = [
  { value: "", label: "None" },
];

// ── Initial Size helpers ─────────────────────────────────────────────────────

/** Format initialCols + initialRows into the display string "80 × 24". */
function formatInitialSize(cols: number | undefined, rows: number | undefined): string {
  const c = cols ?? 80;
  const r = rows ?? 24;
  return `${c} \u00D7 ${r}`;
}

/** Parse "80 × 24" (or "80x24", "80 x 24") → { initialCols, initialRows }.
 *  Returns undefined for both when the input is empty or unparseable. */
function parseInitialSize(value: string): { initialCols?: number; initialRows?: number } {
  const trimmed = value.trim();
  if (!trimmed) return { initialCols: undefined, initialRows: undefined };
  const match = trimmed.match(/^(\d+)\s*[×xX]\s*(\d+)$/);
  if (!match) return { initialCols: undefined, initialRows: undefined };
  return { initialCols: parseInt(match[1], 10), initialRows: parseInt(match[2], 10) };
}

// ── Component ────────────────────────────────────────────────────────────────

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
}: SessionTabProps) {
  // Display buffer for the "80 × 24" formatted size field.
  const [initialSizeDisplay, setInitialSizeDisplay] = useState(() =>
    formatInitialSize(sshConfig.initialCols, sshConfig.initialRows),
  );

  const handleInitialSizeChange = (value: string | undefined) => {
    const text = value ?? "";
    setInitialSizeDisplay(text);
    const { initialCols, initialRows } = parseInitialSize(text);
    onSshConfigChange({ ...sshConfig, initialCols, initialRows });
  };

  // Dynamic group options: "None" + all user-created groups.
  const groupOptions = useMemo(
    () => [...GROUP_OPTIONS_NONE, ...groups.map((g) => ({ value: String(g.id), label: g.name }))],
    [groups],
  );

  // Resolve shell template select value: explicit template > inferred "custom" > default.
  const shellTemplateValue: string = localConfig.shellTemplate
    ?? (localConfig.shell ? "custom" : "");

  return (
    <div className="session-tab">
      {/* ── Common fields ─────────────────────────────────────────────── */}
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

      {/* ── Connection type segmented control ─────────────────────────── */}
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

      {/* ── Shell mode ────────────────────────────────────────────────── */}
      {connectionType === "local" && (
        <div className="session-section">
          <div className="session-section__title">Shell Configuration</div>

          <FormSelectField
            label="Shell Template"
            value={shellTemplateValue}
            onChange={(v) =>
              onLocalConfigChange({
                ...localConfig,
                shellTemplate:
                  v === ""
                    ? undefined
                    : (v as NonNullable<LocalSessionConfig["shellTemplate"]>),
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

      {/* ── SSH mode ──────────────────────────────────────────────────── */}
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

          <div className="session-row">
            <FormTextField
              label="Initial Size"
              placeholder="80 × 24"
              value={initialSizeDisplay}
              onChange={handleInitialSizeChange}
            />
            <FormNumberField
              label="Keepalive Interval"
              placeholder="(disabled)"
              value={sshConfig.keepaliveInterval}
              onChange={(keepaliveInterval) =>
                onSshConfigChange({ ...sshConfig, keepaliveInterval })
              }
            />
          </div>

          <FormTextField
            label="Known Hosts File"
            placeholder="~/.ssh/known_hosts"
            value={sshConfig.knownHostsPath}
            onChange={(knownHostsPath) =>
              onSshConfigChange({ ...sshConfig, knownHostsPath })
            }
          />

          <FormTextField
            label="ProxyJump"
            placeholder="user@bastion:22"
            value={sshConfig.proxyJump}
            onChange={(proxyJump) => onSshConfigChange({ ...sshConfig, proxyJump })}
          />

          {/* ── Advanced collapsible ─────────────────────────────────── */}
          <div className="session-section__title session-section__title--spaced">
            SSH Options
          </div>

          <details className="ssh-advanced-section">
            <summary className="ssh-advanced-section__title">Advanced</summary>
            <div className="ssh-advanced-section__content">
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
                onChange={(tcpNoDelay) =>
                  onSshConfigChange({ ...sshConfig, tcpNoDelay })
                }
              />
              <FormCheckboxField
                label="SO Keepalive"
                checked={sshConfig.soKeepalive ?? false}
                onChange={(soKeepalive) =>
                  onSshConfigChange({ ...sshConfig, soKeepalive })
                }
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
          </details>
        </div>
      )}
    </div>
  );
}

export default SessionTab;

import { ReactNode } from "react";
import type {
  LocalSessionSpec,
  SshSessionSpec,
  SessionSpec,
  SystemConfig,
  SystemProfile,
  TerminalConfig,
} from "../../types/session";
import {
  CUSTOM_PROFILE_LABEL,
  SYSTEM_PROFILES,
  detectProfileFromSystemConfig,
  getDefaultSystemConfig,
} from "../../constants/systemProfiles";
import "./SessionPages.css";

interface FieldRowProps {
  label: string;
  children: ReactNode;
  error?: string;
}

function FieldRow({ label, children, error }: FieldRowProps) {
  return (
    <div className="field-row">
      <label className="field-row__label">{label}</label>
      <div className="field-row__content form-field">
        {children}
        {error && <div className="dialog-error">{error}</div>}
      </div>
    </div>
  );
}

export interface SessionPageProps {
  name: string;
  onNameChange: (v: string) => void;
  nameError?: string;
  spec: SessionSpec;
  onSpecChange: (spec: SessionSpec) => void;
  system: SystemConfig;
  onSystemChange: (s: SystemConfig, profile: SystemProfile | "Custom") => void;
  profile: SystemProfile | "Custom";
  groups: { id: number; name: string }[];
  groupId: number | null;
  onGroupChange: (id: number | null) => void;
}

const PROFILE_ORDER = Object.keys(SYSTEM_PROFILES) as SystemProfile[];

function formatProfileLabel(profile: SystemProfile): string {
  return profile.charAt(0).toUpperCase() + profile.slice(1);
}

interface SystemFieldsProps {
  system: SystemConfig;
  onSystemChange: (s: SystemConfig, profile: SystemProfile | "Custom") => void;
  profile: SystemProfile | "Custom";
}

function SystemFields({ system, onSystemChange, profile }: SystemFieldsProps) {
  function handleProfileChange(selected: SystemProfile) {
    onSystemChange(getDefaultSystemConfig(selected), selected);
  }

  function handleFieldChange(key: keyof SystemConfig, value: string) {
    const next = { ...system, [key]: value };
    onSystemChange(next, detectProfileFromSystemConfig(next));
  }

  return (
    <>
      <FieldRow label="Terminal">
        <input
          type="text"
          value={system.terminalType}
          onChange={(e) => handleFieldChange("terminalType", e.target.value)}
        />
      </FieldRow>
      <FieldRow label="System">
        <select
          value={profile}
          onChange={(e) =>
            handleProfileChange(e.target.value as SystemProfile)
          }
        >
          {profile === "Custom" && (
            <option value="Custom" disabled>
              {CUSTOM_PROFILE_LABEL}
            </option>
          )}
          {PROFILE_ORDER.map((p) => (
            <option key={p} value={p}>
              {formatProfileLabel(p)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Charset">
        <input
          type="text"
          value={system.charset}
          onChange={(e) => handleFieldChange("charset", e.target.value)}
        />
      </FieldRow>
    </>
  );
}

const isWindows =
  navigator.userAgent.toLowerCase().includes("windows") ||
  navigator.platform.toLowerCase().includes("win");

const LOCAL_SHELLS = isWindows
  ? [
      { value: "", label: "Default (PowerShell)" },
      { value: "powershell.exe", label: "PowerShell" },
      { value: "pwsh.exe", label: "PowerShell 7" },
      { value: "cmd.exe", label: "CMD" },
      { value: "wsl.exe", label: "WSL (Default Distro)" },
      { value: "wsl.exe -d Ubuntu", label: "WSL - Ubuntu" },
      { value: "wsl.exe -d Debian", label: "WSL - Debian" },
      { value: "wsl.exe -d Arch", label: "WSL - Arch" },
    ]
  : [
      { value: "", label: "Default ($SHELL)" },
      { value: "/bin/bash", label: "Bash" },
      { value: "/bin/zsh", label: "Zsh" },
      { value: "/bin/sh", label: "Sh" },
    ];

const CWD_PLACEHOLDER = isWindows
  ? "C:\\Users\\you or %USERPROFILE%"
  : "/home/user or ~";

export function SessionPageLocal({
  name,
  onNameChange,
  nameError,
  spec,
  onSpecChange,
  system,
  onSystemChange,
  profile,
  groups,
  groupId,
  onGroupChange,
}: SessionPageProps) {
  const localSpec = spec as LocalSessionSpec;

  return (
    <div className="session-page">
      <FieldRow label="Shell">
        <select
          value={localSpec.shell || ""}
          onChange={(e) =>
            onSpecChange({
              ...localSpec,
              shell: e.target.value || undefined,
            })
          }
        >
          {LOCAL_SHELLS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Working directory">
        <input
          type="text"
          placeholder={CWD_PLACEHOLDER}
          value={localSpec.cwd || ""}
          onChange={(e) =>
            onSpecChange({
              ...localSpec,
              cwd: e.target.value || undefined,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Arguments">
        <input
          type="text"
          placeholder="--cd /home/user (space separated)"
          value={localSpec.args?.join(" ") || ""}
          onChange={(e) => {
            const v = e.target.value;
            const args = v.trim() ? v.split(/\s+/) : undefined;
            onSpecChange({ ...localSpec, args });
          }}
        />
      </FieldRow>
      <FieldRow label="Name" error={nameError}>
        <input
          type="text"
          placeholder="My session"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Group">
        <select
          value={groupId ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            onGroupChange(value ? Number(value) : null);
          }}
        >
          <option value="">None</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </FieldRow>
      <SystemFields
        system={system}
        onSystemChange={onSystemChange}
        profile={profile}
      />
    </div>
  );
}

export function SessionPageSsh({
  name,
  onNameChange,
  nameError,
  spec,
  onSpecChange,
  system,
  onSystemChange,
  profile,
  groups,
  groupId,
  onGroupChange,
}: SessionPageProps) {
  const sshSpec = spec as SshSessionSpec;

  return (
    <div className="session-page">
      <FieldRow label="Host">
        <input
          type="text"
          placeholder="[user@]host"
          value={sshSpec.host}
          onChange={(e) =>
            onSpecChange({ ...sshSpec, host: e.target.value })
          }
        />
      </FieldRow>
      <FieldRow label="Port">
        <input
          type="number"
          min={1}
          max={65535}
          placeholder="22"
          value={sshSpec.port}
          onChange={(e) =>
            onSpecChange({
              ...sshSpec,
              port: parseInt(e.target.value) || 22,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Name" error={nameError}>
        <input
          type="text"
          placeholder="My session"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Group">
        <select
          value={groupId ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            onGroupChange(value ? Number(value) : null);
          }}
        >
          <option value="">None</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </FieldRow>
      <SystemFields
        system={system}
        onSystemChange={onSystemChange}
        profile={profile}
      />
    </div>
  );
}

export interface TerminalModePageProps {
  system: SystemConfig;
  onSystemChange: (s: SystemConfig, profile: SystemProfile | "Custom") => void;
  profile: SystemProfile | "Custom";
  terminal: TerminalConfig;
  onTerminalChange: (t: TerminalConfig) => void;
}

const DEFAULT_SCROLLBACK = 5000;
const MAX_SCROLLBACK = 100000;

function parseScrollback(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_SCROLLBACK;
  }
  return parsed;
}

const MOUSE_SCROLL_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "page", label: "Page" },
];

const NEWLINE_OPTIONS = [
  { value: "\n", label: "LF" },
  { value: "\r\n", label: "CRLF" },
  { value: "\r", label: "CR" },
];

export function TerminalModePage({
  system,
  onSystemChange,
  terminal,
  onTerminalChange,
}: TerminalModePageProps) {
  function handleSystemFieldChange(key: keyof SystemConfig, value: string) {
    const next = { ...system, [key]: value };
    onSystemChange(next, detectProfileFromSystemConfig(next));
  }

  return (
    <div className="session-page">
      <FieldRow label="Scrollback lines">
        <input
          type="number"
          min={0}
          max={MAX_SCROLLBACK}
          value={terminal.scrollbackLines}
          onChange={(e) =>
            onTerminalChange({
              ...terminal,
              scrollbackLines: parseScrollback(e.target.value),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Mouse scroll">
        <select
          value={system.mouseScroll}
          onChange={(e) =>
            handleSystemFieldChange("mouseScroll", e.target.value)
          }
        >
          {MOUSE_SCROLL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Newline">
        <select
          value={system.newline}
          onChange={(e) =>
            handleSystemFieldChange("newline", e.target.value)
          }
        >
          {NEWLINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </FieldRow>
    </div>
  );
}

export interface TerminalKeyboardPageProps {
  system: SystemConfig;
  onSystemChange: (s: SystemConfig, profile: SystemProfile | "Custom") => void;
  profile: SystemProfile | "Custom";
}

export function TerminalKeyboardPage({
  system,
  onSystemChange,
}: TerminalKeyboardPageProps) {
  function handleFieldChange(key: keyof SystemConfig, value: string) {
    const next = { ...system, [key]: value };
    onSystemChange(next, detectProfileFromSystemConfig(next));
  }

  return (
    <div className="session-page">
      <FieldRow label="Backspace">
        <input
          type="text"
          value={system.backspace}
          onChange={(e) =>
            handleFieldChange("backspace", e.target.value)
          }
        />
      </FieldRow>
      <FieldRow label="Delete">
        <input
          type="text"
          value={system.delete}
          onChange={(e) =>
            handleFieldChange("delete", e.target.value)
          }
        />
      </FieldRow>
      <FieldRow label="Signal key">
        <input
          type="text"
          value={system.signalKey}
          onChange={(e) =>
            handleFieldChange("signalKey", e.target.value)
          }
        />
      </FieldRow>
    </div>
  );
}

export interface TerminalLogPageProps {
  terminal: TerminalConfig;
  onTerminalChange: (t: TerminalConfig) => void;
}

export function TerminalLogPage({
  terminal,
  onTerminalChange,
}: TerminalLogPageProps) {
  return (
    <div className="session-page">
      <FieldRow label="Auto-log path">
        <input
          type="text"
          placeholder="Empty = disabled"
          value={terminal.autoLogPath}
          onChange={(e) =>
            onTerminalChange({
              ...terminal,
              autoLogPath: e.target.value,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Highlight keywords">
        <input
          type="text"
          placeholder="comma-separated keywords"
          value={terminal.highlightKeywords}
          onChange={(e) =>
            onTerminalChange({
              ...terminal,
              highlightKeywords: e.target.value,
            })
          }
        />
      </FieldRow>
    </div>
  );
}

export interface SshAuthPageProps {
  spec: SshSessionSpec;
  onSpecChange: (spec: SshSessionSpec) => void;
}

export function SshAuthPage({ spec, onSpecChange }: SshAuthPageProps) {
  return (
    <div className="session-page">
      <FieldRow label="Username">
        <input
          type="text"
          placeholder="root"
          value={spec.username}
          onChange={(e) =>
            onSpecChange({ ...spec, username: e.target.value })
          }
        />
      </FieldRow>
      <FieldRow label="Authentication">
        <select
          value={spec.auth_type}
          onChange={(e) =>
            onSpecChange({
              ...spec,
              auth_type: e.target.value as "password" | "key",
            })
          }
        >
          <option value="password">Password</option>
          <option value="key">Public key</option>
        </select>
      </FieldRow>
      {spec.auth_type === "password" ? (
        <FieldRow label="Password">
          <input
            type="password"
            placeholder="********"
            value={spec.password || ""}
            onChange={(e) =>
              onSpecChange({ ...spec, password: e.target.value })
            }
          />
        </FieldRow>
      ) : (
        <>
          <FieldRow label="Key file">
            <input
              type="text"
              placeholder="~/.ssh/id_rsa"
              value={spec.key_file || ""}
              onChange={(e) =>
                onSpecChange({ ...spec, key_file: e.target.value })
              }
            />
          </FieldRow>
          <FieldRow label="Passphrase">
            <input
              type="password"
              placeholder="********"
              value={spec.passphrase || ""}
              onChange={(e) =>
                onSpecChange({ ...spec, passphrase: e.target.value })
              }
            />
          </FieldRow>
        </>
      )}
    </div>
  );
}

export interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      {title} is not implemented yet.
    </div>
  );
}

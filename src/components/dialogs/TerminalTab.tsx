import { useState } from "react";
import { type LocalSessionConfig, type SessionDisplayConfig } from "../../types/session";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./TerminalTab.css";

interface TerminalTabProps {
  config: LocalSessionConfig;
  onChange: (config: LocalSessionConfig) => void;
  displayConfig?: SessionDisplayConfig;
  onDisplayChange: (config: SessionDisplayConfig) => void;
}

interface EnvVar {
  key: string;
  value: string;
}

function envVarsToMap(vars: EnvVar[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const v of vars) {
    if (v.key.trim()) {
      result[v.key.trim()] = v.value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const KEY_ACTION_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "backspace", label: "Backspace (^H)" },
  { value: "delete", label: "Delete (^?)" },
] as const;

const CURSOR_KEY_OPTIONS = [
  { value: "normal", label: "Normal (ANSI cursor keys)" },
  { value: "application", label: "Application (DECCKM)" },
] as const;

const KEYPAD_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "application", label: "Application (DECNKM)" },
] as const;

const CLIPBOARD_OPTIONS = [
  { value: "ask", label: "Ask each time" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
] as const;

export default function TerminalTab({
  config,
  onChange,
  displayConfig = {},
  onDisplayChange,
}: TerminalTabProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    const env = config.envConfig?.env || {};
    return (Object.entries(env) as [string, string][]).map(([key, value]) => ({ key, value }));
  });

  const updateDisplay = (patch: Partial<SessionDisplayConfig>) => {
    onDisplayChange({ ...displayConfig, ...patch });
  };

  const updateEnvVars = (next: EnvVar[]) => {
    setEnvVars(next);
    const envMap = envVarsToMap(next);
    onChange({
      ...config,
      envConfig: envMap ? { env: envMap } : undefined,
    });
  };

  return (
    <div className="terminal-tab">
      {/* ── Startup ── */}
      <div className="terminal-tab__section">
        <h3 className="terminal-tab__section-title">Startup</h3>
        <div className="terminal-tab__section-content">
          <FormTextField
            label="Startup Command"
            placeholder='echo "Hello, world!"'
            value={config.startupCommand}
            onChange={(startupCommand) => onChange({ ...config, startupCommand })}
          />

          <div className="terminal-tab__delay-row">
            <span className="terminal-tab__delay-label">Delay:</span>
            <input
              className="terminal-tab__delay-input"
              type="number"
              placeholder="0"
              min={0}
              value={config.startupDelayMs ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...config, startupDelayMs: v === "" ? undefined : Number(v) });
              }}
            />
            <span className="terminal-tab__delay-unit">ms</span>
          </div>

          <FormTextField
            label="Arguments"
            placeholder="--cd /home/user (space separated)"
            value={config.args?.join(" ") ?? undefined}
            onChange={(v) => {
              const args = v?.trim() ? v.trim().split(/\s+/) : undefined;
              onChange({ ...config, args });
            }}
          />

          <div className="form-field">
            <label className="form-field__label">Environment Variables</label>
            <div className="terminal-tab__env-list">
              {envVars.map((env, index) => (
                <div key={index} className="terminal-tab__env-row">
                  <input
                    type="text"
                    placeholder="KEY"
                    value={env.key}
                    onChange={(e) => {
                      const next = [...envVars];
                      next[index] = { ...env, key: e.target.value };
                      updateEnvVars(next);
                    }}
                  />
                  <input
                    type="text"
                    placeholder="VALUE"
                    value={env.value}
                    onChange={(e) => {
                      const next = [...envVars];
                      next[index] = { ...env, value: e.target.value };
                      updateEnvVars(next);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => {
                      const next = envVars.filter((_, i) => i !== index);
                      updateEnvVars(next);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => updateEnvVars([...envVars, { key: "", value: "" }])}
              >
                Add Variable
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Keyboard ── */}
      <div className="terminal-tab__section">
        <h3 className="terminal-tab__section-title">Keyboard</h3>
        <div className="terminal-tab__section-content">
          <div className="terminal-tab__two-col">
            <FormSelectField
              label="Backspace Sends"
              value={displayConfig.backspaceSends ?? "auto"}
              onChange={(v) =>
                updateDisplay({ backspaceSends: v as SessionDisplayConfig["backspaceSends"] })
              }
              options={KEY_ACTION_OPTIONS}
            />
            <FormSelectField
              label="Delete Sends"
              value={displayConfig.deleteSends ?? "auto"}
              onChange={(v) =>
                updateDisplay({ deleteSends: v as SessionDisplayConfig["deleteSends"] })
              }
              options={KEY_ACTION_OPTIONS}
            />
          </div>

          <div className="terminal-tab__two-col">
            <FormSelectField
              label="Cursor Key Mode"
              value={displayConfig.cursorKeyMode ?? "normal"}
              onChange={(v) =>
                updateDisplay({ cursorKeyMode: v as SessionDisplayConfig["cursorKeyMode"] })
              }
              options={CURSOR_KEY_OPTIONS}
            />
            <FormSelectField
              label="Keypad Mode"
              value={displayConfig.keypadMode ?? "normal"}
              onChange={(v) =>
                updateDisplay({ keypadMode: v as SessionDisplayConfig["keypadMode"] })
              }
              options={KEYPAD_OPTIONS}
            />
          </div>

          <FormCheckboxField
            label="Alt Sends Escape"
            checked={displayConfig.altSendsEscape ?? true}
            onChange={(altSendsEscape) => updateDisplay({ altSendsEscape })}
          />
        </div>
      </div>

      {/* ── Clipboard ── */}
      <div className="terminal-tab__section">
        <h3 className="terminal-tab__section-title">Clipboard</h3>
        <div className="terminal-tab__section-content">
          <div className="terminal-tab__two-col">
            <FormSelectField
              label="Clipboard Read"
              value={displayConfig.clipboardRead ?? "ask"}
              onChange={(v) =>
                updateDisplay({ clipboardRead: v as SessionDisplayConfig["clipboardRead"] })
              }
              options={CLIPBOARD_OPTIONS}
            />
            <FormSelectField
              label="Clipboard Write"
              value={displayConfig.clipboardWrite ?? "ask"}
              onChange={(v) =>
                updateDisplay({ clipboardWrite: v as SessionDisplayConfig["clipboardWrite"] })
              }
              options={CLIPBOARD_OPTIONS}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
